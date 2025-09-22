import { Router, Response } from 'express'
import { body } from 'express-validator'
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib'
import { AuthService } from '@/services/auth'
import { TwoFAService } from '@/services/auth/twofa'
import {
  validateName,
  handleValidationErrors
} from '@/middleware/security'

const router = Router()


router.get('/profile', [
  authenticateUser
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    // Get user profile from database
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        email,
        name,
        role,
        avatar_url,
        phone,
        department,
        created_at,
        updated_at,
        last_login_at,
        is_active,
        is_verified,
        preferences
      `)
      .eq('id', req.user.id)
      .single()

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    // Get 2FA status
    const is2FAEnabled = await TwoFAService.is2FAEnabled(req.user.id)
    const twoFAConfig = await TwoFAService.get2FAConfig(req.user.id)

    // Get active sessions count
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('auth_sessions')
      .select('id, device_info, ip_address, created_at, last_activity')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .order('last_activity', { ascending: false })

    res.json({
      success: true,
      data: {
        profile: {
          ...profile,
          twoFA: {
            enabled: is2FAEnabled,
            enabledAt: twoFAConfig?.enabledAt || null
          }
        },
        security: {
          activeSessions: sessions?.length || 0,
          sessions: sessions || []
        }
      }
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

// Update user profile information

router.put('/profile', [
  authenticateUser,
  body('name').optional().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('phone').optional().isMobilePhone('any').withMessage('Invalid phone number'),
  body('department').optional().isLength({ max: 100 }).withMessage('Department must be max 100 characters'),
  body('preferences').optional().isObject().withMessage('Preferences must be an object'),
  handleValidationErrors
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { name, phone, department, preferences } = req.body
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    // Only update provided fields
    if (name !== undefined) updateData.name = name
    if (phone !== undefined) updateData.phone = phone
    if (department !== undefined) updateData.department = department
    if (preferences !== undefined) updateData.preferences = preferences

    // Update profile
    const { data: updatedProfile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single()

    if (error) {
      console.error('Profile update error:', error)
      return res.status(400).json({ error: 'Failed to update profile' })
    }

    // Log security event
    await AuthService.logSecurityEvent(
      req.user.id,
      'profile_updated',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      { updated_fields: Object.keys(updateData) },
      'info'
    )

    res.json({
      success: true,
      data: {
        profile: updatedProfile
      },
      message: 'Profile updated successfully'
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Get user's active sessions

router.get('/sessions', [
  authenticateUser
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { data: sessions, error } = await supabaseAdmin
      .from('auth_sessions')
      .select(`
        id,
        device_info,
        ip_address,
        user_agent,
        created_at,
        last_activity,
        expires_at,
        is_active
      `)
      .eq('user_id', req.user.id)
      .order('last_activity', { ascending: false })

    if (error) {
      return res.status(500).json({ error: 'Failed to get sessions' })
    }

    // Mark current session
    const currentSessionId = req.sessionId
    const sessionsWithCurrent = sessions.map(session => ({
      ...session,
      isCurrent: session.id === currentSessionId
    }))

    res.json({
      success: true,
      data: {
        sessions: sessionsWithCurrent
      }
    })
  } catch (error) {
    console.error('Get sessions error:', error)
    res.status(500).json({ error: 'Failed to get sessions' })
  }
})

 // Revoke a specific session

router.delete('/sessions/:sessionId', [
  authenticateUser
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { sessionId } = req.params

    // Don't allow revoking current session via this endpoint
    if (sessionId === req.sessionId) {
      return res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' })
    }

    // Revoke the session
    const { error } = await supabaseAdmin
      .from('auth_sessions')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('user_id', req.user.id)

    if (error) {
      return res.status(400).json({ error: 'Failed to revoke session' })
    }

    // Log security event
    await AuthService.logSecurityEvent(
      req.user.id,
      'session_revoked',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      { revoked_session_id: sessionId },
      'info'
    )

    res.json({
      success: true,
      message: 'Session revoked successfully'
    })
  } catch (error) {
    console.error('Revoke session error:', error)
    res.status(500).json({ error: 'Failed to revoke session' })
  }
})

// Revoke all sessions except current one

router.post('/revoke-all-sessions', [
  authenticateUser
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    // Revoke all sessions except current one
    const { error } = await supabaseAdmin
      .from('auth_sessions')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', req.user.id)
      .neq('id', req.sessionId || '')

    if (error) {
      return res.status(500).json({ error: 'Failed to revoke sessions' })
    }

    // Log security event
    await AuthService.logSecurityEvent(
      req.user.id,
      'all_sessions_revoked',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      { current_session_id: req.sessionId },
      'info'
    )

    res.json({
      success: true,
      message: 'All other sessions have been revoked'
    })
  } catch (error) {
    console.error('Revoke all sessions error:', error)
    res.status(500).json({ error: 'Failed to revoke sessions' })
  }
})

export default router
