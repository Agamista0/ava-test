import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import { Router } from 'express'
import { AuthService } from '@/services/auth'

const router = Router()

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body
  const ipAddress = req.ip || 'unknown'
  const userAgent = req.get('User-Agent') || 'unknown'

  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refresh token' })
  }

  try {
    // Verify refresh token
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET!, {
      issuer: 'ava-chat-system',
      audience: 'ava-chat-users',
      algorithms: ['HS256']
    }) as any

    // Check if refresh token is blacklisted
    if (payload.jti && await AuthService.isTokenBlacklisted(payload.jti)) {
      await AuthService.logSecurityEvent(
        payload.sub,
        'refresh_token_blacklisted',
        ipAddress,
        userAgent,
        { jti: payload.jti },
        'warning'
      )
      return res.status(401).json({ error: 'Token has been revoked' })
    }

    // Check if session is still active
    if (payload.sessionId && !await AuthService.isSessionActive(payload.sessionId)) {
      await AuthService.logSecurityEvent(
        payload.sub,
        'refresh_token_inactive_session',
        ipAddress,
        userAgent,
        { sessionId: payload.sessionId },
        'warning'
      )
      return res.status(401).json({ error: 'Session has expired' })
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', payload.sub)
      .single()

    if (profileError || !profile) {
      await AuthService.logSecurityEvent(
        payload.sub,
        'refresh_token_profile_not_found',
        ipAddress,
        userAgent,
        { error: profileError?.message },
        'warning'
      )
      return res.status(401).json({ error: 'Profile not found' })
    }

    // Generate new access token
    const { accessToken } = AuthService.generateTokens(
      payload.sub,
      profile.role,
      payload.sessionId
    )

    // Update session activity
    if (payload.sessionId) {
      await AuthService.updateSessionActivity(payload.sessionId)
    }

    // Log successful token refresh
    await AuthService.logSecurityEvent(
      payload.sub,
      'token_refreshed',
      ipAddress,
      userAgent,
      { sessionId: payload.sessionId },
      'info'
    )

    res.json({ accessToken })
  } catch (err) {
    await AuthService.logSecurityEvent(
      null,
      'refresh_token_invalid',
      ipAddress,
      userAgent,
      { error: err instanceof Error ? err.message : 'Unknown error' },
      'warning'
    )
    return res.status(401).json({ error: 'Invalid or expired refresh token' })
  }
})

export default router