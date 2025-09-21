"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.authenticateUser = exports.requireRole = void 0;
const lib_1 = require("@/lib");
const auth_1 = require("@/services/auth");
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.tokenPayload || !roles.includes(req.tokenPayload.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};
exports.requireRole = requireRole;
const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No valid authorization header' });
            return;
        }
        const token = authHeader.substring(7); // Remove "Bearer " prefix
        // Verify the JWT token using enhanced AuthService
        const tokenPayload = await auth_1.AuthService.verifyToken(token);
        if (!tokenPayload) {
            // Log failed authentication attempt
            await auth_1.AuthService.logSecurityEvent(null, 'failed_token_verification', req.ip || 'unknown', req.get('User-Agent') || 'unknown', { token_prefix: token.substring(0, 10) + '...' }, 'warning');
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        // Get user data from Supabase
        const { data: { user }, error } = await lib_1.supabaseAdmin.auth.admin.getUserById(tokenPayload.sub);
        if (error || !user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }
        // Update session activity
        if (tokenPayload.sessionId) {
            await auth_1.AuthService.updateSessionActivity(tokenPayload.sessionId);
        }
        req.user = user;
        req.tokenPayload = tokenPayload;
        req.sessionId = tokenPayload.sessionId;
        next();
    }
    catch (error) {
        console.error('Authentication error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
};
exports.authenticateUser = authenticateUser;
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const tokenPayload = await auth_1.AuthService.verifyToken(token);
            if (tokenPayload) {
                const { data: { user } } = await lib_1.supabaseAdmin.auth.admin.getUserById(tokenPayload.sub);
                if (user) {
                    req.user = user;
                    req.tokenPayload = tokenPayload;
                    req.sessionId = tokenPayload.sessionId;
                    // Update session activity
                    if (tokenPayload.sessionId) {
                        await auth_1.AuthService.updateSessionActivity(tokenPayload.sessionId);
                    }
                }
            }
        }
        next();
    }
    catch (error) {
        // Continue without authentication
        next();
    }
};
exports.optionalAuth = optionalAuth;
//# sourceMappingURL=auth.js.map