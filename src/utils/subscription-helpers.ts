import { StripeService, SubscriptionPlan, UserSubscription } from '@/services/stripe'
import CreditsManager from '@/services/credits'

/**
 * Subscription utility functions
 */
export class SubscriptionHelpers {
  /*
   * Get user's subscription status with detailed information
   */
  static async getUserSubscriptionStatus(userId: string): Promise<{
    hasSubscription: boolean
    subscription?: UserSubscription
    plan?: SubscriptionPlan
    credits?: {
      current: number
      total: number
      used: number
      nextReset?: string
    }
    features?: Record<string, any>
    status: 'none' | 'active' | 'past_due' | 'canceled' | 'incomplete'
  }> {
    try {
      const [subscription, credits] = await Promise.all([
        StripeService.getUserSubscription(userId),
        StripeService.getUserCredits(userId),
      ])

      if (!subscription) {
        return {
          hasSubscription: false,
          status: 'none',
          credits: credits ? {
            current: credits.current_credits,
            total: credits.total_credits_allocated,
            used: credits.credits_used,
            nextReset: credits.next_reset_date,
          } : undefined,
        }
      }

      // Get plan details
      const plan = await StripeService.getSubscriptionPlanByPriceId(subscription.plan_id)

      return {
        hasSubscription: true,
        subscription,
        plan: plan || undefined,
        credits: credits ? {
          current: credits.current_credits,
          total: credits.total_credits_allocated,
          used: credits.credits_used,
          nextReset: credits.next_reset_date,
        } : undefined,
        features: plan?.features,
        status: subscription.status as any,
      }
    } catch (error) {
      console.error('Error getting user subscription status:', error)
      throw error
    }
  }

  /**
   * Check if user has access to a specific feature
   */
  static async hasFeatureAccess(
    userId: string,
    feature: string
  ): Promise<{ hasAccess: boolean; reason?: string; planRequired?: string }> {
    try {
      const status = await this.getUserSubscriptionStatus(userId)

      if (!status.hasSubscription || !status.plan) {
        return {
          hasAccess: false,
          reason: 'No active subscription',
          planRequired: 'starting',
        }
      }

      const features = status.features || {}
      
      // Check if feature exists in plan
      if (!(feature in features)) {
        return {
          hasAccess: false,
          reason: 'Feature not available in current plan',
        }
      }

      const featureValue = features[feature]
      
      // Handle boolean features
      if (typeof featureValue === 'boolean') {
        return {
          hasAccess: featureValue,
          reason: featureValue ? undefined : 'Feature not included in current plan',
        }
      }

      // Handle string features (assume non-empty string means access)
      if (typeof featureValue === 'string') {
        return {
          hasAccess: featureValue.length > 0,
          reason: featureValue.length > 0 ? undefined : 'Feature not included in current plan',
        }
      }

      // Default to no access for unknown feature types
      return {
        hasAccess: false,
        reason: 'Feature configuration error',
      }
    } catch (error) {
      console.error('Error checking feature access:', error)
      return {
        hasAccess: false,
        reason: 'Error checking feature access',
      }
    }
  }

  /**
   * Get recommended plan upgrade for a user
   */
  static async getRecommendedUpgrade(userId: string): Promise<{
    currentPlan?: string
    recommendedPlan?: SubscriptionPlan
    benefits: string[]
    savings?: number
  }> {
    try {
      const [status, allPlans] = await Promise.all([
        this.getUserSubscriptionStatus(userId),
        StripeService.getSubscriptionPlans(),
      ])

      const currentPlanName = status.plan?.plan_name
      const benefits: string[] = []

      // If no subscription, recommend starting plan
      if (!status.hasSubscription) {
        const startingPlan = allPlans.find(p => p.plan_name === 'starting')
        return {
          recommendedPlan: startingPlan,
          benefits: [
            'Get started with AI assistance',
            `${startingPlan?.credits_included} monthly credits`,
            'Basic AI chat support',
            'Email support',
          ],
        }
      }

      // Find next tier plan
      const planOrder = ['starting', 'scaling', 'summit']
      const currentIndex = planOrder.indexOf(currentPlanName || '')
      
      if (currentIndex === -1 || currentIndex >= planOrder.length - 1) {
        // Already on highest plan or unknown plan
        return {
          currentPlan: currentPlanName,
          benefits: ['You are already on the highest plan!'],
        }
      }

      const nextPlanName = planOrder[currentIndex + 1]
      const recommendedPlan = allPlans.find(p => p.plan_name === nextPlanName)

      if (!recommendedPlan) {
        return {
          currentPlan: currentPlanName,
          benefits: ['No upgrade available'],
        }
      }

      // Calculate benefits
      const currentCredits = status.plan?.credits_included || 0
      const newCredits = recommendedPlan.credits_included
      const additionalCredits = newCredits - currentCredits

      benefits.push(`${additionalCredits} additional monthly credits`)

      // Add feature-specific benefits
      if (nextPlanName === 'scaling') {
        benefits.push(
          'Advanced AI chat support',
          'Priority email support',
          'Voice messages support',
          'Faster response times'
        )
      } else if (nextPlanName === 'summit') {
        benefits.push(
          'Premium AI chat support',
          '24/7 priority support',
          'Instant response times',
          'Custom integrations'
        )
      }

      return {
        currentPlan: currentPlanName,
        recommendedPlan,
        benefits,
      }
    } catch (error) {
      console.error('Error getting recommended upgrade:', error)
      throw error
    }
  }

  /**
   * Calculate usage statistics for a user
   */
  static async getUserUsageStats(userId: string, days = 30): Promise<{
    totalCreditsUsed: number
    averageDaily: number
    mostUsedActions: Array<{ action: string; count: number; credits: number }>
    projectedMonthly: number
    efficiency: 'low' | 'medium' | 'high'
  }> {
    try {
      const history = await CreditsManager.getCreditsUsageHistory(userId, 1000, 0)
      
      // Filter to last N days
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const recentHistory = history.history.filter(
        h => new Date(h.created_at) >= cutoffDate
      )

      const totalCreditsUsed = recentHistory.reduce((sum, h) => sum + h.credits_used, 0)
      const averageDaily = totalCreditsUsed / days

      // Group by action type
      const actionStats = recentHistory.reduce((acc, h) => {
        if (!acc[h.action_type]) {
          acc[h.action_type] = { count: 0, credits: 0 }
        }
        acc[h.action_type].count++
        acc[h.action_type].credits += h.credits_used
        return acc
      }, {} as Record<string, { count: number; credits: number }>)

      const mostUsedActions = Object.entries(actionStats)
        .map(([action, stats]) => ({ action, ...stats }))
        .sort((a, b) => b.credits - a.credits)
        .slice(0, 5)

      const projectedMonthly = averageDaily * 30

      // Determine efficiency based on usage patterns
      let efficiency: 'low' | 'medium' | 'high' = 'medium'
      if (projectedMonthly < 50) {
        efficiency = 'low'
      } else if (projectedMonthly > 200) {
        efficiency = 'high'
      }

      return {
        totalCreditsUsed,
        averageDaily,
        mostUsedActions,
        projectedMonthly,
        efficiency,
      }
    } catch (error) {
      console.error('Error calculating usage stats:', error)
      throw error
    }
  }

  /**
   * Check if user needs plan upgrade based on usage
   */
  static async checkUpgradeRecommendation(userId: string): Promise<{
    needsUpgrade: boolean
    reason?: string
    recommendedPlan?: string
    currentUsage: number
    planLimit: number
  }> {
    try {
      const [status, usageStats] = await Promise.all([
        this.getUserSubscriptionStatus(userId),
        this.getUserUsageStats(userId),
      ])

      const currentCredits = status.credits?.current || 0
      const planLimit = status.plan?.credits_included || 80
      const projectedUsage = usageStats.projectedMonthly

      // Check if projected usage exceeds plan limit
      if (projectedUsage > planLimit * 0.8) { // 80% threshold
        const planOrder = ['starting', 'scaling', 'summit']
        const currentIndex = planOrder.indexOf(status.plan?.plan_name || 'starting')
        const nextPlan = planOrder[currentIndex + 1]

        return {
          needsUpgrade: true,
          reason: 'Your usage is approaching your plan limit',
          recommendedPlan: nextPlan,
          currentUsage: projectedUsage,
          planLimit,
        }
      }

      return {
        needsUpgrade: false,
        currentUsage: projectedUsage,
        planLimit,
      }
    } catch (error) {
      console.error('Error checking upgrade recommendation:', error)
      throw error
    }
  }
}

export default SubscriptionHelpers
