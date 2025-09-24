import { Request, Response, NextFunction } from 'express'
import { StripeService } from '@/services/stripe'

// Extend Request interface to include subscription info and user
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string
        email?: string
        [key: string]: any
      }
      subscriptionInfo?: {
        hasActiveSubscription: boolean
        subscription?: any
        plan?: any
      }
    }
  }
}

// Middleware to check if user has an active subscription

export const requireActiveSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      })
    }

    const userId = req.user.sub
    const subscription = await StripeService.getUserSubscription(userId)

    // Attach subscription info to request
    req.subscriptionInfo = {
      hasActiveSubscription: !!subscription,
      subscription,
    }

    if (!subscription) {
      return res.status(402).json({
        success: false,
        error: 'Active subscription required',
        details: {
          message: 'This feature requires an active subscription',
          availablePlans: await StripeService.getSubscriptionPlans(),
        },
      })
    }

    next()
  } catch (error) {
    console.error('Subscription middleware error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to check subscription status',
    })
  }
}

// Middleware to check if user has a specific plan or higher

export const requirePlan = (requiredPlan: 'starting' | 'scaling' | 'summit') => {
  const planHierarchy = { starting: 1, scaling: 2, summit: 3 }
  
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.sub) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        })
      }

      const userId = req.user.sub
      const subscription = await StripeService.getUserSubscription(userId)

      if (!subscription) {
        return res.status(402).json({
          success: false,
          error: 'Subscription required',
          details: {
            requiredPlan,
            message: `This feature requires ${requiredPlan} plan or higher`,
          },
        })
      }

      // Get plan details
      const plan = await StripeService.getSubscriptionPlanByPriceId(
        subscription.plan_id // This should be the price ID, need to adjust the schema
      )

      if (!plan) {
        return res.status(500).json({
          success: false,
          error: 'Invalid subscription plan',
        })
      }

      const userPlanLevel = planHierarchy[plan.plan_name as keyof typeof planHierarchy]
      const requiredPlanLevel = planHierarchy[requiredPlan]

      if (userPlanLevel < requiredPlanLevel) {
        return res.status(402).json({
          success: false,
          error: 'Plan upgrade required',
          details: {
            currentPlan: plan.plan_name,
            requiredPlan,
            message: `This feature requires ${requiredPlan} plan or higher. You currently have ${plan.plan_name} plan.`,
          },
        })
      }

      // Attach plan info to request
      req.subscriptionInfo = {
        hasActiveSubscription: true,
        subscription,
        plan,
      }

      next()
    } catch (error) {
      console.error('Plan requirement middleware error:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to check plan requirements',
      })
    }
  }
}

// Middleware to add subscription information to response

export const addSubscriptionInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.sub) {
      return next()
    }

    const userId = req.user.sub
    const [subscription, credits] = await Promise.all([
      StripeService.getUserSubscription(userId),
      StripeService.getUserCredits(userId),
    ])

    // Add subscription info to response locals
    res.locals.subscriptionInfo = {
      subscription,
      credits,
    }

    next()
  } catch (error) {
    console.error('Subscription info middleware error:', error)
    // Don't fail the request, just continue without subscription info
    next()
  }
}

/**
 * Helper function to include subscription info in API responses
 */
export const includeSubscriptionInResponse = (res: Response, data: any) => {
  const response: any = {
    success: true,
    data,
  }

  // Add subscription info if available
  if (res.locals.subscriptionInfo) {
    response.subscriptionInfo = res.locals.subscriptionInfo
  }

  return response
}

export default {
  requireActiveSubscription,
  requirePlan,
  addSubscriptionInfo,
  includeSubscriptionInResponse,
}
