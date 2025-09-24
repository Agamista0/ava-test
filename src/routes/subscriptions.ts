import express from 'express'
import { body, validationResult } from 'express-validator'
import { StripeService } from '@/services/stripe'
import { authenticateUser, AuthenticatedRequest } from '@/middleware/auth'
import { supabaseAdmin } from '@/lib'

const router = express.Router()


// Get all available subscription plans
 
router.get('/plans', async (req, res) => {
  try {
    const plans = await StripeService.getSubscriptionPlans()
    res.json({
      success: true,
      data: plans,
    })
  } catch (error) {
    console.error('Error fetching subscription plans:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription plans',
    })
  }
})

// Create a new subscription for a user

router.post(
  '/create-subscription',
  authenticateUser,
  [
    body('priceId')
      .isString()
      .notEmpty()
      .withMessage('Price ID is required')
      .matches(/^price_[a-zA-Z0-9_]+$/)
      .withMessage('Invalid price ID format'),
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest
      // Validate request
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array(),
        })
      }

      const { priceId } = req.body
      const userId = authReq.user!.id
      const userEmail = authReq.user!.email || ''

      // Get user profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('name, email')
        .eq('id', userId)
        .single()

      if (profileError || !profile) {
        return res.status(404).json({
          success: false,
          error: 'User profile not found',
        })
      }

      // Check if user already has an active subscription
      const existingSubscription = await StripeService.getUserSubscription(userId)
      if (existingSubscription) {
        return res.status(400).json({
          success: false,
          error: 'User already has an active subscription',
        })
      }

      // Validate the price ID exists in our plans
      const plan = await StripeService.getSubscriptionPlanByPriceId(priceId)
      if (!plan) {
        return res.status(400).json({
          success: false,
          error: 'Invalid subscription plan',
        })
      }

      // Create or get Stripe customer
      const customerId = await StripeService.createOrGetCustomer(
        userId,
        profile.email || userEmail,
        profile.name
      )

      // Create subscription
      const { subscription, userSubscription } = await StripeService.createSubscription(
        userId,
        customerId,
        priceId
      )

      // Return subscription details with client secret for payment
      const clientSecret = typeof subscription.latest_invoice === 'object' &&
        subscription.latest_invoice &&
        'payment_intent' in subscription.latest_invoice &&
        typeof subscription.latest_invoice.payment_intent === 'object' &&
        subscription.latest_invoice.payment_intent &&
        'client_secret' in subscription.latest_invoice.payment_intent
        ? (subscription.latest_invoice.payment_intent as any).client_secret
        : null

      res.json({
        success: true,
        data: {
          subscription: userSubscription,
          clientSecret,
          plan: {
            name: plan.display_name,
            credits: plan.credits_included,
            price: plan.price_amount / 100, // Convert cents to dollars
          },
        },
      })
    } catch (error) {
      console.error('Error creating subscription:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to create subscription',
      })
    }
  }
)

// Get user's current subscription and credits

router.get('/current', authenticateUser, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest
    const userId = authReq.user!.id

    // Get user's subscription
    const subscription = await StripeService.getUserSubscription(userId)
    
    // Get user's credits
    const credits = await StripeService.getUserCredits(userId)

    res.json({
      success: true,
      data: {
        subscription,
        credits,
      },
    })
  } catch (error) {
    console.error('Error fetching user subscription:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscription details',
    })
  }
})

//  Cancel user's subscription

router.post('/cancel', authenticateUser, async (req: express.Request, res: express.Response) => {
  try {
    const authReq = req as AuthenticatedRequest
    const userId = authReq.user!.id
    const { cancelAtPeriodEnd = true } = req.body

    await StripeService.cancelSubscription(userId, cancelAtPeriodEnd)

    res.json({
      success: true,
      message: cancelAtPeriodEnd 
        ? 'Subscription will be canceled at the end of the current billing period'
        : 'Subscription canceled immediately',
    })
  } catch (error) {
    console.error('Error canceling subscription:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to cancel subscription',
    })
  }
})

//  Use credits for an action (for testing and manual credit usage)

router.post(
  '/use-credits',
  authenticateUser,
  [
    body('credits')
      .isInt({ min: 1, max: 100 })
      .withMessage('Credits must be between 1 and 100'),
    body('actionType')
      .isString()
      .notEmpty()
      .withMessage('Action type is required'),
    body('description')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Description must be less than 500 characters'),
  ],
  async (req: express.Request, res: express.Response) => {
    try {
      const authReq = req as AuthenticatedRequest
      // Validate request
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array(),
        })
      }

      const { credits, actionType, description } = req.body
      const userId = authReq.user!.id

      const result = await StripeService.useCredits(userId, credits, actionType, description)

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient credits',
          remainingCredits: result.remainingCredits,
        })
      }

      res.json({
        success: true,
        message: `Used ${credits} credits`,
        remainingCredits: result.remainingCredits,
      })
    } catch (error) {
      console.error('Error using credits:', error)
      res.status(500).json({
        success: false,
        error: 'Failed to use credits',
      })
    }
  }
)

export default router
