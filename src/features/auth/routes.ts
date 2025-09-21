import { Router, Response } from 'express'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from './index'
import { AuthenticatedRequest } from '@/middleware/auth'
import { AuthService } from '@/services/auth'
import {
  authRateLimit,
  validateEmail,
  validatePassword,
  validateName,
  validateRole,
  handleValidationErrors,
  bruteForceProtection
} from '@/middleware/security'

const router = Router()

// Apply auth rate limiting to all routes

// router.use(authRateLimit)

// Register endpoint
router.post('/register', [
  // validateEmail,
  // validatePassword,
  // validateName,
  // validateRole,
  // handleValidationErrors
], async (req: AuthenticatedRequest, res: Response) => {
  const { email, password, name, role, avatar_url } = req.body
  const ipAddress = req.ip || 'unknown'
  const userAgent = req.get('User-Agent') || 'unknown'

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // Create user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (error || !data.user) {
      await AuthService.logSecurityEvent(
        null,
        'registration_failed',
        ipAddress,
        userAgent,
        { email, error: error?.message },
        'warning'
      )
      return res.status(400).json({ error: error?.message || 'User creation failed' })
    }

    // Insert profile
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: data.user.id,
      email,
      role,
      name,
      avatar_url
    })

    if (profileError) {
      // Clean up the created user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(data.user.id)
      return res.status(400).json({ error: profileError.message })
    }

    // Create session
    const sessionId = await AuthService.createSession(data.user.id, ipAddress, userAgent)

    // Generate enhanced JWT tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(
      data.user.id,
      role,
      sessionId
    )

    // Log successful registration
    await AuthService.logSecurityEvent(
      data.user.id,
      'registration_success',
      ipAddress,
      userAgent,
      { sessionId },
      'info'
    )

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        role,
        name
      }
    })
  } catch (error) {
    console.error('Registration error:', error)
    await AuthService.logSecurityEvent(
      null,
      'registration_error',
      ipAddress,
      userAgent,
      { email, error: error instanceof Error ? error.message : 'Unknown error' },
      'critical'
    )
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Login endpoint
router.post('/login', [
  bruteForceProtection,
  validateEmail,
  validatePassword,
  handleValidationErrors
], async (req: AuthenticatedRequest, res: Response) => {
  const { email, password } = req.body
  const ipAddress = req.ip || 'unknown'
  const userAgent = req.get('User-Agent') || 'unknown'

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' })
  }

  try {
    // Check if account is locked
    const isLocked = await AuthService.isAccountLocked(email, ipAddress)
    if (isLocked) {
      await AuthService.logSecurityEvent(
        null,
        'login_attempt_blocked',
        ipAddress,
        userAgent,
        { email, reason: 'account_locked' },
        'warning'
      )
      return res.status(423).json({
        error: 'Account temporarily locked due to multiple failed attempts. Please try again later.'
      })
    }

    // Authenticate with Supabase
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password })

    if (error || !data.user) {
      // Log failed attempt
      await AuthService.logLoginAttempt(email, ipAddress, userAgent, false, error?.message)
      await AuthService.logSecurityEvent(
        null,
        'login_failed',
        ipAddress,
        userAgent,
        { email, error: error?.message },
        'warning'
      )
      return res.status(401).json({ error: error?.message || 'Invalid credentials' })
    }

    // Get profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()

    if (profileError || !profile) {
      await AuthService.logLoginAttempt(email, ipAddress, userAgent, false, 'Profile not found')
      return res.status(401).json({ error: 'Profile not found' })
    }

    // Create session
    const sessionId = await AuthService.createSession(data.user.id, ipAddress, userAgent)

    // Generate enhanced JWT tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(
      data.user.id,
      profile.role,
      sessionId
    )

    // Log successful login
    await AuthService.logLoginAttempt(email, ipAddress, userAgent, true)
    await AuthService.logSecurityEvent(
      data.user.id,
      'login_success',
      ipAddress,
      userAgent,
      { sessionId },
      'info'
    )

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile.role,
        name: profile.name
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    await AuthService.logSecurityEvent(
      null,
      'login_error',
      ipAddress,
      userAgent,
      { email, error: error instanceof Error ? error.message : 'Unknown error' },
      'critical'
    )
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Logout endpoint
router.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]

    if (token && req.tokenPayload) {
      // Blacklist the current token
      if (req.tokenPayload.jti) {
        const expiresAt = new Date(req.tokenPayload.exp! * 1000)
        await AuthService.blacklistToken(
          req.tokenPayload.jti,
          req.tokenPayload.sub,
          expiresAt,
          'logout'
        )
      }

      // Invalidate the session
      if (req.sessionId) {
        await AuthService.invalidateSession(req.sessionId)
      }

      // Log logout event
      await AuthService.logSecurityEvent(
        req.tokenPayload.sub,
        'logout',
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown',
        { sessionId: req.sessionId },
        'info'
      )
    }

    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('Logout error:', error)
    res.status(500).json({ error: 'Logout failed' })
  }
})

// Get profile endpoint
router.get('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user!.sub)
      .single()

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    res.json(profile)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

// Update profile endpoint
router.put('/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, avatar_url } = req.body
    const userId = req.user!.sub

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single()

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    res.json(profile)
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Get user sessions
router.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tokenPayload) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const sessions = await AuthService.getUserSessions(req.tokenPayload.sub)
    res.json({ sessions })
  } catch (error) {
    console.error('Get sessions error:', error)
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// Logout from all devices
router.post('/logout-all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tokenPayload) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Invalidate all user sessions
    await AuthService.invalidateAllUserSessions(req.tokenPayload.sub)

    // Log security event
    await AuthService.logSecurityEvent(
      req.tokenPayload.sub,
      'logout_all_devices',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({ message: 'Logged out from all devices successfully' })
  } catch (error) {
    console.error('Logout all error:', error)
    res.status(500).json({ error: 'Failed to logout from all devices' })
  }
})

// Revoke specific session
router.delete('/sessions/:sessionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tokenPayload) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { sessionId } = req.params

    // Verify the session belongs to the user
    const sessions = await AuthService.getUserSessions(req.tokenPayload.sub)
    const sessionExists = sessions.find(s => s.id === sessionId)

    if (!sessionExists) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Invalidate the session
    await AuthService.invalidateSession(sessionId)

    // Log security event
    await AuthService.logSecurityEvent(
      req.tokenPayload.sub,
      'session_revoked',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      { revokedSessionId: sessionId },
      'info'
    )

    res.json({ message: 'Session revoked successfully' })
  } catch (error) {
    console.error('Revoke session error:', error)
    res.status(500).json({ error: 'Failed to revoke session' })
  }
})

// Change password
router.post('/change-password', [
  requireAuth,
  validatePassword,
  handleValidationErrors
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tokenPayload) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' })
    }

    // Verify current password
    const { data: userData, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(req.tokenPayload.sub)
    if (getUserError || !userData.user) {
      return res.status(401).json({ error: 'User not found' })
    }

    // Verify current password by attempting to sign in
    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: userData.user.email!,
      password: currentPassword
    })

    if (signInError) {
      await AuthService.logSecurityEvent(
        req.tokenPayload.sub,
        'password_change_failed',
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown',
        { reason: 'invalid_current_password' },
        'warning'
      )
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    // Update password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      req.tokenPayload.sub,
      { password: newPassword }
    )

    if (updateError) {
      return res.status(400).json({ error: updateError.message })
    }

    // Invalidate all sessions except current one
    await AuthService.invalidateAllUserSessions(req.tokenPayload.sub)

    // Recreate current session
    if (req.sessionId) {
      await AuthService.createSession(
        req.tokenPayload.sub,
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown'
      )
    }

    // Log security event
    await AuthService.logSecurityEvent(
      req.tokenPayload.sub,
      'password_changed',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

export default router
