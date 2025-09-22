-- Add voice_url column to messages table if it doesn't exist
-- This ensures the column exists for audio message functionality

DO $$ 
BEGIN 
    -- Check if the column doesn't exist and add it
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'voice_url'
    ) THEN
        ALTER TABLE messages ADD COLUMN voice_url TEXT;
        RAISE NOTICE 'Added voice_url column to messages table';
    ELSE
        RAISE NOTICE 'voice_url column already exists in messages table';
    END IF;
END $$;

-- Also ensure we have file-related columns for future use
DO $$ 
BEGIN 
    -- Add file_url column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'file_url'
    ) THEN
        ALTER TABLE messages ADD COLUMN file_url TEXT;
        RAISE NOTICE 'Added file_url column to messages table';
    END IF;

    -- Add file_name column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'file_name'
    ) THEN
        ALTER TABLE messages ADD COLUMN file_name TEXT;
        RAISE NOTICE 'Added file_name column to messages table';
    END IF;

    -- Add file_size column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' 
        AND column_name = 'file_size'
    ) THEN
        ALTER TABLE messages ADD COLUMN file_size INTEGER;
        RAISE NOTICE 'Added file_size column to messages table';
    END IF;
END $$;

-- Update the message_type constraint to include voice and file types
DO $$
BEGIN
    -- Drop the existing constraint if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'messages' 
        AND constraint_name = 'messages_message_type_check'
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT messages_message_type_check;
    END IF;
    
    -- Add the updated constraint
    ALTER TABLE messages ADD CONSTRAINT messages_message_type_check 
    CHECK (message_type IN ('text', 'voice', 'file', 'system'));
    
    RAISE NOTICE 'Updated message_type constraint to include voice and file types';
END $$;