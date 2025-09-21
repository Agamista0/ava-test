"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabase_1 = require("@/lib/supabase");
const express_1 = require("express");
const auth_1 = require("@/services/auth");
const router = (0, express_1.Router)();
// Refresh token endpoint
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    if (!refreshToken) {
        return res.status(400).json({ error: 'Missing refresh token' });
    }
    try {
        // Verify refresh token
        const payload = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_SECRET, {
            issuer: 'ava-chat-system',
            audience: 'ava-chat-users',
            algorithms: ['HS256']
        });
        // Check if refresh token is blacklisted
        if (payload.jti && await auth_1.AuthService.isTokenBlacklisted(payload.jti)) {
            await auth_1.AuthService.logSecurityEvent(payload.sub, 'refresh_token_blacklisted', ipAddress, userAgent, { jti: payload.jti }, 'warning');
            return res.status(401).json({ error: 'Token has been revoked' });
        }
        // Check if session is still active
        if (payload.sessionId && !await auth_1.AuthService.isSessionActive(payload.sessionId)) {
            await auth_1.AuthService.logSecurityEvent(payload.sub, 'refresh_token_inactive_session', ipAddress, userAgent, { sessionId: payload.sessionId }, 'warning');
            return res.status(401).json({ error: 'Session has expired' });
        }
        // Get user profile
        const { data: profile, error: profileError } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', payload.sub)
            .single();
        if (profileError || !profile) {
            await auth_1.AuthService.logSecurityEvent(payload.sub, 'refresh_token_profile_not_found', ipAddress, userAgent, { error: profileError?.message }, 'warning');
            return res.status(401).json({ error: 'Profile not found' });
        }
        // Generate new access token
        const { accessToken } = auth_1.AuthService.generateTokens(payload.sub, profile.role, payload.sessionId);
        // Update session activity
        if (payload.sessionId) {
            await auth_1.AuthService.updateSessionActivity(payload.sessionId);
        }
        // Log successful token refresh
        await auth_1.AuthService.logSecurityEvent(payload.sub, 'token_refreshed', ipAddress, userAgent, { sessionId: payload.sessionId }, 'info');
        res.json({ accessToken });
    }
    catch (err) {
        await auth_1.AuthService.logSecurityEvent(null, 'refresh_token_invalid', ipAddress, userAgent, { error: err instanceof Error ? err.message : 'Unknown error' }, 'warning');
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});
exports.default = router;
//# sourceMappingURL=refresh.js.map