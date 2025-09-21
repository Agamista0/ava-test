-- Add credits and plan fields to profiles table
-- Run this migration to add credits support

-- Create plan type enum
CREATE TYPE plan_type AS ENUM ('starting', 'scaling', 'summit');

-- Add new columns to profiles table
ALTER TABLE profiles 
ADD COLUMN credits integer DEFAULT 0,
ADD COLUMN max_credits integer DEFAULT 80,
ADD COLUMN plan_type plan_type DEFAULT 'starting',
ADD COLUMN billing_cycle_end timestamptz DEFAULT (now() + interval '1 month');

-- Update existing users to have proper plan data
UPDATE profiles 
SET 
  credits = 0,
  max_credits = 80,
  plan_type = 'starting',
  billing_cycle_end = (now() + interval '1 month')
WHERE credits IS NULL;

-- Add index for plan queries
CREATE INDEX idx_profiles_plan_type ON profiles(plan_type);
CREATE INDEX idx_profiles_billing_cycle ON profiles(billing_cycle_end);