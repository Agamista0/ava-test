import { Router } from 'express'
import express from 'express'
import { StripeService } from '../services/stripe'
import { WebhookSecurity } from '../utils/webhook-security'

const router = Router()

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  ...WebhookSecurity.stripeWebhookSecurity(),
  async (req, res) => {
    const startTime = Date.now()
    
    try {
      const signature = req.get('stripe-signature')
      
      if (!signature) {
        console.error('Missing Stripe signature header')
        return res.status(400).json({
          success: false,
          error: 'Missing Stripe signature',
        })
      }

      let event
      try {
        event = StripeService.verifyWebhookSignature(req.body, signature)
        console.log(`Webhook signature verified: ${event.type} (${event.id})`)
      } catch (error) {
        console.error('Webhook signature verification failed:', error)
        return res.status(400).json({
          success: false,
          error: 'Invalid webhook signature',
        })
      }

      console.log(`Processing webhook: ${event.type} (${event.id})`)
      await StripeService.processWebhookEvent(event)

      const processingTime = Date.now() - startTime
      console.log(`Webhook processed in ${processingTime}ms: ${event.type}`)

      res.status(200).json({
        success: true,
        received: true,
        eventId: event.id,
        eventType: event.type,
        processingTime,
      })
    } catch (error) {
      const processingTime = Date.now() - startTime
      console.error(`Webhook processing error (${processingTime}ms):`, error)
      
      const statusCode = error instanceof Error && error.message.includes('already processed') ? 200 : 400
      
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Webhook processing failed',
        processingTime,
      })
    }
  }
)

export default router
