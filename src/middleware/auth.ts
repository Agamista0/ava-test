import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib'
import { AuthService, TokenPayload } from '@/services/auth'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email?: string
    name?: string
    [key: string]: any
  }
  tokenPayload?: TokenPayload
  sessionId?: string
}

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.tokenPayload || !roles.includes(req.tokenPayload.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No valid authorization header' })
      return
    }

    const token = authHeader.substring(7) // Remove "Bearer " prefix

    // Verify the JWT token using enhanced AuthService
    const tokenPayload = await AuthService.verifyToken(token)

    if (!tokenPayload) {
      // Log failed authentication attempt
      await AuthService.logSecurityEvent(
        null,
        'failed_token_verification',
        req.ip || 'unknown',
        req.get('User-Agent') || 'unknown',
        { token_prefix: token.substring(0, 10) + '...' },
        'warning'
      )
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }

    // Get user data from Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(tokenPayload.sub)

    if (error || !user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    // Update session activity
    if (tokenPayload.sessionId) {
      await AuthService.updateSessionActivity(tokenPayload.sessionId)
    }

    req.user = user
    req.tokenPayload = tokenPayload
    req.sessionId = tokenPayload.sessionId
    next()
  } catch (error) {
    console.error('Authentication error:', error)
    res.status(401).json({ error: 'Authentication failed' })
  }
}

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const tokenPayload = await AuthService.verifyToken(token)

      if (tokenPayload) {
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(tokenPayload.sub)
        if (user) {
          req.user = user
          req.tokenPayload = tokenPayload
          req.sessionId = tokenPayload.sessionId

          // Update session activity
          if (tokenPayload.sessionId) {
            await AuthService.updateSessionActivity(tokenPayload.sessionId)
          }
        }
      }
    }

    next()
  } catch (error) {
    // Continue without authentication
    next()
  }
}