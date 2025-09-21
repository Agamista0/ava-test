-- Create support_requests table for managing user requests

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create enum for request categories
CREATE TYPE request_category AS ENUM (
  'marketing', 
  'scheduling', 
  'content', 
  'social', 
  'administrative', 
  'other'
);

-- Create enum for request priorities
CREATE TYPE request_priority AS ENUM (
  'low', 
  'medium', 
  'high'
);

-- Create enum for request status
CREATE TYPE request_status AS ENUM (
  'pending',
  'in_progress', 
  'completed',
  'cancelled'
);

-- Create support_requests table
CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category request_category NOT NULL,
  title text NOT NULL CHECK (length(title) >= 5 AND length(title) <= 100),
  description text NOT NULL CHECK (length(description) >= 20 AND length(description) <= 1000),
  priority request_priority NOT NULL DEFAULT 'medium',
  status request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  jira_ticket_id text,
  
  -- Constraints
  CONSTRAINT valid_completion CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR 
    (status != 'completed' AND completed_at IS NULL)
  )
);

-- Create indexes for better performance
CREATE INDEX idx_support_requests_user_id ON support_requests(user_id);
CREATE INDEX idx_support_requests_status ON support_requests(status);
CREATE INDEX idx_support_requests_category ON support_requests(category);
CREATE INDEX idx_support_requests_priority ON support_requests(priority);
CREATE INDEX idx_support_requests_created_at ON support_requests(created_at);
CREATE INDEX idx_support_requests_assigned_to ON support_requests(assigned_to);

-- Create trigger for updated_at
CREATE TRIGGER update_support_requests_updated_at 
  BEFORE UPDATE ON support_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests
CREATE POLICY "Users can view their own support requests" ON support_requests
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own requests
CREATE POLICY "Users can create support requests" ON support_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending requests
CREATE POLICY "Users can update their own pending requests" ON support_requests
  FOR UPDATE USING (
    auth.uid() = user_id AND status = 'pending'
  );

-- Support staff can view all requests
CREATE POLICY "Support can view all requests" ON support_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'support'
    )
  );

-- Support staff can update all requests
CREATE POLICY "Support can update all requests" ON support_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'support'
    )
  );

-- Grant necessary permissions
GRANT ALL ON support_requests TO anon, authenticated;