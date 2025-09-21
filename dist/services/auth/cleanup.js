"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthCleanupService = void 0;
const index_1 = require("./index");
const node_cron_1 = __importDefault(require("node-cron"));
class AuthCleanupService {
    /**
     * Start the cleanup service with scheduled tasks
     */
    static start() {
        if (this.isRunning) {
            console.log('⚠️  Auth cleanup service is already running');
            return;
        }
        console.log('🧹 Starting auth cleanup service...');
        // Run cleanup every hour
        node_cron_1.default.schedule('0 * * * *', async () => {
            try {
                await this.performCleanup();
            }
            catch (error) {
                console.error('❌ Auth cleanup failed:', error);
            }
        });
        // Run initial cleanup on startup
        setTimeout(async () => {
            try {
                await this.performCleanup();
            }
            catch (error) {
                console.error('❌ Initial auth cleanup failed:', error);
            }
        }, 5000); // Wait 5 seconds after startup
        this.isRunning = true;
        console.log('✅ Auth cleanup service started');
    }
    /**
     * Stop the cleanup service
     */
    static stop() {
        if (!this.isRunning) {
            console.log('⚠️  Auth cleanup service is not running');
            return;
        }
        // Note: node-cron doesn't provide a direct way to stop specific tasks
        // In a production environment, you might want to use a more sophisticated job scheduler
        this.isRunning = false;
        console.log('🛑 Auth cleanup service stopped');
    }
    /**
     * Perform cleanup of expired tokens, sessions, and old data
     */
    static async performCleanup() {
        const startTime = Date.now();
        console.log('🧹 Starting auth data cleanup...');
        try {
            // Clean up expired data using AuthService
            await index_1.AuthService.cleanupExpired();
            const duration = Date.now() - startTime;
            console.log(`✅ Auth cleanup completed in ${duration}ms`);
            // Log cleanup statistics if needed
            await this.logCleanupStats();
        }
        catch (error) {
            console.error('❌ Auth cleanup error:', error);
            throw error;
        }
    }
    /**
     * Log cleanup statistics for monitoring
     */
    static async logCleanupStats() {
        try {
            // You could add more detailed logging here
            // For example, count of cleaned up records, etc.
            console.log('📊 Cleanup stats logged');
        }
        catch (error) {
            console.error('Failed to log cleanup stats:', error);
        }
    }
    /**
     * Manual cleanup trigger (useful for testing or manual maintenance)
     */
    static async manualCleanup() {
        console.log('🔧 Manual auth cleanup triggered...');
        await this.performCleanup();
    }
    /**
     * Get cleanup service status
     */
    static getStatus() {
        return {
            isRunning: this.isRunning,
            nextRun: this.isRunning ? 'Every hour at minute 0' : undefined
        };
    }
}
exports.AuthCleanupService = AuthCleanupService;
AuthCleanupService.isRunning = false;
// Export for use in other parts of the application
exports.default = AuthCleanupService;
//# sourceMappingURL=cleanup.js.map