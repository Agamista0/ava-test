import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export interface TokenPayload {
  sub: string
  role: 'user' | 'support'
  sessionId: string
  iat?: number
  exp?: number
  jti?: string // JWT ID for blacklisting
}

export interface AuthSession {
  id: string
  user_id: string
  device_info: string
  ip_address: string
  user_agent: string
  created_at: string
  last_activity: string
  expires_at: string
  is_active: boolean
}

export interface LoginAttempt {
  id: string
  email: string
  ip_address: string
  user_agent: string
  success: boolean
  attempted_at: string
  failure_reason?: string
}

export interface BlacklistedToken {
  jti: string
  user_id: string
  expires_at: string
  blacklisted_at: string
  reason: string
}

export class AuthService {
  private static readonly ACCESS_TOKEN_EXPIRY = '1h'
  private static readonly REFRESH_TOKEN_EXPIRY = '7d'
  private static readonly SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  private static readonly MAX_FAILED_ATTEMPTS = 5
  private static readonly LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes in ms

  /**
   * Generate a secure JWT token with enhanced security features
   */
  static generateTokens(userId: string, role: 'user' | 'support', sessionId: string) {
    const jwtId = crypto.randomUUID()
    
    const payload: TokenPayload = {
      sub: userId,
      role,
      sessionId,
      jti: jwtId
    }

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
      issuer: 'ava-chat-system',
      audience: 'ava-chat-users',
      algorithm: 'HS256'
    })

    const refreshPayload = {
      sub: userId,
      sessionId,
      type: 'refresh',
      jti: crypto.randomUUID()
    }

    const refreshToken = jwt.sign(refreshPayload, process.env.JWT_SECRET!, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
      issuer: 'ava-chat-system',
      audience: 'ava-chat-users',
      algorithm: 'HS256'
    })

    return { accessToken, refreshToken, jwtId }
  }

  /**
   * Verify and decode JWT token with blacklist checking
   */
  static async verifyToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
        issuer: 'ava-chat-system',
        audience: 'ava-chat-users',
        algorithms: ['HS256']
      }) as TokenPayload

      // Check if token is blacklisted
      if (decoded.jti && await this.isTokenBlacklisted(decoded.jti)) {
        return null
      }

      // Check if session is still active
      if (decoded.sessionId && !await this.isSessionActive(decoded.sessionId)) {
        return null
      }

      return decoded
    } catch (error) {
      return null
    }
  }

  /**
   * Create a new authentication session
   */
  static async createSession(
    userId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<string> {
    const sessionId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + this.SESSION_EXPIRY).toISOString()

    const { error } = await supabaseAdmin
      .from('auth_sessions')
      .insert({
        id: sessionId,
        user_id: userId,
        device_info: this.extractDeviceInfo(userAgent),
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
        is_active: true
      })

    if (error) {
      throw new Error(`Failed to create session: ${error.message}`)
    }

    return sessionId
  }

  /**
   * Update session activity
   */
  static async updateSessionActivity(sessionId: string): Promise<void> {
    await supabaseAdmin
      .from('auth_sessions')
      .update({
        last_activity: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('is_active', true)
  }

  /**
   * Check if session is active
   */
  static async isSessionActive(sessionId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('auth_sessions')
      .select('is_active, expires_at')
      .eq('id', sessionId)
      .single()

    if (error || !data) return false

    const isExpired = new Date(data.expires_at) < new Date()
    return data.is_active && !isExpired
  }

  /**
   * Invalidate a session (logout)
   */
  static async invalidateSession(sessionId: string): Promise<void> {
    await supabaseAdmin
      .from('auth_sessions')
      .update({ is_active: false })
      .eq('id', sessionId)
  }

  /**
   * Invalidate all sessions for a user
   */
  static async invalidateAllUserSessions(userId: string): Promise<void> {
    await supabaseAdmin
      .from('auth_sessions')
      .update({ is_active: false })
      .eq('user_id', userId)
  }

  /**
   * Blacklist a token
   */
  static async blacklistToken(
    jti: string,
    userId: string,
    expiresAt: Date,
    reason: string = 'logout'
  ): Promise<void> {
    await supabaseAdmin
      .from('blacklisted_tokens')
      .insert({
        jti,
        user_id: userId,
        expires_at: expiresAt.toISOString(),
        reason
      })
  }

  /**
   * Check if token is blacklisted
   */
  static async isTokenBlacklisted(jti: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('blacklisted_tokens')
      .select('jti')
      .eq('jti', jti)
      .single()

    return !error && !!data
  }

  /**
   * Log login attempt
   */
  static async logLoginAttempt(
    email: string,
    ipAddress: string,
    userAgent: string,
    success: boolean,
    failureReason?: string
  ): Promise<void> {
    await supabaseAdmin
      .from('login_attempts')
      .insert({
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
        success,
        failure_reason: failureReason
      })
  }

  /**
   * Check if account is locked due to failed attempts
   */
  static async isAccountLocked(email: string, ipAddress: string): Promise<boolean> {
    const cutoffTime = new Date(Date.now() - this.LOCKOUT_DURATION).toISOString()

    const { data, error } = await supabaseAdmin
      .from('login_attempts')
      .select('success')
      .eq('email', email)
      .eq('ip_address', ipAddress)
      .gte('attempted_at', cutoffTime)
      .order('attempted_at', { ascending: false })
      .limit(this.MAX_FAILED_ATTEMPTS)

    if (error || !data) return false

    // Check if we have max failed attempts with no successful login
    const failedAttempts = data.filter(attempt => !attempt.success)
    return failedAttempts.length >= this.MAX_FAILED_ATTEMPTS
  }

  /**
   * Get user sessions
   */
  static async getUserSessions(userId: string): Promise<AuthSession[]> {
    const { data, error } = await supabaseAdmin
      .from('auth_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('last_activity', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch sessions: ${error.message}`)
    }

    return data || []
  }

  /**
   * Clean up expired tokens and sessions
   */
  static async cleanupExpired(): Promise<void> {
    const now = new Date().toISOString()

    // Clean up expired sessions
    await supabaseAdmin
      .from('auth_sessions')
      .update({ is_active: false })
      .lt('expires_at', now)

    // Clean up expired blacklisted tokens
    await supabaseAdmin
      .from('blacklisted_tokens')
      .delete()
      .lt('expires_at', now)

    // Clean up old login attempts (keep for 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin
      .from('login_attempts')
      .delete()
      .lt('attempted_at', thirtyDaysAgo)
  }

  /**
   * Extract device information from user agent
   */
  private static extractDeviceInfo(userAgent: string): string {
    // Simple device detection - in production, use a proper library
    if (userAgent.includes('Mobile')) return 'Mobile'
    if (userAgent.includes('Tablet')) return 'Tablet'
    if (userAgent.includes('Windows')) return 'Windows'
    if (userAgent.includes('Mac')) return 'Mac'
    if (userAgent.includes('Linux')) return 'Linux'
    return 'Unknown'
  }

  /**
   * Generate secure password hash
   */
  static generatePasswordHash(password: string): string {
    const salt = crypto.randomBytes(32).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
    return `${salt}:${hash}`
  }

  /**
   * Verify password hash
   */
  static verifyPassword(password: string, hashedPassword: string): boolean {
    const [salt, hash] = hashedPassword.split(':')
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
    return hash === verifyHash
  }

  /**
   * Log security event
   */
  static async logSecurityEvent(
    userId: string | null,
    eventType: string,
    ipAddress: string,
    userAgent: string,
    details?: any,
    severity: string = 'info'
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('security_events')
        .insert({
          user_id: userId,
          event_type: eventType,
          ip_address: ipAddress,
          user_agent: userAgent,
          details: details ? JSON.stringify(details) : null,
          severity
        })
    } catch (error) {
      console.error('Failed to log security event:', error)
    }
  }
}
