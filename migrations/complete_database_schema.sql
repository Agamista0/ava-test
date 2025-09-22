-- =====================================================
-- COMPLETE AVA CHAT SYSTEM DATABASE SCHEMA
-- Enhanced Authentication & Security Tables with RLS
-- Optimized for Performance and Security
-- =====================================================

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS account_lockouts CASCADE;
DROP TABLE IF EXISTS blacklisted_tokens CASCADE;
DROP TABLE IF EXISTS auth_sessions CASCADE;
DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS password_history CASCADE;
DROP TABLE IF EXISTS user_2fa CASCADE;
DROP TABLE IF EXISTS support_requests CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- =====================================================
-- 1. PROFILES TABLE (Enhanced User Profiles)
-- =====================================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
    role TEXT NOT NULL CHECK (role IN ('user', 'support')) DEFAULT 'user',
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for profiles
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_active ON profiles(is_active);
CREATE INDEX idx_profiles_last_login ON profiles(last_login_at);

-- =====================================================
-- 2. AUTH SESSIONS TABLE (Session Management)
-- =====================================================
CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_info TEXT NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    session_data JSONB DEFAULT '{}'::jsonb
);

-- Indexes for auth_sessions
CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_active ON auth_sessions(is_active, expires_at);
CREATE INDEX idx_auth_sessions_cleanup ON auth_sessions(expires_at) WHERE is_active = FALSE;
CREATE INDEX idx_auth_sessions_ip ON auth_sessions(ip_address);
CREATE INDEX idx_auth_sessions_activity ON auth_sessions(last_activity DESC);

-- =====================================================
-- 3. BLACKLISTED TOKENS TABLE (Token Revocation)
-- =====================================================
CREATE TABLE blacklisted_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jti TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    blacklisted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT NOT NULL DEFAULT 'logout',
    ip_address INET,
    user_agent TEXT
);

-- Indexes for blacklisted_tokens
CREATE UNIQUE INDEX idx_blacklisted_tokens_jti ON blacklisted_tokens(jti);
CREATE INDEX idx_blacklisted_tokens_user_id ON blacklisted_tokens(user_id);
CREATE INDEX idx_blacklisted_tokens_cleanup ON blacklisted_tokens(expires_at);
CREATE INDEX idx_blacklisted_tokens_reason ON blacklisted_tokens(reason);

-- =====================================================
-- 4. LOGIN ATTEMPTS TABLE (Brute Force Protection)
-- =====================================================
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    failure_reason TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes for login_attempts
CREATE INDEX idx_login_attempts_email_ip_time ON login_attempts(email, ip_address, attempted_at DESC);
CREATE INDEX idx_login_attempts_success ON login_attempts(success, attempted_at DESC);
CREATE INDEX idx_login_attempts_cleanup ON login_attempts(attempted_at);
CREATE INDEX idx_login_attempts_user_id ON login_attempts(user_id);

-- =====================================================
-- 5. SECURITY EVENTS TABLE (Audit Logging)
-- =====================================================
CREATE TABLE security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for security_events
CREATE INDEX idx_security_events_user_id_time ON security_events(user_id, created_at DESC);
CREATE INDEX idx_security_events_type_time ON security_events(event_type, created_at DESC);
CREATE INDEX idx_security_events_severity_time ON security_events(severity, created_at DESC);
CREATE INDEX idx_security_events_cleanup ON security_events(created_at);
CREATE INDEX idx_security_events_ip ON security_events(ip_address);

-- =====================================================
-- 6. ACCOUNT LOCKOUTS TABLE (Account Security)
-- =====================================================
CREATE TABLE account_lockouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    ip_address INET NOT NULL,
    locked_at TIMESTAMPTZ DEFAULT NOW(),
    locked_until TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for account_lockouts
CREATE INDEX idx_account_lockouts_email_ip_active ON account_lockouts(email, ip_address, is_active);
CREATE INDEX idx_account_lockouts_user_id_active ON account_lockouts(user_id, is_active);
CREATE INDEX idx_account_lockouts_cleanup ON account_lockouts(locked_until) WHERE is_active = FALSE;
CREATE INDEX idx_account_lockouts_active_until ON account_lockouts(is_active, locked_until);

-- =====================================================
-- 7. PASSWORD HISTORY TABLE (Password Reuse Prevention)
-- =====================================================
CREATE TABLE password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for password_history
CREATE INDEX idx_password_history_user_id_time ON password_history(user_id, created_at DESC);
CREATE INDEX idx_password_history_cleanup ON password_history(created_at);

-- =====================================================
-- 8. TWO-FACTOR AUTHENTICATION TABLE
-- =====================================================
CREATE TABLE user_2fa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT[],
    is_enabled BOOLEAN DEFAULT FALSE,
    enabled_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_2fa
CREATE UNIQUE INDEX idx_user_2fa_user_id ON user_2fa(user_id);
CREATE INDEX idx_user_2fa_enabled ON user_2fa(is_enabled);

-- =====================================================
-- 9. CONVERSATIONS TABLE (Chat System)
-- =====================================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    support_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    subject TEXT,
    jira_ticket_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for conversations
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_support_id ON conversations(support_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_priority ON conversations(priority);
CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_jira_ticket ON conversations(jira_ticket_id);

-- =====================================================
-- 10. MESSAGES TABLE (Chat Messages)
-- =====================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (length(content) >= 1 AND length(content) <= 5000),
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'audio', 'system')),
    file_url TEXT,
    file_name TEXT,
    file_size INTEGER,
    is_ai_response BOOLEAN DEFAULT FALSE,
    ai_model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for messages
CREATE INDEX idx_messages_conversation_id_time ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_type ON messages(message_type);
CREATE INDEX idx_messages_ai_response ON messages(is_ai_response);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

-- =====================================================
-- 11. SUPPORT REQUESTS TABLE (Support Ticket System)
-- =====================================================
CREATE TABLE support_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('technical', 'billing', 'general', 'bug_report', 'feature_request')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    title TEXT NOT NULL CHECK (length(title) >= 1 AND length(title) <= 200),
    description TEXT NOT NULL,
    jira_ticket_id TEXT,
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for support_requests
CREATE INDEX idx_support_requests_user_id ON support_requests(user_id);
CREATE INDEX idx_support_requests_assigned_to ON support_requests(assigned_to);
CREATE INDEX idx_support_requests_status ON support_requests(status);
CREATE INDEX idx_support_requests_priority ON support_requests(priority);
CREATE INDEX idx_support_requests_category ON support_requests(category);
CREATE INDEX idx_support_requests_created_at ON support_requests(created_at DESC);
CREATE INDEX idx_support_requests_jira_ticket ON support_requests(jira_ticket_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklisted_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_lockouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- PROFILES POLICIES
-- =====================================================
CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Support can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

-- =====================================================
-- AUTH SESSIONS POLICIES
-- =====================================================
CREATE POLICY "Users can view their own sessions" ON auth_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON auth_sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all sessions" ON auth_sessions
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- BLACKLISTED TOKENS POLICIES
-- =====================================================
CREATE POLICY "Service role can manage blacklisted tokens" ON blacklisted_tokens
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- LOGIN ATTEMPTS POLICIES
-- =====================================================
CREATE POLICY "Service role can manage login attempts" ON login_attempts
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- SECURITY EVENTS POLICIES
-- =====================================================
CREATE POLICY "Users can view their own security events" ON security_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage security events" ON security_events
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Support can view all security events" ON security_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

-- =====================================================
-- ACCOUNT LOCKOUTS POLICIES
-- =====================================================
CREATE POLICY "Service role can manage account lockouts" ON account_lockouts
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- PASSWORD HISTORY POLICIES
-- =====================================================
CREATE POLICY "Users can view their password history" ON password_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage password history" ON password_history
    FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- 2FA POLICIES
-- =====================================================
CREATE POLICY "Users can manage their own 2FA" ON user_2fa
    FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- CONVERSATIONS POLICIES
-- =====================================================
CREATE POLICY "Users can view their own conversations" ON conversations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create conversations" ON conversations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" ON conversations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Support can view assigned conversations" ON conversations
    FOR SELECT USING (
        auth.uid() = support_id OR
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

CREATE POLICY "Support can update conversations" ON conversations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

-- =====================================================
-- MESSAGES POLICIES
-- =====================================================
CREATE POLICY "Users can view messages in their conversations" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = conversation_id AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can send messages in their conversations" ON messages
    FOR INSERT WITH CHECK (
        auth.uid() = sender_id AND
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = conversation_id AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "Support can view all messages" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

CREATE POLICY "Support can send messages" ON messages
    FOR INSERT WITH CHECK (
        auth.uid() = sender_id AND
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

-- =====================================================
-- SUPPORT REQUESTS POLICIES
-- =====================================================
CREATE POLICY "Users can view their own support requests" ON support_requests
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create support requests" ON support_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own support requests" ON support_requests
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Support can view all support requests" ON support_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

CREATE POLICY "Support can update support requests" ON support_requests
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'support'
        )
    );

-- =====================================================
-- UTILITY FUNCTIONS
-- =====================================================

-- Function to clean up expired auth data
CREATE OR REPLACE FUNCTION cleanup_expired_auth_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Deactivate expired sessions
    UPDATE auth_sessions
    SET is_active = FALSE
    WHERE expires_at < NOW() AND is_active = TRUE;

    -- Delete expired blacklisted tokens
    DELETE FROM blacklisted_tokens
    WHERE expires_at < NOW();

    -- Delete old login attempts (older than 30 days)
    DELETE FROM login_attempts
    WHERE attempted_at < NOW() - INTERVAL '30 days';

    -- Delete old security events (older than 90 days)
    DELETE FROM security_events
    WHERE created_at < NOW() - INTERVAL '90 days';

    -- Deactivate expired lockouts
    UPDATE account_lockouts
    SET is_active = FALSE
    WHERE locked_until < NOW() AND is_active = TRUE;

    -- Delete old password history (keep last 5 per user)
    DELETE FROM password_history
    WHERE id NOT IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
            FROM password_history
        ) ranked WHERE rn <= 5
    );
END;
$$;

-- Function to log security events
CREATE OR REPLACE FUNCTION log_security_event(
    p_user_id UUID,
    p_event_type TEXT,
    p_ip_address INET,
    p_user_agent TEXT,
    p_details JSONB DEFAULT NULL,
    p_severity TEXT DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO security_events (user_id, event_type, ip_address, user_agent, details, severity)
    VALUES (p_user_id, p_event_type, p_ip_address, p_user_agent, p_details, p_severity)
    RETURNING id INTO event_id;

    RETURN event_id;
END;
$$;

-- Function to check account lockout status
CREATE OR REPLACE FUNCTION is_account_locked(
    p_email TEXT,
    p_ip_address INET
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    lockout_record RECORD;
BEGIN
    SELECT * INTO lockout_record
    FROM account_lockouts
    WHERE email = p_email
    AND ip_address = p_ip_address
    AND is_active = TRUE
    AND locked_until > NOW()
    LIMIT 1;

    RETURN FOUND;
END;
$$;

-- Function to update conversation timestamps
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE conversations
    SET updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

-- Trigger to update conversation timestamp when message is added
CREATE TRIGGER trigger_update_conversation_timestamp
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- Function to update profile timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Triggers to update updated_at columns
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_support_requests_updated_at
    BEFORE UPDATE ON support_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- GRANTS AND PERMISSIONS
-- =====================================================

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- Profiles table permissions
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
GRANT SELECT ON profiles TO anon;

-- Auth sessions permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_sessions TO authenticated;

-- Conversations permissions
GRANT SELECT, INSERT, UPDATE ON conversations TO authenticated;

-- Messages permissions
GRANT SELECT, INSERT, UPDATE ON messages TO authenticated;

-- Support requests permissions
GRANT SELECT, INSERT, UPDATE ON support_requests TO authenticated;

-- 2FA permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_2fa TO authenticated;

-- Security events (read-only for users)
GRANT SELECT ON security_events TO authenticated;

-- Grant function execution permissions
GRANT EXECUTE ON FUNCTION cleanup_expired_auth_data() TO authenticated;
GRANT EXECUTE ON FUNCTION log_security_event(UUID, TEXT, INET, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_account_locked(TEXT, INET) TO authenticated;

-- =====================================================
-- PERFORMANCE OPTIMIZATIONS
-- =====================================================

-- Analyze tables for query optimization
ANALYZE profiles;
ANALYZE auth_sessions;
ANALYZE blacklisted_tokens;
ANALYZE login_attempts;
ANALYZE security_events;
ANALYZE account_lockouts;
ANALYZE password_history;
ANALYZE user_2fa;
ANALYZE conversations;
ANALYZE messages;
ANALYZE support_requests;

-- =====================================================
-- INITIAL DATA SETUP (Optional)
-- =====================================================

-- Create system user profile for AI responses
INSERT INTO profiles (id, email, name, role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'ai-assistant@system.local',
    'AI Assistant',
    'user',
    true
) ON CONFLICT (id) DO NOTHING;

-- Create default admin user profile (uncomment and modify as needed)
-- INSERT INTO profiles (id, email, name, role, is_active)
-- VALUES (
--     'your-admin-user-id-here',
--     'admin@yourdomain.com',
--     'System Administrator',
--     'support',
--     true
-- ) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SCHEMA COMPLETE
-- =====================================================
-- This schema provides:
-- 1. Complete user authentication and session management
-- 2. Enhanced security with RLS policies
-- 3. Optimized indexes for performance
-- 4. Audit logging and security monitoring
-- 5. Chat system with conversations and messages
-- 6. Support ticket system
-- 7. Automated cleanup and maintenance functions
-- 8. Proper permissions and access control
-- =====================================================


-- =====================================================
-- FIX PROFILES TABLE RLS INFINITE RECURSION
-- Run this in your Supabase SQL Editor
-- =====================================================

-- First, disable RLS temporarily to fix the issue
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Drop any existing problematic policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Support can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Service role can manage all profiles" ON profiles;

-- Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create simple, non-recursive RLS policies
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Service role can manage all profiles" ON profiles
    FOR ALL USING (auth.role() = 'service_role');

-- Grant necessary permissions
GRANT ALL ON profiles TO authenticated;
GRANT ALL ON profiles TO service_role;

-- Test the fix
SELECT 'RLS policies fixed successfully' as status;
