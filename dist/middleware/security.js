"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFileUpload = exports.bruteForceProtection = exports.securityLogger = exports.securityHeaders = exports.validatePagination = exports.validateStatus = exports.validateTicketId = exports.validateConversationId = exports.validateMessage = exports.validateRole = exports.validateName = exports.validatePassword = exports.validateEmail = exports.handleValidationErrors = exports.parameterPollutionProtection = exports.sanitizeInput = exports.speedLimiter = exports.supportRateLimit = exports.chatRateLimit = exports.authRateLimit = exports.generalRateLimit = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_slow_down_1 = __importDefault(require("express-slow-down"));
const express_validator_1 = require("express-validator");
const express_mongo_sanitize_1 = __importDefault(require("express-mongo-sanitize"));
const xss_1 = __importDefault(require("xss"));
const hpp_1 = __importDefault(require("hpp"));
// Rate limiting configurations
exports.generalRateLimit = (0, express_rate_limit_1.default)({
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
        return req.path === '/health';
    }
});
exports.authRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 auth requests per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true // Don't count successful requests
});
exports.chatRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 chat messages per minute
    message: {
        error: 'Too many messages sent, please slow down.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false
});
exports.supportRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Support users can send more messages
    message: {
        error: 'Too many support actions, please slow down.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false
});
// Slow down middleware for additional protection
exports.speedLimiter = (0, express_slow_down_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // Allow 50 requests per windowMs without delay
    delayMs: () => 500, // Add 500ms delay per request after delayAfter (new v2 format)
    maxDelayMs: 20000, // Maximum delay of 20 seconds
});
// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Sanitize against NoSQL injection attacks
    express_mongo_sanitize_1.default.sanitize(req.body);
    express_mongo_sanitize_1.default.sanitize(req.query);
    express_mongo_sanitize_1.default.sanitize(req.params);
    // Sanitize against XSS attacks
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = (0, xss_1.default)(req.body[key]);
            }
        }
    }
    next();
};
exports.sanitizeInput = sanitizeInput;
// Parameter pollution protection
exports.parameterPollutionProtection = (0, hpp_1.default)({
    whitelist: ['status', 'limit', 'page'] // Allow these parameters to be arrays
});
// Validation error handler
const handleValidationErrors = (req, res, next) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.type === 'field' ? err.path : 'unknown',
                message: err.msg,
                value: err.type === 'field' ? err.value : undefined
            }))
        });
    }
    next();
};
exports.handleValidationErrors = handleValidationErrors;
// Common validation rules
exports.validateEmail = (0, express_validator_1.body)('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Must be a valid email address');
exports.validatePassword = (0, express_validator_1.body)('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number');
exports.validateName = (0, express_validator_1.body)('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z\s\-'\.]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods');
exports.validateRole = (0, express_validator_1.body)('role')
    .isIn(['user', 'support'])
    .withMessage('Role must be either "user" or "support"');
exports.validateMessage = (0, express_validator_1.body)('message')
    .optional()
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message must be between 1 and 5000 characters');
exports.validateConversationId = (0, express_validator_1.param)('conversationId')
    .isUUID()
    .withMessage('Conversation ID must be a valid UUID');
exports.validateTicketId = (0, express_validator_1.param)('ticketId')
    .matches(/^[A-Z]+-\d+$/)
    .withMessage('Ticket ID must be in format PROJECT-123');
exports.validateStatus = (0, express_validator_1.body)('status')
    .optional()
    .isIn(['open', 'assigned', 'closed', 'To Do', 'In Progress', 'Done'])
    .withMessage('Invalid status value');
exports.validatePagination = [
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100')
];
// Security headers middleware
const securityHeaders = (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy
    res.setHeader('Content-Security-Policy', "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https:; " +
        "font-src 'self'; " +
        "object-src 'none'; " +
        "media-src 'self'; " +
        "frame-src 'none';");
    // Permissions Policy (formerly Feature Policy)
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
};
exports.securityHeaders = securityHeaders;
// Request logging middleware for security monitoring
const securityLogger = (req, res, next) => {
    const startTime = Date.now();
    // Log security-relevant information
    const logData = {
        timestamp: new Date().toISOString(),
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        method: req.method,
        url: req.url,
        referer: req.get('Referer'),
        contentLength: req.get('Content-Length')
    };
    // Log suspicious patterns
    const suspiciousPatterns = [
        /\b(union|select|insert|delete|drop|create|alter)\b/i, // SQL injection
        /<script|javascript:|vbscript:|onload=|onerror=/i, // XSS
        /\.\.\//g, // Path traversal
        /%00|%2e%2e|%252e/i, // Encoded path traversal
        /eval\(|expression\(|javascript:/i // Code injection
    ];
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(req.url) ||
        pattern.test(JSON.stringify(req.body)) ||
        pattern.test(JSON.stringify(req.query)));
    if (isSuspicious) {
        console.warn('🚨 SECURITY ALERT - Suspicious request detected:', logData);
    }
    // Continue with request
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        if (duration > 5000) { // Log slow requests
            console.warn('⚠️  Slow request detected:', { ...logData, duration, status: res.statusCode });
        }
    });
    next();
};
exports.securityLogger = securityLogger;
// Brute force protection middleware
const bruteForceProtection = async (req, res, next) => {
    try {
        const { AuthService } = await Promise.resolve().then(() => __importStar(require('@/services/auth')));
        const { email } = req.body;
        const ipAddress = req.ip || 'unknown';
        if (email && await AuthService.isAccountLocked(email, ipAddress)) {
            return res.status(423).json({
                error: 'Account temporarily locked due to multiple failed attempts. Please try again later.',
                retryAfter: '15 minutes'
            });
        }
        next();
    }
    catch (error) {
        console.error('Brute force protection error:', error);
        next(); // Continue on error to avoid blocking legitimate requests
    }
};
exports.bruteForceProtection = bruteForceProtection;
// File upload security
const validateFileUpload = (req, res, next) => {
    if (!req.file) {
        return next();
    }
    const file = req.file;
    const allowedMimeTypes = [
        'audio/webm', 'audio/mp3', 'audio/wav', 'audio/x-wav',
        'audio/wave', 'audio/x-pn-wav', 'audio/flac', 'audio/ogg',
        'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/aac'
    ];
    // Validate MIME type
    if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
            error: 'Invalid file type',
            message: 'Only audio files are allowed'
        });
    }
    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        return res.status(400).json({
            error: 'File too large',
            message: 'Maximum file size is 10MB'
        });
    }
    // Validate filename
    const dangerousPatterns = /[<>:"/\\|?*\x00-\x1f]/;
    if (dangerousPatterns.test(file.originalname)) {
        return res.status(400).json({
            error: 'Invalid filename',
            message: 'Filename contains invalid characters'
        });
    }
    next();
};
exports.validateFileUpload = validateFileUpload;
//# sourceMappingURL=security.js.map