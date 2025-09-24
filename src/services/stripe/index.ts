import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib'

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})

export interface SubscriptionPlan {
  id: string
  stripe_product_id: string
  stripe_price_id: string
  plan_name: 'starting' | 'scaling' | 'summit'
  display_name: string
  description: string
  price_amount: number
  currency: string
  billing_interval: 'month' | 'year'
  credits_included: number
  features: Record<string, any>
  is_active: boolean
}

export interface UserSubscription {
  id: string
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  plan_id: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  canceled_at?: string
  trial_start?: string
  trial_end?: string
}

export interface UserCredits {
  id: string
  user_id: string
  current_credits: number
  total_credits_allocated: number
  credits_used: number
  last_reset_date: string
  next_reset_date?: string
  subscription_id?: string
}

export class StripeService {
  /**
   * Create or retrieve a Stripe customer for a user
   */
  static async createOrGetCustomer(userId: string, email: string, name?: string): Promise<string> {
    try {
      // Check if user already has a Stripe customer ID
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single()

      if (error) {
        throw new Error(`Failed to fetch user profile: ${error.message}`)
      }

      // If customer already exists, return the ID
      if (profile.stripe_customer_id) {
        return profile.stripe_customer_id
      }

      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          user_id: userId,
        },
      })

      // Update user profile with Stripe customer ID
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customer.id })
        .eq('id', userId)

      if (updateError) {
        throw new Error(`Failed to update user profile with Stripe customer ID: ${updateError.message}`)
      }

      return customer.id
    } catch (error) {
      console.error('Error creating/getting Stripe customer:', error)
      throw error
    }
  }

  /**
   * Get all available subscription plans
   */
  static async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    try {
      const { data: plans, error } = await supabaseAdmin
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('price_amount', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch subscription plans: ${error.message}`)
      }

      return plans || []
    } catch (error) {
      console.error('Error fetching subscription plans:', error)
      throw error
    }
  }

  /**
   * Get a specific subscription plan by price ID
   */
  static async getSubscriptionPlanByPriceId(priceId: string): Promise<SubscriptionPlan | null> {
    try {
      const { data: plan, error } = await supabaseAdmin
        .from('subscription_plans')
        .select('*')
        .eq('stripe_price_id', priceId)
        .eq('is_active', true)
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null
        }
        throw new Error(`Failed to fetch subscription plan: ${error.message}`)
      }

      return plan
    } catch (error) {
      console.error('Error fetching subscription plan by price ID:', error)
      throw error
    }
  }

  /**
   * Create a new subscription for a user
   */
  static async createSubscription(
    userId: string,
    customerId: string,
    priceId: string
  ): Promise<{ subscription: Stripe.Subscription; userSubscription: UserSubscription }> {
    try {
      // Get the subscription plan
      const plan = await this.getSubscriptionPlanByPriceId(priceId)
      if (!plan) {
        throw new Error('Invalid subscription plan')
      }

      // Create subscription in Stripe with auto-renewal enabled
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription' // Enables auto-renewal
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          user_id: userId,
          plan_name: plan.plan_name,
        },
        // Auto-renewal is enabled by default in Stripe
        // The subscription will automatically renew at the end of each billing period
        // unless explicitly canceled or cancel_at_period_end is set to true
      })

      // Store subscription in database
      const { data: userSubscription, error } = await supabaseAdmin
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          plan_id: plan.id,
          status: subscription.status,
          current_period_start: new Date((subscription as any).current_period_start * 1000).toISOString(),
          current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
          cancel_at_period_end: (subscription as any).cancel_at_period_end || false,
          trial_start: (subscription as any).trial_start ? new Date((subscription as any).trial_start * 1000).toISOString() : null,
          trial_end: (subscription as any).trial_end ? new Date((subscription as any).trial_end * 1000).toISOString() : null,
        })
        .select()
        .single()

      if (error) {
        // If database insert fails, cancel the Stripe subscription
        await stripe.subscriptions.cancel(subscription.id)
        throw new Error(`Failed to store subscription in database: ${error.message}`)
      }

      return { subscription, userSubscription }
    } catch (error) {
      console.error('Error creating subscription:', error)
      throw error
    }
  }

  /**
   * Get user's current subscription
   */
  static async getUserSubscription(userId: string): Promise<UserSubscription | null> {
    try {
      const { data: subscription, error } = await supabaseAdmin
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null
        }
        throw new Error(`Failed to fetch user subscription: ${error.message}`)
      }

      return subscription
    } catch (error) {
      console.error('Error fetching user subscription:', error)
      throw error
    }
  }

  /**
   * Cancel a user's subscription
   */
  static async cancelSubscription(userId: string, cancelAtPeriodEnd = true): Promise<void> {
    try {
      const userSubscription = await this.getUserSubscription(userId)
      if (!userSubscription) {
        throw new Error('No active subscription found')
      }

      // Cancel subscription in Stripe
      if (cancelAtPeriodEnd) {
        await stripe.subscriptions.update(userSubscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        })
      } else {
        await stripe.subscriptions.cancel(userSubscription.stripe_subscription_id)
      }

      // Update subscription in database
      const { error } = await supabaseAdmin
        .from('user_subscriptions')
        .update({
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: cancelAtPeriodEnd ? null : new Date().toISOString(),
          status: cancelAtPeriodEnd ? 'active' : 'canceled',
        })
        .eq('id', userSubscription.id)

      if (error) {
        throw new Error(`Failed to update subscription in database: ${error.message}`)
      }
    } catch (error) {
      console.error('Error canceling subscription:', error)
      throw error
    }
  }

  /**
   * Process webhook events from Stripe with improved error handling and idempotency
   */
  static async processWebhookEvent(event: Stripe.Event): Promise<void> {
    try {
      // Check if event has already been processed (idempotency)
      const { data: existingEvent } = await supabaseAdmin
        .from('stripe_webhook_events')
        .select('id')
        .eq('stripe_event_id', event.id)
        .single()

      if (existingEvent) {
        console.log(`Webhook event ${event.id} already processed, skipping`)
        return
      }

      // Store webhook event for idempotency BEFORE processing
      const { error: insertError } = await supabaseAdmin
        .from('stripe_webhook_events')
        .insert({
          stripe_event_id: event.id,
          event_type: event.type,
          data: event.data,
        })

      if (insertError) {
        console.error('Failed to store webhook event:', insertError)
        throw new Error(`Failed to store webhook event: ${insertError.message}`)
      }

      console.log(`Processing webhook event: ${event.type} (${event.id})`)

      // Process different event types
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice)
          break
        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.Invoice)
          break
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
          break
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
          break
        case 'invoice.created':
          console.log(`Invoice created: ${(event.data.object as Stripe.Invoice).id}`)
          break
        case 'payment_intent.succeeded':
          console.log(`Payment intent succeeded: ${(event.data.object as Stripe.PaymentIntent).id}`)
          break
        default:
          console.log(`Unhandled webhook event type: ${event.type}`)
      }

      console.log(`Successfully processed webhook event: ${event.type} (${event.id})`)
    } catch (error) {
      console.error(`❌ Error processing webhook event ${event.id}:`, error)
      throw error
    }
  }

  /**
   * Handle successful payment - allocate credits to user and update subscription status
   * This handles both initial payments and renewal payments
   * For renewals, credits are reset to the plan's full allocation
   */
  private static async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    try {
      // Check if invoice is associated with a subscription
      let subscriptionId = (invoice as any).subscription as string | null;
      if (!subscriptionId) {
        console.log('Invoice not associated with subscription, skipping credit allocation');
        // Try to fetch subscription from invoice.customer or invoice.id
        if ((invoice as any).customer) {
          try {
            const subs = await stripe.subscriptions.list({ customer: (invoice as any).customer, limit: 1 });
            if (subs.data.length > 0) {
              subscriptionId = subs.data[0].id;
              console.log('Fallback: found subscription from customer:', subscriptionId);
            }
          } catch (err) {
            console.error('Fallback failed to fetch subscription from customer:', err);
          }
        }
        if (!subscriptionId) return;
      }

      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = subscription.metadata?.user_id;

      if (!userId) {
        console.error('❌ No user_id found in subscription metadata');
        return;
      }

      console.log(`Payment succeeded for user ${userId}, subscription ${subscriptionId}`);

      // Update subscription status to active in database
      const { error: updateError } = await supabaseAdmin
        .from('user_subscriptions')
        .update({
          status: 'active',
          current_period_start: new Date((subscription as any).current_period_start * 1000).toISOString(),
          current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId);

      if (updateError) {
        console.error('❌ Failed to update subscription status:', updateError);
        throw new Error(`Failed to update subscription status: ${updateError.message}`);
      }

      // Get subscription plan details for credit allocation
      const priceId = subscription.items.data[0]?.price.id;
      if (!priceId) {
        console.error('❌ No price ID found in subscription');
        return;
      }

      const plan = await this.getSubscriptionPlanByPriceId(priceId);
      if (!plan) {
        console.error(`❌ No plan found for price ID: ${priceId}`);
        return;
      }

      // Allocate credits to user
      await this.allocateCreditsToUser(userId, plan.credits_included, subscriptionId);

      console.log(`Payment processed successfully for user ${userId}: ${plan.credits_included} credits allocated`);
    } catch (error) {
      console.error('Error handling payment succeeded:', error)
      throw error
    }
  }

  /**
   * Handle failed payment - update subscription status
   */
  private static async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    try {
      const subscriptionId = (invoice as any).subscription as string | null
      if (!subscriptionId) {
        console.log('Invoice not associated with subscription, skipping')
        return
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const userId = subscription.metadata?.user_id

      if (!userId) {
        console.log('No user_id found in subscription metadata')
        return
      }

      console.log(`Payment failed for user ${userId}, subscription ${subscriptionId}`)

      // Update subscription status in database
      const { error: updateError } = await supabaseAdmin
        .from('user_subscriptions')
        .update({ status: 'past_due' })
        .eq('stripe_subscription_id', subscriptionId)

      if (updateError) {
        console.error('❌ Failed to update subscription status:', updateError)
        throw new Error(`Failed to update subscription status: ${updateError.message}`)
      }

      console.log(`Subscription marked as past_due for user ${userId}`)
    } catch (error) {
      console.error('Error handling payment failed:', error)
      throw error
    }
  }

  /**
   * Handle subscription updates - sync subscription data with database
   */
  private static async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    try {
      const userId = subscription.metadata?.user_id
      if (!userId) {
        console.log('No user_id found in subscription metadata')
        return
      }

      console.log(`Updating subscription for user ${userId}: ${subscription.id}`)

      // Defensive checks for timestamp fields
      let currentPeriodStart = (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000).toISOString() : null;
      let currentPeriodEnd = (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000).toISOString() : null;
      const canceledAt = (subscription as any).canceled_at ? new Date((subscription as any).canceled_at * 1000).toISOString() : null;

      // If period fields are missing, fetch latest from Stripe
      if (!currentPeriodStart || !currentPeriodEnd) {
        console.log('Period fields missing, fetching from Stripe');
        const latest = await stripe.subscriptions.retrieve(subscription.id);
        currentPeriodStart = (latest as any).current_period_start ? new Date((latest as any).current_period_start * 1000).toISOString() : null;
        currentPeriodEnd = (latest as any).current_period_end ? new Date((latest as any).current_period_end * 1000).toISOString() : null;
      }

      // If still missing, do not update those fields
      const updateFields: any = {
        status: subscription.status,
        cancel_at_period_end: (subscription as any).cancel_at_period_end || false,
        canceled_at: canceledAt,
      };
      if (currentPeriodStart) updateFields.current_period_start = currentPeriodStart;
      if (currentPeriodEnd) updateFields.current_period_end = currentPeriodEnd;

      console.log('Updating subscription fields:', updateFields);
      // Update subscription in database
      const { error: updateError } = await supabaseAdmin
        .from('user_subscriptions')
        .update(updateFields)
        .eq('stripe_subscription_id', subscription.id)

      if (updateError) {
        console.error('❌ Failed to update subscription:', updateError)
        throw new Error(`Failed to update subscription: ${updateError.message}`)
      }

      console.log(`Subscription updated for user ${userId}: status=${subscription.status}`)
    } catch (error) {
      console.error('Error handling subscription updated:', error)
      throw error
    }
  }

  /**
   * Handle subscription deletion/cancellation
   */
  private static async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    try {
      const userId = subscription.metadata?.user_id
      if (!userId) {
        console.log('No user_id found in subscription metadata')
        return
      }

      console.log(`Canceling subscription for user ${userId}: ${subscription.id}`)

      // Update subscription status in database
      const { error: updateError } = await supabaseAdmin
        .from('user_subscriptions')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id)

      if (updateError) {
        console.error('❌ Failed to update subscription status:', updateError)
        throw new Error(`Failed to update subscription status: ${updateError.message}`)
      }

      console.log(`Subscription canceled for user ${userId}`)
    } catch (error) {
      console.error('Error handling subscription deleted:', error)
      throw error
    }
  }

  /**
   * Allocate credits to a user (handles both new subscriptions and renewals)
   */
  static async allocateCreditsToUser(
    userId: string,
    creditsToAdd: number,
    stripeSubscriptionId?: string
  ): Promise<void> {
    try {
      console.log(`💰 Allocating ${creditsToAdd} credits to user ${userId}`)

      // If we have a Stripe subscription ID, look up the internal subscription ID
      let internalSubscriptionId: string | null = null;
      if (stripeSubscriptionId) {
        const { data: subscription } = await supabaseAdmin
          .from('user_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', stripeSubscriptionId)
          .single()

        internalSubscriptionId = subscription?.id || null;
      }

      // Get or create user credits record
      let { data: userCredits, error } = await supabaseAdmin
        .from('user_credits')
        .select('*')
        .eq('user_id', userId)
        .single()

      const now = new Date()
      const nextResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days from now

      if (error && error.code === 'PGRST116') {
        // Create new credits record for first-time user
        const { data: newCredits, error: insertError } = await supabaseAdmin
          .from('user_credits')
          .insert({
            user_id: userId,
            current_credits: creditsToAdd,
            total_credits_allocated: creditsToAdd,
            credits_used: 0,
            last_reset_date: now.toISOString(),
            next_reset_date: nextResetDate.toISOString(),
            subscription_id: internalSubscriptionId,
          })
          .select()
          .single()

        if (insertError) {
          throw new Error(`Failed to create user credits: ${insertError.message}`)
        }

        userCredits = newCredits
        console.log(`Created new credits record for user ${userId}: ${creditsToAdd} credits`)
      } else if (error) {
        throw new Error(`Failed to fetch user credits: ${error.message}`)
      } else {
        // Update existing credits record (renewal or plan change)
        // For renewals, reset current credits to the new allocation
        // For plan changes, this will update to the new plan's credit amount
        const { error: updateError } = await supabaseAdmin
          .from('user_credits')
          .update({
            current_credits: creditsToAdd, // Reset to new allocation (important for renewals)
            total_credits_allocated: userCredits!.total_credits_allocated + creditsToAdd,
            last_reset_date: now.toISOString(),
            next_reset_date: nextResetDate.toISOString(),
            subscription_id: internalSubscriptionId,
          })
          .eq('user_id', userId)

        if (updateError) {
          throw new Error(`Failed to update user credits: ${updateError.message}`)
        }

        console.log(`Updated credits for user ${userId}: ${creditsToAdd} credits (was ${userCredits.current_credits})`)
      }

      console.log(`Successfully allocated ${creditsToAdd} credits to user ${userId}`)
    } catch (error) {
      console.error('Error allocating credits to user:', error)
      throw error
    }
  }

  /**
   * Use credits for a user action
   */
  static async useCredits(
    userId: string,
    creditsToUse: number,
    actionType: string,
    description?: string
  ): Promise<{ success: boolean; remainingCredits: number }> {
    try {
      // Get user credits
      const { data: userCredits, error } = await supabaseAdmin
        .from('user_credits')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error) {
        throw new Error(`Failed to fetch user credits: ${error.message}`)
      }

      if (userCredits.current_credits < creditsToUse) {
        return { success: false, remainingCredits: userCredits.current_credits }
      }

      // Update credits
      const newCreditsAmount = userCredits.current_credits - creditsToUse
      const { error: updateError } = await supabaseAdmin
        .from('user_credits')
        .update({
          current_credits: newCreditsAmount,
          credits_used: userCredits.credits_used + creditsToUse,
        })
        .eq('user_id', userId)

      if (updateError) {
        throw new Error(`Failed to update user credits: ${updateError.message}`)
      }

      // Log credits usage
      await supabaseAdmin
        .from('credits_usage_history')
        .insert({
          user_id: userId,
          credits_used: creditsToUse,
          action_type: actionType,
          description: description,
        })

      return { success: true, remainingCredits: newCreditsAmount }
    } catch (error) {
      console.error('Error using credits:', error)
      throw error
    }
  }

  /**
   * Get user's current credits
   */
  static async getUserCredits(userId: string): Promise<UserCredits | null> {
    try {
      const { data: userCredits, error } = await supabaseAdmin
        .from('user_credits')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return null
        }
        throw new Error(`Failed to fetch user credits: ${error.message}`)
      }

      return userCredits
    } catch (error) {
      console.error('Error fetching user credits:', error)
      throw error
    }
  }

  /**
   * Verify webhook signature from Stripe
   */
  static verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      )
    } catch (error) {
      console.error('Webhook signature verification failed:', error)
      throw new Error('Invalid webhook signature')
    }
  }
}
