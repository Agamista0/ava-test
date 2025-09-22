-- =====================================================
-- FIX SUPPORT REQUESTS CATEGORIES CONSTRAINT
-- Make category, priority, and status fields optional
-- =====================================================

-- Drop existing constraints if they exist
ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_requests_category_check;
ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_requests_priority_check;
ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_requests_status_check;

-- Add optional constraints (allow NULL or specific values)
ALTER TABLE support_requests ADD CONSTRAINT support_requests_category_check 
  CHECK (category IS NULL OR category IN ('marketing', 'scheduling', 'content', 'social', 'administrative', 'other'));

ALTER TABLE support_requests ADD CONSTRAINT support_requests_priority_check 
  CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high'));

ALTER TABLE support_requests ADD CONSTRAINT support_requests_status_check 
  CHECK (status IS NULL OR status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Make columns nullable if they aren't already
ALTER TABLE support_requests ALTER COLUMN category DROP NOT NULL;
ALTER TABLE support_requests ALTER COLUMN priority DROP NOT NULL;
ALTER TABLE support_requests ALTER COLUMN status DROP NOT NULL;

-- Comment for documentation
COMMENT ON CONSTRAINT support_requests_category_check ON support_requests IS 
  'Optional category field: marketing, scheduling, content, social, administrative, other, or NULL';