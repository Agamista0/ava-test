import { StripeService } from '@/services/stripe'
import { supabaseAdmin } from '@/lib'
import cron from 'node-cron'

export interface CreditsCost {
  chat_message: number
  voice_transcription: number
  ai_response: number
  file_upload: number
  support_ticket: number
}

export class CreditsManager {
  // Define credit costs for different actions
  private static readonly CREDITS_COST: CreditsCost = {
    chat_message: 1,
    voice_transcription: 2,
    ai_response: 1,
    file_upload: 1,
    support_ticket: 0, // Free for now
  }

  // Check if user has enough credits for an action
   
  static async hasEnoughCredits(
    userId: string,
    actionType: keyof CreditsCost
  ): Promise<{ hasCredits: boolean; currentCredits: number; requiredCredits: number }> {
    try {
      const requiredCredits = this.CREDITS_COST[actionType]
      const userCredits = await StripeService.getUserCredits(userId)

      if (!userCredits) {
        return {
          hasCredits: false,
          currentCredits: 0,
          requiredCredits,
        }
      }

      return {
        hasCredits: userCredits.current_credits >= requiredCredits,
        currentCredits: userCredits.current_credits,
        requiredCredits,
      }
    } catch (error) {
      console.error('Error checking user credits:', error)
      throw error
    }
  }

  //Consume credits for an action
   
  static async consumeCredits(
    userId: string,
    actionType: keyof CreditsCost,
    description?: string
  ): Promise<{ success: boolean; remainingCredits: number; error?: string }> {
    try {
      const requiredCredits = this.CREDITS_COST[actionType]
      
      // Check if user has enough credits first
      const creditCheck = await this.hasEnoughCredits(userId, actionType)
      if (!creditCheck.hasCredits) {
        return {
          success: false,
          remainingCredits: creditCheck.currentCredits,
          error: `Insufficient credits. Required: ${requiredCredits}, Available: ${creditCheck.currentCredits}`,
        }
      }

      // Use the credits
      const result = await StripeService.useCredits(
        userId,
        requiredCredits,
        actionType,
        description
      )

      return {
        success: result.success,
        remainingCredits: result.remainingCredits,
        error: result.success ? undefined : 'Failed to consume credits',
      }
    } catch (error) {
      console.error('Error consuming credits:', error)
      return {
        success: false,
        remainingCredits: 0,
        error: 'Internal error while consuming credits',
      }
    }
  }

  // Get user's credits summary

  static async getUserCreditsSummary(userId: string): Promise<{
    currentCredits: number
    totalAllocated: number
    creditsUsed: number
    nextResetDate?: string
    subscription?: any
  } | null> {
    try {
      const [userCredits, subscription] = await Promise.all([
        StripeService.getUserCredits(userId),
        StripeService.getUserSubscription(userId),
      ])

      if (!userCredits) {
        return null
      }

      return {
        currentCredits: userCredits.current_credits,
        totalAllocated: userCredits.total_credits_allocated,
        creditsUsed: userCredits.credits_used,
        nextResetDate: userCredits.next_reset_date,
        subscription,
      }
    } catch (error) {
      console.error('Error getting user credits summary:', error)
      throw error
    }
  }

  // Get credits usage history for a user
  
  static async getCreditsUsageHistory(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{
    history: Array<{
      id: string
      credits_used: number
      action_type: string
      description?: string
      created_at: string
    }>
    total: number
  }> {
    try {
      // Get usage history
      const { data: history, error: historyError } = await supabaseAdmin
        .from('credits_usage_history')
        .select('id, credits_used, action_type, description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (historyError) {
        throw new Error(`Failed to fetch credits usage history: ${historyError.message}`)
      }

      // Get total count
      const { count, error: countError } = await supabaseAdmin
        .from('credits_usage_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      if (countError) {
        throw new Error(`Failed to fetch credits usage count: ${countError.message}`)
      }

      return {
        history: history || [],
        total: count || 0,
      }
    } catch (error) {
      console.error('Error getting credits usage history:', error)
      throw error
    }
  }

  /**
   * Reset credits for users whose billing cycle has ended
   * This should be run as a cron job
   */
  static async resetExpiredCredits(): Promise<void> {
    try {
      console.log('Starting credits reset process...')

      // Get all users whose credits need to be reset
      const { data: expiredCredits, error } = await supabaseAdmin
        .from('user_credits')
        .select(`
          *,
          user_subscriptions!inner(
            id,
            stripe_subscription_id,
            plan_id,
            status,
            current_period_end,
            subscription_plans!inner(
              credits_included
            )
          )
        `)
        .lte('next_reset_date', new Date().toISOString())
        .eq('user_subscriptions.status', 'active')

      if (error) {
        throw new Error(`Failed to fetch expired credits: ${error.message}`)
      }

      if (!expiredCredits || expiredCredits.length === 0) {
        console.log('No credits to reset')
        return
      }

      console.log(`Found ${expiredCredits.length} users with expired credits`)

      // Reset credits for each user
      for (const userCredit of expiredCredits) {
        try {
          const subscription = userCredit.user_subscriptions
          const plan = subscription.subscription_plans
          const newCredits = plan.credits_included

          // Reset user credits
          await supabaseAdmin
            .from('user_credits')
            .update({
              current_credits: newCredits,
              total_credits_allocated: userCredit.total_credits_allocated + newCredits,
              last_reset_date: new Date().toISOString(),
              next_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
            })
            .eq('user_id', userCredit.user_id)

          console.log(`Reset credits for user ${userCredit.user_id}: ${newCredits} credits`)
        } catch (userError) {
          console.error(`Failed to reset credits for user ${userCredit.user_id}:`, userError)
        }
      }

      console.log('Credits reset process completed')
    } catch (error) {
      console.error('Error in credits reset process:', error)
      throw error
    }
  }
  
  static startCreditsResetCron(): void {
    console.log('Starting credits reset cron job...')
    
    cron.schedule('0 2 * * *', async () => {
      console.log('Running scheduled credits reset...')
      try {
        await this.resetExpiredCredits()
      } catch (error) {
        console.error('Scheduled credits reset failed:', error)
      }
    }, {
      timezone: 'UTC'
    })

    console.log('Credits reset cron job started (daily at 2 AM UTC)')
  }

  /**
   * Get credits cost configuration
   */
  static getCreditsCosts(): CreditsCost {
    return { ...this.CREDITS_COST }
  }

  /**
   * Update credits cost for an action (admin function)
   */
  static updateCreditsCost(actionType: keyof CreditsCost, newCost: number): void {
    this.CREDITS_COST[actionType] = newCost
    console.log(`Updated credits cost for ${actionType}: ${newCost}`)
  }
}

export default CreditsManager
