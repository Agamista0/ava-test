import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

/**
 * Webhook security utilities for Stripe and other webhook providers
 */
export class WebhookSecurity {
  /**
   * Rate limiting for webhook endpoints
   * Prevents abuse by limiting requests per IP
   */
  private static webhookRateLimit = new Map<string, { count: number; resetTime: number }>()
  private static readonly WEBHOOK_RATE_LIMIT = 100 // requests per window
  private static readonly WEBHOOK_RATE_WINDOW = 60 * 1000 // 1 minute

  /**
   * Middleware to rate limit webhook requests
   */
  static rateLimitWebhooks(req: Request, res: Response, next: NextFunction) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown'
    const now = Date.now()

    // Clean up expired entries
    for (const [ip, data] of WebhookSecurity.webhookRateLimit.entries()) {
      if (now > data.resetTime) {
        WebhookSecurity.webhookRateLimit.delete(ip)
      }
    }

    // Get or create rate limit data for this IP
    let rateLimitData = WebhookSecurity.webhookRateLimit.get(clientIP)
    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitData = {
        count: 0,
        resetTime: now + WebhookSecurity.WEBHOOK_RATE_WINDOW,
      }
      WebhookSecurity.webhookRateLimit.set(clientIP, rateLimitData)
    }

    // Check rate limit
    if (rateLimitData.count >= WebhookSecurity.WEBHOOK_RATE_LIMIT) {
      console.warn(`Webhook rate limit exceeded for IP: ${clientIP}`)
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000),
      })
    }

    // Increment counter
    rateLimitData.count++

    next()
  }

  /**
   * Validate webhook source IP (for additional security)
   * Stripe webhook IPs: https://stripe.com/docs/ips
   */
  static validateWebhookIP(allowedIPs: string[] = []) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (allowedIPs.length === 0) {
        // Skip IP validation if no IPs specified
        return next()
      }

      const clientIP = req.ip || req.connection.remoteAddress
      if (!clientIP || !allowedIPs.includes(clientIP)) {
        console.warn(`Webhook request from unauthorized IP: ${clientIP}`)
        return res.status(403).json({
          success: false,
          error: 'Unauthorized IP address',
        })
      }

      next()
    }
  }

  /**
   * Log webhook events for monitoring and debugging
   */
  static logWebhookEvent(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now()
    const clientIP = req.ip || req.connection.remoteAddress
    const userAgent = req.get('User-Agent') || 'unknown'

    console.log(`📥 Webhook received: ${req.method} ${req.originalUrl}`)
    console.log(`   IP: ${clientIP}`)
    console.log(`   User-Agent: ${userAgent}`)
    console.log(`   Content-Type: ${req.get('Content-Type')}`)
    console.log(`   Content-Length: ${req.get('Content-Length')}`)

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - startTime
      console.log(`📤 Webhook response: ${res.statusCode} (${duration}ms)`)
    })

    next()
  }

  /**
   * Validate webhook payload size
   */
  static validatePayloadSize(maxSize: number = 1024 * 1024) { // 1MB default
    return (req: Request, res: Response, next: NextFunction) => {
      const contentLength = parseInt(req.get('Content-Length') || '0', 10)
      
      if (contentLength > maxSize) {
        console.warn(`Webhook payload too large: ${contentLength} bytes (max: ${maxSize})`)
        return res.status(413).json({
          success: false,
          error: 'Payload too large',
        })
      }

      next()
    }
  }

  /**
   * Validate required headers for webhook security
   */
  static validateRequiredHeaders(requiredHeaders: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      const missingHeaders = requiredHeaders.filter(header => !req.get(header))
      
      if (missingHeaders.length > 0) {
        console.warn(`Webhook missing required headers: ${missingHeaders.join(', ')}`)
        return res.status(400).json({
          success: false,
          error: 'Missing required headers',
          missingHeaders,
        })
      }

      next()
    }
  }

  /**
   * Generic webhook signature verification
   */
  static verifySignature(
    secret: string,
    signatureHeader: string,
    algorithm: string = 'sha256'
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const signature = req.get(signatureHeader)
        if (!signature) {
          return res.status(400).json({
            success: false,
            error: 'Missing signature header',
          })
        }

        const payload = req.body
        const expectedSignature = crypto
          .createHmac(algorithm, secret)
          .update(payload, 'utf8')
          .digest('hex')

        // Compare signatures securely
        const providedSignature = signature.replace(/^sha256=/, '')
        const isValid = crypto.timingSafeEqual(
          Buffer.from(expectedSignature, 'hex'),
          Buffer.from(providedSignature, 'hex')
        )

        if (!isValid) {
          console.warn('Webhook signature verification failed')
          return res.status(401).json({
            success: false,
            error: 'Invalid signature',
          })
        }

        next()
      } catch (error) {
        console.error('Webhook signature verification error:', error)
        res.status(500).json({
          success: false,
          error: 'Signature verification failed',
        })
      }
    }
  }

  /**
   * Prevent replay attacks by checking timestamp
   */
  static preventReplayAttacks(toleranceSeconds: number = 300) { // 5 minutes default
    return (req: Request, res: Response, next: NextFunction) => {
      const timestamp = req.get('X-Timestamp') || req.get('timestamp')
      
      if (!timestamp) {
        return res.status(400).json({
          success: false,
          error: 'Missing timestamp header',
        })
      }

      const webhookTime = parseInt(timestamp, 10) * 1000 // Convert to milliseconds
      const currentTime = Date.now()
      const timeDifference = Math.abs(currentTime - webhookTime)

      if (timeDifference > toleranceSeconds * 1000) {
        console.warn(`Webhook timestamp too old: ${timeDifference}ms difference`)
        return res.status(400).json({
          success: false,
          error: 'Request timestamp too old',
        })
      }

      next()
    }
  }

  /**
   * Comprehensive webhook security middleware for Stripe
   */
  static stripeWebhookSecurity() {
    return [
      WebhookSecurity.logWebhookEvent,
      WebhookSecurity.rateLimitWebhooks,
      WebhookSecurity.validatePayloadSize(1024 * 1024), // 1MB
      WebhookSecurity.validateRequiredHeaders(['stripe-signature']),
    ]
  }
}

export default WebhookSecurity
