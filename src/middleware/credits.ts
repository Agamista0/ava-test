import { Request, Response, NextFunction } from 'express'
import { CreditsManager, CreditsCost } from '@/services/credits'

// Extend Request interface to include credits info
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string
        email?: string
        [key: string]: any
      }
      creditsInfo?: {
        hasCredits: boolean
        currentCredits: number
        requiredCredits: number
      }
    }
  }
}

// Middleware to check if user has enough credits for an action
export const requireCredits = (actionType: keyof CreditsCost) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.sub) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        })
      }

      const userId = req.user.sub
      const creditsInfo = await CreditsManager.hasEnoughCredits(userId, actionType)

      // Attach credits info to request for use in route handlers
      req.creditsInfo = creditsInfo

      if (!creditsInfo.hasCredits) {
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits',
          details: {
            required: creditsInfo.requiredCredits,
            available: creditsInfo.currentCredits,
            actionType,
          },
        })
      }

      next()
    } catch (error) {
      console.error('Credits middleware error:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to check credits',
      })
    }
  }
}

/**
 * Middleware to consume credits after successful action
 * This should be used after the main action is completed
 */
export const consumeCredits = (actionType: keyof CreditsCost, description?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.sub) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        })
      }

      const userId = req.user.sub
      const result = await CreditsManager.consumeCredits(userId, actionType, description)

      if (!result.success) {
        return res.status(402).json({
          success: false,
          error: result.error || 'Failed to consume credits',
          remainingCredits: result.remainingCredits,
        })
      }

      // Attach remaining credits to response
      res.locals.remainingCredits = result.remainingCredits

      next()
    } catch (error) {
      console.error('Credits consumption error:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to consume credits',
      })
    }
  }
}

// Middleware to add credits information to response

export const addCreditsInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      return next()
    }

    const userId = req.user.sub
    const creditsSummary = await CreditsManager.getUserCreditsSummary(userId)

    // Add credits info to response locals
    res.locals.creditsInfo = creditsSummary

    next()
  } catch (error) {
    console.error('Credits info middleware error:', error)
    // Don't fail the request, just continue without credits info
    next()
  }
}

// Helper function to include credits info in API responses

export const includeCreditsInResponse = (res: Response, data: any) => {
  const response: any = {
    success: true,
    data,
  }

  // Add credits info if available
  if (res.locals.creditsInfo) {
    response.creditsInfo = res.locals.creditsInfo
  }

  // Add remaining credits if available (after consumption)
  if (res.locals.remainingCredits !== undefined) {
    response.remainingCredits = res.locals.remainingCredits
  }

  return response
}

export default {
  requireCredits,
  consumeCredits,
  addCreditsInfo,
  includeCreditsInResponse,
}
