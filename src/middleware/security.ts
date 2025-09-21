import rateLimit from 'express-rate-limit'
import slowDown from 'express-slow-down'
import { body, param, query, validationResult } from 'express-validator'
import mongoSanitize from 'express-mongo-sanitize'
import xss from 'xss'
import hpp from 'hpp'
import { Request, Response, NextFunction } from 'express'

// Rate limiting configurations
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health'
  }
})

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful requests
})

export const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 chat messages per minute
  message: {
    error: 'Too many messages sent, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false
})

export const supportRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Support users can send more messages
  message: {
    error: 'Too many support actions, please slow down.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false
})

// Slow down middleware for additional protection
export const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // Allow 50 requests per windowMs without delay
  delayMs: () => 500, // Add 500ms delay per request after delayAfter (new v2 format)
  maxDelayMs: 20000, // Maximum delay of 20 seconds
})

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize against NoSQL injection attacks
  mongoSanitize.sanitize(req.body)
  mongoSanitize.sanitize(req.query)
  mongoSanitize.sanitize(req.params)

  // Sanitize against XSS attacks
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key])
      }
    }
  }

  next()
}

// Parameter pollution protection
export const parameterPollutionProtection = hpp({
  whitelist: ['status', 'limit', 'page'] // Allow these parameters to be arrays
})

// Validation error handler
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.type === 'field' ? err.path : 'unknown',
        message: err.msg,
        value: err.type === 'field' ? err.value : undefined
      }))
    })
  }
  next()
}

// Common validation rules
export const validateEmail = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Must be a valid email address')

export const validatePassword = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters long')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')

export const validateName = body('name')
  .trim()
  .isLength({ min: 1, max: 100 })
  .withMessage('Name must be between 1 and 100 characters')
  .matches(/^[a-zA-Z\s\-'\.]+$/)
  .withMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods')

export const validateRole = body('role')
  .isIn(['user', 'support'])
  .withMessage('Role must be either "user" or "support"')

export const validateMessage = body('message')
  .optional()
  .trim()
  .isLength({ min: 1, max: 5000 })
  .withMessage('Message must be between 1 and 5000 characters')

export const validateConversationId = param('conversationId')
  .isUUID()
  .withMessage('Conversation ID must be a valid UUID')

export const validateTicketId = param('ticketId')
  .matches(/^[A-Z]+-\d+$/)
  .withMessage('Ticket ID must be in format PROJECT-123')

export const validateStatus = body('status')
  .optional()
  .isIn(['open', 'assigned', 'closed', 'To Do', 'In Progress', 'Done'])
  .withMessage('Invalid status value')

export const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
]

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY')
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff')
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block')
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https:; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "media-src 'self'; " +
    "frame-src 'none';"
  )
  
  // Permissions Policy (formerly Feature Policy)
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), payment=()'
  )
  
  next()
}

// Request logging middleware for security monitoring
export const securityLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now()
  
  // Log security-relevant information
  const logData = {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    method: req.method,
    url: req.url,
    referer: req.get('Referer'),
    contentLength: req.get('Content-Length')
  }

  // Log suspicious patterns
  const suspiciousPatterns = [
    /\b(union|select|insert|delete|drop|create|alter)\b/i, // SQL injection
    /<script|javascript:|vbscript:|onload=|onerror=/i, // XSS
    /\.\.\//g, // Path traversal
    /%00|%2e%2e|%252e/i, // Encoded path traversal
    /eval\(|expression\(|javascript:/i // Code injection
  ]

  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(req.url) || 
    pattern.test(JSON.stringify(req.body)) ||
    pattern.test(JSON.stringify(req.query))
  )

  if (isSuspicious) {
    console.warn('🚨 SECURITY ALERT - Suspicious request detected:', logData)
  }

  // Continue with request
  res.on('finish', () => {
    const duration = Date.now() - startTime
    if (duration > 5000) { // Log slow requests
      console.warn('⚠️  Slow request detected:', { ...logData, duration, status: res.statusCode })
    }
  })

  next()
}

// Brute force protection middleware
export const bruteForceProtection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { AuthService } = await import('@/services/auth')
    const { email } = req.body
    const ipAddress = req.ip || 'unknown'

    if (email && await AuthService.isAccountLocked(email, ipAddress)) {
      return res.status(423).json({
        error: 'Account temporarily locked due to multiple failed attempts. Please try again later.',
        retryAfter: '15 minutes'
      })
    }

    next()
  } catch (error) {
    console.error('Brute force protection error:', error)
    next() // Continue on error to avoid blocking legitimate requests
  }
}

// File upload security
export const validateFileUpload = (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return next()
  }

  const file = req.file
  const allowedMimeTypes = [
    'audio/webm', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/wave', 'audio/x-pn-wav', 'audio/flac', 'audio/ogg',
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac'
  ]

  // Validate MIME type
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only audio files are allowed'
    })
  }

  // Validate file size (10MB max)
  const maxSize = 10 * 1024 * 1024
  if (file.size > maxSize) {
    return res.status(400).json({
      error: 'File too large',
      message: 'Maximum file size is 10MB'
    })
  }

  // Validate filename
  const dangerousPatterns = /[<>:"/\\|?*\x00-\x1f]/
  if (dangerousPatterns.test(file.originalname)) {
    return res.status(400).json({
      error: 'Invalid filename',
      message: 'Filename contains invalid characters'
    })
  }

  next()
}
