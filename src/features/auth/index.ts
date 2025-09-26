import { Request, Response, NextFunction } from 'express'
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth'

// Re-export the middleware function as requireAuth for backwards compatibility
export const requireAuth = authenticateUser

// Re-export the type for other modules
export type { AuthenticatedRequest }

export function requireRole(role: 'user' | 'support') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' })
    }
    next()
  }
}
