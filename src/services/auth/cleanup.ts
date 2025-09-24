import { AuthService } from './index'
import cron from 'node-cron'

export class AuthCleanupService {
  private static isRunning = false

  /**
   * Start the cleanup service with scheduled tasks
   */
  static start(): void {
    if (this.isRunning) {
      console.log('Auth cleanup service is already running')
      return
    }

    console.log('Starting auth cleanup service')

    // Run cleanup every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.performCleanup()
      } catch (error) {
        console.error('❌ Auth cleanup failed:', error)
      }
    })

    // Run initial cleanup on startup
    setTimeout(async () => {
      try {
        await this.performCleanup()
      } catch (error) {
        console.error('❌ Initial auth cleanup failed:', error)
      }
    }, 5000) // Wait 5 seconds after startup

    this.isRunning = true
    console.log('Auth cleanup service started')
  }

  /**
   * Stop the cleanup service
   */
  static stop(): void {
    if (!this.isRunning) {
      console.log('Auth cleanup service is not running')
      return
    }

    // Note: node-cron doesn't provide a direct way to stop specific tasks
    // In a production environment, you might want to use a more sophisticated job scheduler
    this.isRunning = false
    console.log('🛑 Auth cleanup service stopped')
  }

  /**
   * Perform cleanup of expired tokens, sessions, and old data
   */
  static async performCleanup(): Promise<void> {
    const startTime = Date.now()
    console.log('🧹 Starting auth data cleanup...')

    try {
      // Clean up expired data using AuthService
      await AuthService.cleanupExpired()

      const duration = Date.now() - startTime
      console.log(`Auth cleanup completed in ${duration}ms`)

      // Log cleanup statistics if needed
      await this.logCleanupStats()
    } catch (error) {
      console.error('Auth cleanup error:', error)
      throw error
    }
  }

  /**
   * Log cleanup statistics for monitoring
   */
  private static async logCleanupStats(): Promise<void> {
    try {
      // You could add more detailed logging here
      // For example, count of cleaned up records, etc.
      console.log('📊 Cleanup stats logged')
    } catch (error) {
      console.error('Failed to log cleanup stats:', error)
    }
  }

  /**
   * Manual cleanup trigger (useful for testing or manual maintenance)
   */
  static async manualCleanup(): Promise<void> {
    console.log('🔧 Manual auth cleanup triggered...')
    await this.performCleanup()
  }

  /**
   * Get cleanup service status
   */
  static getStatus(): { isRunning: boolean; nextRun?: string } {
    return {
      isRunning: this.isRunning,
      nextRun: this.isRunning ? 'Every hour at minute 0' : undefined
    }
  }
}

// Export for use in other parts of the application
export default AuthCleanupService
