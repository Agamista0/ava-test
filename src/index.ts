import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { supabaseAdmin } from '@/lib'
import { validateEnvironment, printValidationResults } from '@/lib/env-validation'
import {
  generalRateLimit,
  speedLimiter,
  sanitizeInput,
  parameterPollutionProtection,
  securityHeaders,
  securityLogger
} from '@/middleware/security'
import authRoutes from './features/auth/routes'
import twoFARoutes from './features/auth/twofa-routes'
import profileRoutes from './features/auth/profile-routes'
import refreshRoutes from './features/auth/refresh'
import chatRoutes from './features/chat/routes'
import supportRequestRoutes from './features/support/routes'
import subscriptionRoutes from './routes/subscriptions'
import webhookRoutes from './routes/webhook'
import AuthCleanupService from './services/auth/cleanup'
import CreditsManager from './services/credits/'


// Validate environment variables before starting
const envValidation = validateEnvironment()
printValidationResults(envValidation)

if (!envValidation.isValid) {
  console.error('Cannot start server due to environment validation errors.')
  console.error('Please fix the above errors and restart the server.')
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT || 3000

// Trust proxy for accurate IP addresses behind reverse proxy
app.set('trust proxy', 1)

// Security middleware (applied first)
app.use(securityHeaders)
app.use(securityLogger)
app.use(generalRateLimit)
app.use(speedLimiter)

// Compression middleware
app.use(compression())

// Helmet for security headers (with custom CSP disabled since we set our own)
app.use(helmet({
  contentSecurityPolicy: false, // We set our own CSP in securityHeaders
  crossOriginEmbedderPolicy: false // Allow embedding for development
}))

// CORS configuration with enhanced securit
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Get allowed origins from environment
    const envOrigins = process.env.FRONTEND_URL?.split(',').map(url => url.trim()) || []
    
    // Default development origins (only when explicitly in development)
    const defaultDevOrigins = process.env.NODE_ENV === 'development' ? [
      'http://localhost:3000', 
      'http://localhost:8081',
      'http://localhost:8080',
      'http://127.0.0.1:8081',
      'http://127.0.0.1:3000',
      'https://undenied-chronic-jayce.ngrok-free.app',
      'http://127.0.0.1:5500/Stripe-Payment-Test.html',
      'http://127.0.0.1:5500'

    ] : []

    const allowedOrigins = [...envOrigins, ...defaultDevOrigins]

    // Validate origin format and security
    const isValidOrigin = (originUrl: string): boolean => {
      try {
        const url = new URL(originUrl)
        
        // Block non-HTTP(S) protocols
        if (!['http:', 'https:'].includes(url.protocol)) {
          return false
        }
        
        // Block suspicious domains
        const suspiciousPatterns = [
          /\.tk$/i,
          /\.ml$/i,
          /\.ga$/i,
          /\.cf$/i,
          /localhost.*\.ngrok\.io$/i,
          /.*evil.*$/i,
          /.*malicious.*$/i
        ]
        
        if (suspiciousPatterns.some(pattern => pattern.test(url.hostname))) {
          return false
        }
        
        // In production, only allow HTTPS (except for localhost)
        if (process.env.NODE_ENV === 'production' && 
            url.protocol === 'http:' && 
            !url.hostname.includes('localhost') && 
            !url.hostname.includes('127.0.0.1')) {
          return false
        }
        
        return true
      } catch {
        return false
      }
    }

    // Handle no origin (mobile apps, curl, etc.) - be more restrictive
    if (!origin) {
      // Only allow no-origin requests in development or for mobile apps
      if (process.env.NODE_ENV === 'development' || 
          process.env.ALLOW_NO_ORIGIN === 'true') {
        return callback(null, true)
      } else {
        console.warn('CORS: Request with no origin blocked in production')
        return callback(new Error('Origin required'), false)
      }
    }

    // Validate origin format first
    if (!isValidOrigin(origin)) {
      console.warn(`CORS: Invalid or suspicious origin format: ${origin}`)
      return callback(new Error('Invalid origin format'), false)
    }

    // Check against allowed origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`CORS: Origin ${origin} not allowed. Allowed origins:`, allowedOrigins)
      securityLogger(null as any, null as any, () => {})
      callback(new Error('Not allowed by CORS'), false)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
        'Accept',
    'Origin',
    'stripe-signature'
    // Removed: X-Requested-With, Cache-Control, X-File-Name (add back only if needed)
  ],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
maxAge: process.env.NODE_ENV === 'production' ? 86400 : 600, // Cache preflight for 24h in prod, 10min in dev
  preflightContinue: false // Finish preflight here
}

app.use(cors(corsOptions))

// Additional CORS security middleware
app.use((req, res, next) => {
  // Validate request headers for suspicious patterns
  const userAgent = req.get('User-Agent') || ''
  const referer = req.get('Referer') || ''
  
  // Block suspicious user agents
  const suspiciousUAPatterns = [
    /crawler/i,
    /bot/i,
    /scanner/i,
    /malicious/i,
    /^$/
  ]
  
  if (suspiciousUAPatterns.some(pattern => pattern.test(userAgent))) {
    console.warn(`CORS Security: Suspicious User-Agent blocked: ${userAgent}`)
    return res.status(403).json({ error: 'Access denied' })
  }
  
  // Validate referer if present
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const origin = req.get('Origin')
      
      // Ensure referer matches origin if both are present
      if (origin && refererUrl.origin !== origin) {
        console.warn(`CORS Security: Referer-Origin mismatch. Referer: ${referer}, Origin: ${origin}`)
        return res.status(403).json({ error: 'Invalid request headers' })
      }
    } catch {
      console.warn(`CORS Security: Invalid referer format: ${referer}`)
      return res.status(403).json({ error: 'Invalid referer' })
    }
  }
  
  // Rate limiting for OPTIONS requests to prevent CORS abuse
  if (req.method === 'OPTIONS') {
    const optionsKey = `options:${req.ip}`
    // This would need Redis in production, for now just log
    console.log(`CORS: OPTIONS request from ${req.ip} for ${req.originalUrl}`)
  }
  
  next()
})

// Explicit preflight handler for all routes
app.options('*', cors(corsOptions))

// Handle webhook routes BEFORE applying express.json() middleware
// This is crucial for Stripe webhooks which need raw body for signature verification
app.use('/api/webhook', webhookRoutes)

// Body parsing middleware (applied after webhook routes)
// The webhook routes use express.raw() middleware internally, so they won't be affected by this
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook verification if needed
    (req as any).rawBody = buf
  }
}))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Input sanitization and security
app.use(sanitizeInput)
app.use(parameterPollutionProtection)

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  })
})

// Simple test endpoint for CORS debugging
app.get('/test', (req, res) => {
  res.json({ 
    message: 'Test endpoint working',
    origin: req.headers.origin,
    method: req.method
  })
})

app.post('/test', (req, res) => {
  res.json({ 
    message: 'POST test endpoint working',
    origin: req.headers.origin,
    body: req.body
  })
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/auth', twoFARoutes)
app.use('/api/auth', profileRoutes)
app.use('/api/auth', refreshRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/support', supportRequestRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
// Note: webhook routes are registered earlier before body parsing middleware


// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err)
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  })
})

// Initialize Supabase listeners
async function initializeApp() {
  try {
    // Supabase connectivity check
    const { error } = await supabaseAdmin.from('').select('*').limit(1)
    if (error) {
      console.error('Supabase connection failed:', error)
      process.exit(1)
    } else {
      console.log('Supabase connection successful')
    }

    // Initialize event listeners

    // Start auth cleanup service
    AuthCleanupService.start()

    // Start credits reset cron job
    CreditsManager.startCreditsResetCron()

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
      console.log(`Health check: http://localhost:${PORT}/health`)
    })
  } catch (error) {
    console.error('Failed to initialize app:', error)
    process.exit(1)
  }
}


// Start the application
initializeApp()
