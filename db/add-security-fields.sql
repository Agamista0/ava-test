-- Add security-related fields to profiles table
-- Run this migration to add account status and 2FA support

-- Add new columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active' CHECK (account_status IN ('active', 'inactive', 'suspended')),
ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT false;

-- Update existing users to have proper security defaults
UPDATE profiles 
SET 
  account_status = 'active',
  two_factor_enabled = false
WHERE account_status IS NULL OR two_factor_enabled IS NULL;

-- Add index for account status queries
CREATE INDEX IF NOT EXISTS idx_profiles_account_status ON profiles(account_status);