"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const lib_1 = require("@/lib");
const env_validation_1 = require("@/lib/env-validation");
const security_1 = require("@/middleware/security");
const routes_1 = __importDefault(require("./features/auth/routes"));
const refresh_1 = __importDefault(require("./features/auth/refresh"));
const routes_2 = __importDefault(require("./features/chat/routes"));
const support_routes_1 = __importDefault(require("./features/chat/support-routes"));
const cleanup_1 = __importDefault(require("./services/auth/cleanup"));
// Validate environment variables before starting
const envValidation = (0, env_validation_1.validateEnvironment)();
(0, env_validation_1.printValidationResults)(envValidation);
if (!envValidation.isValid) {
    console.error('Cannot start server due to environment validation errors.');
    console.error('Please fix the above errors and restart the server.');
    process.exit(1);
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Trust proxy for accurate IP addresses behind reverse proxy
app.set('trust proxy', 1);
// Security middleware (applied first)
app.use(security_1.securityHeaders);
app.use(security_1.securityLogger);
app.use(security_1.generalRateLimit);
app.use(security_1.speedLimiter);
// Compression middleware
app.use((0, compression_1.default)());
// Helmet for security headers (with custom CSP disabled since we set our own)
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false, // We set our own CSP in securityHeaders
    crossOriginEmbedderPolicy: false // Allow embedding for development
}));
// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = process.env.FRONTEND_URL?.split(',') || ['http://localhost:3000', 'http://localhost:8081'];
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
};
app.use((0, cors_1.default)(corsOptions));
// Body parsing middleware
app.use(express_1.default.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        // Store raw body for webhook verification if needed
        req.rawBody = buf;
    }
}));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Input sanitization and security
app.use(security_1.sanitizeInput);
app.use(security_1.parameterPollutionProtection);
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});
// Simple test endpoint for CORS debugging
app.get('/test', (req, res) => {
    res.json({
        message: 'Test endpoint working',
        origin: req.headers.origin,
        method: req.method
    });
});
app.post('/test', (req, res) => {
    res.json({
        message: 'POST test endpoint working',
        origin: req.headers.origin,
        body: req.body
    });
});
// API routes
app.use('/api/auth', routes_1.default);
app.use('/api/auth', refresh_1.default);
app.use('/api/chat', routes_2.default);
app.use('/api/support', support_routes_1.default);
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
});
// Initialize Supabase listeners
async function initializeApp() {
    try {
        // Supabase connectivity check
        const { error } = await lib_1.supabaseAdmin.from('').select('*').limit(1);
        if (error) {
            console.error('Supabase connection failed:', error);
            process.exit(1);
        }
        else {
            console.log('✅ Supabase connection successful');
        }
        // Initialize event listeners
        // Start auth cleanup service
        cleanup_1.default.start();
        // Start the server
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📚 Health check: http://localhost:${PORT}/health`);
        });
    }
    catch (error) {
        console.error('Failed to initialize app:', error);
        process.exit(1);
    }
}
// Start the application
initializeApp();
//# sourceMappingURL=index.js.map