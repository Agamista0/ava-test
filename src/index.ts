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
import refreshRoutes from './features/auth/refresh'
import chatRoutes from './features/chat/routes'
import supportRoutes from './features/chat/support-routes'
import AuthCleanupService from './services/auth/cleanup'


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

// CORS configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = process.env.FRONTEND_URL?.split(',') || ['http://localhost:3000', 'http://localhost:8081']

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)

    if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'), false)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
}

app.use(cors(corsOptions))

// Body parsing middleware
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
app.use('/api/auth', refreshRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/support', supportRoutes)


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
      console.log('✅ Supabase connection successful')
    }

    // Initialize event listeners

    // Start auth cleanup service
    AuthCleanupService.start()

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
      console.log(`📚 Health check: http://localhost:${PORT}/health`)
    })
  } catch (error) {
    console.error('Failed to initialize app:', error)
    process.exit(1)
  }
}


// Start the application
initializeApp()
