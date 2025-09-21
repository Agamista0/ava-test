export interface TokenPayload {
    sub: string;
    role: 'user' | 'support';
    sessionId: string;
    iat?: number;
    exp?: number;
    jti?: string;
}
export interface AuthSession {
    id: string;
    user_id: string;
    device_info: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    last_activity: string;
    expires_at: string;
    is_active: boolean;
}
export interface LoginAttempt {
    id: string;
    email: string;
    ip_address: string;
    user_agent: string;
    success: boolean;
    attempted_at: string;
    failure_reason?: string;
}
export interface BlacklistedToken {
    jti: string;
    user_id: string;
    expires_at: string;
    blacklisted_at: string;
    reason: string;
}
export declare class AuthService {
    private static readonly ACCESS_TOKEN_EXPIRY;
    private static readonly REFRESH_TOKEN_EXPIRY;
    private static readonly SESSION_EXPIRY;
    private static readonly MAX_FAILED_ATTEMPTS;
    private static readonly LOCKOUT_DURATION;
    /**
     * Generate a secure JWT token with enhanced security features
     */
    static generateTokens(userId: string, role: 'user' | 'support', sessionId: string): {
        accessToken: string;
        refreshToken: string;
        jwtId: `${string}-${string}-${string}-${string}-${string}`;
    };
    /**
     * Verify and decode JWT token with blacklist checking
     */
    static verifyToken(token: string): Promise<TokenPayload | null>;
    /**
     * Create a new authentication session
     */
    static createSession(userId: string, ipAddress: string, userAgent: string): Promise<string>;
    /**
     * Update session activity
     */
    static updateSessionActivity(sessionId: string): Promise<void>;
    /**
     * Check if session is active
     */
    static isSessionActive(sessionId: string): Promise<boolean>;
    /**
     * Invalidate a session (logout)
     */
    static invalidateSession(sessionId: string): Promise<void>;
    /**
     * Invalidate all sessions for a user
     */
    static invalidateAllUserSessions(userId: string): Promise<void>;
    /**
     * Blacklist a token
     */
    static blacklistToken(jti: string, userId: string, expiresAt: Date, reason?: string): Promise<void>;
    /**
     * Check if token is blacklisted
     */
    static isTokenBlacklisted(jti: string): Promise<boolean>;
    /**
     * Log login attempt
     */
    static logLoginAttempt(email: string, ipAddress: string, userAgent: string, success: boolean, failureReason?: string): Promise<void>;
    /**
     * Check if account is locked due to failed attempts
     */
    static isAccountLocked(email: string, ipAddress: string): Promise<boolean>;
    /**
     * Get user sessions
     */
    static getUserSessions(userId: string): Promise<AuthSession[]>;
    /**
     * Clean up expired tokens and sessions
     */
    static cleanupExpired(): Promise<void>;
    /**
     * Extract device information from user agent
     */
    private static extractDeviceInfo;
    /**
     * Generate secure password hash
     */
    static generatePasswordHash(password: string): string;
    /**
     * Verify password hash
     */
    static verifyPassword(password: string, hashedPassword: string): boolean;
    /**
     * Log security event
     */
    static logSecurityEvent(userId: string | null, eventType: string, ipAddress: string, userAgent: string, details?: any, severity?: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map