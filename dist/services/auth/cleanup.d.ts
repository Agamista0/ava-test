export declare class AuthCleanupService {
    private static isRunning;
    /**
     * Start the cleanup service with scheduled tasks
     */
    static start(): void;
    /**
     * Stop the cleanup service
     */
    static stop(): void;
    /**
     * Perform cleanup of expired tokens, sessions, and old data
     */
    static performCleanup(): Promise<void>;
    /**
     * Log cleanup statistics for monitoring
     */
    private static logCleanupStats;
    /**
     * Manual cleanup trigger (useful for testing or manual maintenance)
     */
    static manualCleanup(): Promise<void>;
    /**
     * Get cleanup service status
     */
    static getStatus(): {
        isRunning: boolean;
        nextRun?: string;
    };
}
export default AuthCleanupService;
//# sourceMappingURL=cleanup.d.ts.map