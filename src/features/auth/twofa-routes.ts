import { Router, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth'
import { TwoFAService } from '@/services/auth/twofa'
import { AuthService } from '@/services/auth'
import {
  authRateLimit,
  handleValidationErrors
} from '@/middleware/security'

const router = Router()

// Validation middleware
const validate2FAToken = [
  body('token')
    .isLength({ min: 6, max: 8 })
    .matches(/^[0-9A-F]+$/i)
    .withMessage('Invalid 2FA token format'),
  handleValidationErrors
]

const validateUserId = [
  body('userId')
    .isUUID()
    .withMessage('Invalid user ID format'),
  handleValidationErrors
]


router.post('/enable-2fa', [
  authenticateUser,
  authRateLimit
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.name  ) {
      return res.status(401).json({ error: 'User not authenticated' })
    }
    

    // Generate 2FA secret and QR code
    const twoFAData = await TwoFAService.generateSecret(req.user.id, req.user.name)

    // Log security event
    await AuthService.logSecurityEvent(
      req.user.id,
      '2fa_setup_initiated',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({
      success: true,
      data: {
        qrCodeUrl: twoFAData.qrCodeUrl,
        backupCodes: twoFAData.backupCodes,
        message: 'Scan the QR code with Google Authenticator and verify with a token to enable 2FA'
      }
    })
  } catch (error) {
    console.error('Enable 2FA error:', error)
    res.status(500).json({ error: 'Failed to generate 2FA setup' })
  }
})


router.post('/verify-2fa', [
  authenticateUser,
  ...validate2FAToken,
  authRateLimit
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { token } = req.body

    // Enable 2FA after successful verification
    const success = await TwoFAService.enable2FA(req.user.id, token)

    if (!success) {
      await AuthService.logSecurityEvent(
        req.user.id,
        '2fa_verification_failed',
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown',
        { token_prefix: token.substring(0, 2) + '...' },
        'warning'
      )
      return res.status(400).json({ error: 'Invalid 2FA token' })
    }

    // Log successful 2FA enablement
    await AuthService.logSecurityEvent(
      req.user.id,
      '2fa_enabled',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({
      success: true,
      message: '2FA has been successfully enabled for your account'
    })
  } catch (error) {
    console.error('Verify 2FA error:', error)
    res.status(500).json({ error: 'Failed to verify 2FA token' })
  }
})


router.post('/disable-2fa', [
  authenticateUser,
  ...validate2FAToken,
  authRateLimit
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { token } = req.body

    // Disable 2FA after successful verification
    const success = await TwoFAService.disable2FA(req.user.id, token)

    if (!success) {
      await AuthService.logSecurityEvent(
        req.user.id,
        '2fa_disable_failed',
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown',
        { token_prefix: token.substring(0, 2) + '...' },
        'warning'
      )
      return res.status(400).json({ error: 'Invalid 2FA token' })
    }

    // Log successful 2FA disablement
    await AuthService.logSecurityEvent(
      req.user.id,
      '2fa_disabled',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({
      success: true,
      message: '2FA has been successfully disabled for your account'
    })
  } catch (error) {
    console.error('Disable 2FA error:', error)
    res.status(500).json({ error: 'Failed to disable 2FA' })
  }
})


router.post('/login-2fa', [
  ...validateUserId,
  ...validate2FAToken,
  authRateLimit
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId, token } = req.body
    const ipAddress = req.ip || 'unknown'
    const userAgent = req.get('User-Agent') || 'unknown'

    // Complete 2FA login
    const result = await AuthService.complete2FALogin(userId, token, ipAddress, userAgent)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      data: {
        accessToken: result.tokens!.accessToken,
        refreshToken: result.tokens!.refreshToken,
        sessionId: result.sessionId
      },
      message: 'Login successful'
    })
  } catch (error) {
    console.error('2FA login error:', error)
    res.status(500).json({ error: 'Failed to complete 2FA login' })
  }
})


router.get('/2fa-status', [
  authenticateUser
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const is2FAEnabled = await TwoFAService.is2FAEnabled(req.user.id)
    const config = await TwoFAService.get2FAConfig(req.user.id)

    res.json({
      success: true,
      data: {
        enabled: is2FAEnabled,
        enabledAt: config?.enabledAt || null
      }
    })
  } catch (error) {
    console.error('2FA status error:', error)
    res.status(500).json({ error: 'Failed to get 2FA status' })
  }
})


router.post('/regenerate-backup-codes', [
  authenticateUser,
  ...validate2FAToken,
  authRateLimit
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const { token } = req.body

    // Regenerate backup codes
    const newBackupCodes = await TwoFAService.regenerateBackupCodes(req.user.id, token)

    if (!newBackupCodes) {
      return res.status(400).json({ error: 'Invalid 2FA token' })
    }

    // Log security event
    await AuthService.logSecurityEvent(
      req.user.id,
      '2fa_backup_codes_regenerated',
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown',
      {},
      'info'
    )

    res.json({
      success: true,
      data: {
        backupCodes: newBackupCodes
      },
      message: 'Backup codes have been regenerated. Store them securely.'
    })
  } catch (error) {
    console.error('Regenerate backup codes error:', error)
    res.status(500).json({ error: 'Failed to regenerate backup codes' })
  }
})

export default router
