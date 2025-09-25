-- Real-time notification triggers for automatic notification generation
-- This file creates database triggers to automatically queue notifications for:
-- 1. New chat messages
-- 2. Activity status changes
-- 3. Support request updates

-- Trigger for new chat messages
CREATE OR REPLACE FUNCTION trigger_new_message_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title TEXT;
    notification_message TEXT;
    sender_name TEXT;
    conversation_participants UUID[];
    participant_id UUID;
BEGIN
    -- Get sender's name
    SELECT COALESCE(full_name, email) INTO sender_name
    FROM profiles 
    WHERE id = NEW.user_id;
    
    -- Create notification content
    notification_title := 'New Message';
    notification_message := CONCAT(sender_name, ': ', LEFT(NEW.content, 50));
    
    -- If message is longer than 50 chars, add ellipsis
    IF LENGTH(NEW.content) > 50 THEN
        notification_message := CONCAT(notification_message, '...');
    END IF;
    
    -- Get all participants in this conversation except the sender
    -- Note: This assumes a chat_participants table exists
    -- If using a different structure, adjust accordingly
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_participants') THEN
        SELECT ARRAY_AGG(user_id) INTO conversation_participants
        FROM chat_participants 
        WHERE conversation_id = NEW.conversation_id 
        AND user_id != NEW.user_id;
    ELSE
        -- Fallback: notify all users except sender (adjust based on your chat structure)
        SELECT ARRAY_AGG(id) INTO conversation_participants
        FROM auth.users 
        WHERE id != NEW.user_id;
    END IF;
    
    -- Queue notification for each participant
    IF conversation_participants IS NOT NULL THEN
        FOREACH participant_id IN ARRAY conversation_participants
        LOOP
            PERFORM queue_notification(
                participant_id,
                'new_message',
                notification_title,
                notification_message,
                JSONB_BUILD_OBJECT(
                    'message_id', NEW.id,
                    'conversation_id', NEW.conversation_id,
                    'sender_id', NEW.user_id,
                    'sender_name', sender_name
                )
            );
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for chat messages
-- Note: Adjust table name based on your chat messages table
DROP TRIGGER IF EXISTS new_message_notification_trigger ON messages;
CREATE TRIGGER new_message_notification_trigger
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION trigger_new_message_notification();

-- Trigger for activity status changes
CREATE OR REPLACE FUNCTION trigger_activity_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title TEXT;
    notification_message TEXT;
    activity_name TEXT;
    assigned_users UUID[];
    user_id UUID;
    status_change_text TEXT;
BEGIN
    -- Only trigger on status changes
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;
    
    -- Get activity name
    SELECT title INTO activity_name
    FROM activities 
    WHERE id = NEW.id;
    
    -- Format status change message
    CASE NEW.status
        WHEN 'completed' THEN
            status_change_text := 'completed';
        WHEN 'in_progress' THEN
            status_change_text := 'started';
        WHEN 'cancelled' THEN
            status_change_text := 'cancelled';
        WHEN 'on_hold' THEN
            status_change_text := 'put on hold';
        ELSE
            status_change_text := CONCAT('changed to ', NEW.status);
    END CASE;
    
    notification_title := 'Activity Update';
    notification_message := CONCAT('Activity "', activity_name, '" has been ', status_change_text);
    
    -- Get assigned users for this activity
    -- Note: Adjust based on your activity assignment structure
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'assigned_user_id') THEN
        -- Single assignment
        IF NEW.assigned_user_id IS NOT NULL THEN
            assigned_users := ARRAY[NEW.assigned_user_id];
        END IF;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_assignments') THEN
        -- Multiple assignments table
        SELECT ARRAY_AGG(user_id) INTO assigned_users
        FROM activity_assignments 
        WHERE activity_id = NEW.id;
    END IF;
    
    -- Queue notification for assigned users
    IF assigned_users IS NOT NULL THEN
        FOREACH user_id IN ARRAY assigned_users
        LOOP
            PERFORM queue_notification(
                user_id,
                'activity_status_change',
                notification_title,
                notification_message,
                JSONB_BUILD_OBJECT(
                    'activity_id', NEW.id,
                    'activity_name', activity_name,
                    'old_status', OLD.status,
                    'new_status', NEW.status
                )
            );
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for activity status changes
-- Note: Adjust table name based on your activities table
DROP TRIGGER IF EXISTS activity_status_notification_trigger ON activities;
CREATE TRIGGER activity_status_notification_trigger
    AFTER UPDATE ON activities
    FOR EACH ROW
    EXECUTE FUNCTION trigger_activity_status_notification();

-- Trigger for support request updates
CREATE OR REPLACE FUNCTION trigger_support_request_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title TEXT;
    notification_message TEXT;
    support_title TEXT;
    status_change_text TEXT;
    assigned_agent_id UUID;
    requester_id UUID;
BEGIN
    -- Get support request details
    SELECT title, assigned_agent_id, user_id 
    INTO support_title, assigned_agent_id, requester_id
    FROM support_requests 
    WHERE id = NEW.id;
    
    -- Handle different types of updates
    IF TG_OP = 'INSERT' THEN
        -- New support request
        notification_title := 'New Support Request';
        notification_message := CONCAT('Support request "', support_title, '" has been created');
        
        -- Notify support agents (users with support role)
        INSERT INTO notification_queue (user_id, type, title, message, data, scheduled_for)
        SELECT 
            u.id,
            'support_request_update',
            notification_title,
            notification_message,
            JSONB_BUILD_OBJECT(
                'support_request_id', NEW.id,
                'support_title', support_title,
                'action', 'created'
            ),
            NOW()
        FROM auth.users u
        JOIN profiles p ON p.id = u.id
        WHERE p.role = 'support_agent' OR p.role = 'admin';
        
    ELSIF TG_OP = 'UPDATE' THEN
        -- Support request updated
        
        -- Status change notification
        IF OLD.status != NEW.status THEN
            CASE NEW.status
                WHEN 'resolved' THEN
                    status_change_text := 'resolved';
                WHEN 'in_progress' THEN
                    status_change_text := 'being worked on';
                WHEN 'escalated' THEN
                    status_change_text := 'escalated';
                WHEN 'closed' THEN
                    status_change_text := 'closed';
                ELSE
                    status_change_text := CONCAT('changed to ', NEW.status);
            END CASE;
            
            notification_title := 'Support Request Update';
            notification_message := CONCAT('Your support request "', support_title, '" has been ', status_change_text);
            
            -- Notify the requester
            PERFORM queue_notification(
                requester_id,
                'support_request_update',
                notification_title,
                notification_message,
                JSONB_BUILD_OBJECT(
                    'support_request_id', NEW.id,
                    'support_title', support_title,
                    'old_status', OLD.status,
                    'new_status', NEW.status
                )
            );
        END IF;
        
        -- Assignment change notification
        IF OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
            notification_title := 'Support Request Assignment';
            
            IF NEW.assigned_agent_id IS NOT NULL THEN
                notification_message := CONCAT('Support request "', support_title, '" has been assigned to you');
                
                -- Notify the assigned agent
                PERFORM queue_notification(
                    NEW.assigned_agent_id,
                    'assignment_notification',
                    notification_title,
                    notification_message,
                    JSONB_BUILD_OBJECT(
                        'support_request_id', NEW.id,
                        'support_title', support_title,
                        'action', 'assigned'
                    )
                );
            END IF;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for support requests
DROP TRIGGER IF EXISTS support_request_insert_notification_trigger ON support_requests;
CREATE TRIGGER support_request_insert_notification_trigger
    AFTER INSERT ON support_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_support_request_notification();

DROP TRIGGER IF EXISTS support_request_update_notification_trigger ON support_requests;
CREATE TRIGGER support_request_update_notification_trigger
    AFTER UPDATE ON support_requests
    FOR EACH ROW
    EXECUTE FUNCTION trigger_support_request_notification();

-- Trigger for general table updates (flexible notification system)
CREATE OR REPLACE FUNCTION trigger_generic_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_record RECORD;
    notification_title TEXT;
    notification_message TEXT;
    target_users UUID[];
    user_id UUID;
BEGIN
    -- This function can be configured via a notification_triggers table
    -- to define custom notifications for any table updates
    
    FOR notification_record IN 
        SELECT 
            nt.title_template,
            nt.message_template,
            nt.target_user_query,
            nt.notification_type,
            nt.conditions
        FROM notification_triggers nt
        WHERE nt.table_name = TG_TABLE_NAME
        AND nt.operation = TG_OP
        AND nt.is_active = true
    LOOP
        -- Check if conditions are met (basic JSON condition checking)
        -- This is a simplified implementation - you might want more sophisticated condition checking
        IF notification_record.conditions IS NULL OR 
           (notification_record.conditions ? 'always' AND (notification_record.conditions->>'always')::boolean) THEN
            
            -- Generate title and message from templates
            notification_title := notification_record.title_template;
            notification_message := notification_record.message_template;
            
            -- Replace placeholders in templates with actual values
            -- This is a basic implementation - extend as needed
            notification_title := REPLACE(notification_title, '{table_name}', TG_TABLE_NAME);
            notification_message := REPLACE(notification_message, '{table_name}', TG_TABLE_NAME);
            notification_message := REPLACE(notification_message, '{operation}', TG_OP);
            
            -- Execute target user query to get recipients
            -- Note: This requires careful security consideration
            -- Consider using predefined queries instead of dynamic SQL
            
            -- For now, use a simple approach based on notification type
            CASE notification_record.notification_type
                WHEN 'all_users' THEN
                    SELECT ARRAY_AGG(id) INTO target_users FROM auth.users;
                WHEN 'admin_users' THEN
                    SELECT ARRAY_AGG(u.id) INTO target_users 
                    FROM auth.users u 
                    JOIN profiles p ON p.id = u.id 
                    WHERE p.role = 'admin';
                ELSE
                    target_users := ARRAY[]::UUID[];
            END CASE;
            
            -- Queue notifications for target users
            IF target_users IS NOT NULL THEN
                FOREACH user_id IN ARRAY target_users
                LOOP
                    PERFORM queue_notification(
                        user_id,
                        'system_announcement',
                        notification_title,
                        notification_message,
                        JSONB_BUILD_OBJECT(
                            'table_name', TG_TABLE_NAME,
                            'operation', TG_OP,
                            'trigger_time', NOW()
                        )
                    );
                END LOOP;
            END IF;
        END IF;
    END LOOP;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Table to configure generic notifications
CREATE TABLE IF NOT EXISTS notification_triggers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    notification_type TEXT NOT NULL,
    title_template TEXT NOT NULL,
    message_template TEXT NOT NULL,
    target_user_query TEXT,
    conditions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add RLS policy for notification_triggers
ALTER TABLE notification_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_triggers_admin_access" ON notification_triggers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role IN ('admin', 'support_agent')
        )
    );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_triggers TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Insert some example notification triggers
INSERT INTO notification_triggers (table_name, operation, notification_type, title_template, message_template) VALUES
('profiles', 'UPDATE', 'admin_users', 'Profile Updated', 'A user profile has been updated in the system'),
('support_requests', 'INSERT', 'admin_users', 'New Support Request', 'A new support request has been submitted'),
('activities', 'INSERT', 'all_users', 'New Activity', 'A new activity has been created');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notification_triggers_table_operation ON notification_triggers(table_name, operation);
CREATE INDEX IF NOT EXISTS idx_notification_triggers_active ON notification_triggers(is_active) WHERE is_active = true;

-- Update timestamp function for notification_triggers
CREATE OR REPLACE FUNCTION update_notification_triggers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_triggers_updated_at_trigger ON notification_triggers;
CREATE TRIGGER notification_triggers_updated_at_trigger
    BEFORE UPDATE ON notification_triggers
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_triggers_updated_at();

-- Comments for documentation
COMMENT ON TABLE notification_triggers IS 'Configuration table for automatic notification generation based on database changes';
COMMENT ON FUNCTION trigger_new_message_notification() IS 'Automatically creates notifications when new chat messages are inserted';
COMMENT ON FUNCTION trigger_activity_status_notification() IS 'Automatically creates notifications when activity status changes';
COMMENT ON FUNCTION trigger_support_request_notification() IS 'Automatically creates notifications for support request updates';
COMMENT ON FUNCTION trigger_generic_notification() IS 'Configurable notification system for any table changes based on notification_triggers configuration';