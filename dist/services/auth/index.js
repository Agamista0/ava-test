"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const supabase_1 = require("@/lib/supabase");
class AuthService {
    /**
     * Generate a secure JWT token with enhanced security features
     */
    static generateTokens(userId, role, sessionId) {
        const jwtId = crypto_1.default.randomUUID();
        const payload = {
            sub: userId,
            role,
            sessionId,
            jti: jwtId
        };
        const accessToken = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, {
            expiresIn: this.ACCESS_TOKEN_EXPIRY,
            issuer: 'ava-chat-system',
            audience: 'ava-chat-users',
            algorithm: 'HS256'
        });
        const refreshPayload = {
            sub: userId,
            sessionId,
            type: 'refresh',
            jti: crypto_1.default.randomUUID()
        };
        const refreshToken = jsonwebtoken_1.default.sign(refreshPayload, process.env.JWT_SECRET, {
            expiresIn: this.REFRESH_TOKEN_EXPIRY,
            issuer: 'ava-chat-system',
            audience: 'ava-chat-users',
            algorithm: 'HS256'
        });
        return { accessToken, refreshToken, jwtId };
    }
    /**
     * Verify and decode JWT token with blacklist checking
     */
    static async verifyToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET, {
                issuer: 'ava-chat-system',
                audience: 'ava-chat-users',
                algorithms: ['HS256']
            });
            // Check if token is blacklisted
            if (decoded.jti && await this.isTokenBlacklisted(decoded.jti)) {
                return null;
            }
            // Check if session is still active
            if (decoded.sessionId && !await this.isSessionActive(decoded.sessionId)) {
                return null;
            }
            return decoded;
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Create a new authentication session
     */
    static async createSession(userId, ipAddress, userAgent) {
        const sessionId = crypto_1.default.randomUUID();
        const expiresAt = new Date(Date.now() + this.SESSION_EXPIRY).toISOString();
        const { error } = await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .insert({
            id: sessionId,
            user_id: userId,
            device_info: this.extractDeviceInfo(userAgent),
            ip_address: ipAddress,
            user_agent: userAgent,
            expires_at: expiresAt,
            is_active: true
        });
        if (error) {
            throw new Error(`Failed to create session: ${error.message}`);
        }
        return sessionId;
    }
    /**
     * Update session activity
     */
    static async updateSessionActivity(sessionId) {
        await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .update({
            last_activity: new Date().toISOString()
        })
            .eq('id', sessionId)
            .eq('is_active', true);
    }
    /**
     * Check if session is active
     */
    static async isSessionActive(sessionId) {
        const { data, error } = await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .select('is_active, expires_at')
            .eq('id', sessionId)
            .single();
        if (error || !data)
            return false;
        const isExpired = new Date(data.expires_at) < new Date();
        return data.is_active && !isExpired;
    }
    /**
     * Invalidate a session (logout)
     */
    static async invalidateSession(sessionId) {
        await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .update({ is_active: false })
            .eq('id', sessionId);
    }
    /**
     * Invalidate all sessions for a user
     */
    static async invalidateAllUserSessions(userId) {
        await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .update({ is_active: false })
            .eq('user_id', userId);
    }
    /**
     * Blacklist a token
     */
    static async blacklistToken(jti, userId, expiresAt, reason = 'logout') {
        await supabase_1.supabaseAdmin
            .from('blacklisted_tokens')
            .insert({
            jti,
            user_id: userId,
            expires_at: expiresAt.toISOString(),
            reason
        });
    }
    /**
     * Check if token is blacklisted
     */
    static async isTokenBlacklisted(jti) {
        const { data, error } = await supabase_1.supabaseAdmin
            .from('blacklisted_tokens')
            .select('jti')
            .eq('jti', jti)
            .single();
        return !error && !!data;
    }
    /**
     * Log login attempt
     */
    static async logLoginAttempt(email, ipAddress, userAgent, success, failureReason) {
        await supabase_1.supabaseAdmin
            .from('login_attempts')
            .insert({
            email,
            ip_address: ipAddress,
            user_agent: userAgent,
            success,
            failure_reason: failureReason
        });
    }
    /**
     * Check if account is locked due to failed attempts
     */
    static async isAccountLocked(email, ipAddress) {
        const cutoffTime = new Date(Date.now() - this.LOCKOUT_DURATION).toISOString();
        const { data, error } = await supabase_1.supabaseAdmin
            .from('login_attempts')
            .select('success')
            .eq('email', email)
            .eq('ip_address', ipAddress)
            .gte('attempted_at', cutoffTime)
            .order('attempted_at', { ascending: false })
            .limit(this.MAX_FAILED_ATTEMPTS);
        if (error || !data)
            return false;
        // Check if we have max failed attempts with no successful login
        const failedAttempts = data.filter(attempt => !attempt.success);
        return failedAttempts.length >= this.MAX_FAILED_ATTEMPTS;
    }
    /**
     * Get user sessions
     */
    static async getUserSessions(userId) {
        const { data, error } = await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('last_activity', { ascending: false });
        if (error) {
            throw new Error(`Failed to fetch sessions: ${error.message}`);
        }
        return data || [];
    }
    /**
     * Clean up expired tokens and sessions
     */
    static async cleanupExpired() {
        const now = new Date().toISOString();
        // Clean up expired sessions
        await supabase_1.supabaseAdmin
            .from('auth_sessions')
            .update({ is_active: false })
            .lt('expires_at', now);
        // Clean up expired blacklisted tokens
        await supabase_1.supabaseAdmin
            .from('blacklisted_tokens')
            .delete()
            .lt('expires_at', now);
        // Clean up old login attempts (keep for 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase_1.supabaseAdmin
            .from('login_attempts')
            .delete()
            .lt('attempted_at', thirtyDaysAgo);
    }
    /**
     * Extract device information from user agent
     */
    static extractDeviceInfo(userAgent) {
        // Simple device detection - in production, use a proper library
        if (userAgent.includes('Mobile'))
            return 'Mobile';
        if (userAgent.includes('Tablet'))
            return 'Tablet';
        if (userAgent.includes('Windows'))
            return 'Windows';
        if (userAgent.includes('Mac'))
            return 'Mac';
        if (userAgent.includes('Linux'))
            return 'Linux';
        return 'Unknown';
    }
    /**
     * Generate secure password hash
     */
    static generatePasswordHash(password) {
        const salt = crypto_1.default.randomBytes(32).toString('hex');
        const hash = crypto_1.default.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
        return `${salt}:${hash}`;
    }
    /**
     * Verify password hash
     */
    static verifyPassword(password, hashedPassword) {
        const [salt, hash] = hashedPassword.split(':');
        const verifyHash = crypto_1.default.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
        return hash === verifyHash;
    }
    /**
     * Log security event
     */
    static async logSecurityEvent(userId, eventType, ipAddress, userAgent, details, severity = 'info') {
        try {
            await supabase_1.supabaseAdmin
                .from('security_events')
                .insert({
                user_id: userId,
                event_type: eventType,
                ip_address: ipAddress,
                user_agent: userAgent,
                details: details ? JSON.stringify(details) : null,
                severity
            });
        }
        catch (error) {
            console.error('Failed to log security event:', error);
        }
    }
}
exports.AuthService = AuthService;
AuthService.ACCESS_TOKEN_EXPIRY = '1h';
AuthService.REFRESH_TOKEN_EXPIRY = '7d';
AuthService.SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
AuthService.MAX_FAILED_ATTEMPTS = 5;
AuthService.LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes in ms
//# sourceMappingURL=index.js.map