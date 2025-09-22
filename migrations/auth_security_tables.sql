-- Enhanced Authentication Security Tables
-- Run this migration in your Supabase SQL editor

-- 1. Auth Sessions Table
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_info TEXT NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_cleanup ON auth_sessions(expires_at) WHERE is_active = FALSE;

-- 2. Blacklisted Tokens Table
CREATE TABLE IF NOT EXISTS blacklisted_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jti TEXT NOT NULL UNIQUE, -- JWT ID
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    blacklisted_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT NOT NULL DEFAULT 'logout'
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_jti ON blacklisted_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_user_id ON blacklisted_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_cleanup ON blacklisted_tokens(expires_at);

-- 3. Login Attempts Table
CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    failure_reason TEXT
);

-- Index for performance and security queries
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_ip ON login_attempts(email, ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup ON login_attempts(attempted_at);

-- 4. Password History Table (for preventing password reuse)
CREATE TABLE IF NOT EXISTS password_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id, created_at);

-- 5. Two-Factor Authentication Table
CREATE TABLE IF NOT EXISTS user_2fa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT[], -- Array of backup codes
    is_enabled BOOLEAN DEFAULT FALSE,
    enabled_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_2fa_user_id ON user_2fa(user_id);

-- 6. Security Events Table (for audit logging)
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, -- 'login', 'logout', 'password_change', 'account_locked', etc.
    ip_address INET NOT NULL,
    user_agent TEXT NOT NULL,
    details JSONB,
    severity TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance and security monitoring
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_cleanup ON security_events(created_at);

-- 7. Account Lockouts Table
CREATE TABLE IF NOT EXISTS account_lockouts (
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

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_account_lockouts_email_ip ON account_lockouts(email, ip_address, is_active);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_user_id ON account_lockouts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_cleanup ON account_lockouts(locked_until) WHERE is_active = FALSE;

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklisted_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_2fa ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_lockouts ENABLE ROW LEVEL SECURITY;

-- Auth Sessions Policies
CREATE POLICY "Users can view their own sessions" ON auth_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON auth_sessions
    FOR UPDATE USING (auth.uid() = user_id);

-- Blacklisted Tokens Policies (Admin only)
CREATE POLICY "Service role can manage blacklisted tokens" ON blacklisted_tokens
    FOR ALL USING (auth.role() = 'service_role');

-- Login Attempts Policies (Admin only for security)
CREATE POLICY "Service role can manage login attempts" ON login_attempts
    FOR ALL USING (auth.role() = 'service_role');

-- Password History Policies
CREATE POLICY "Users can view their password history" ON password_history
    FOR SELECT USING (auth.uid() = user_id);

-- 2FA Policies
CREATE POLICY "Users can manage their own 2FA" ON user_2fa
    FOR ALL USING (auth.uid() = user_id);

-- Security Events Policies
CREATE POLICY "Users can view their own security events" ON security_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage security events" ON security_events
    FOR ALL USING (auth.role() = 'service_role');

-- Account Lockouts Policies (Admin only)
CREATE POLICY "Service role can manage account lockouts" ON account_lockouts
    FOR ALL USING (auth.role() = 'service_role');

-- Functions for cleanup and maintenance

-- Function to clean up expired sessions
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

-- Create a scheduled job to run cleanup (if pg_cron is available)
-- SELECT cron.schedule('cleanup-auth-data', '0 2 * * *', 'SELECT cleanup_expired_auth_data();');

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON auth_sessions TO authenticated;
GRANT SELECT ON user_2fa TO authenticated;
GRANT SELECT ON security_events TO authenticated;
