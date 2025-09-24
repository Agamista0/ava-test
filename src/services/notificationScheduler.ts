import * as cron from 'node-cron';
import { notificationService } from './notificationService';

class NotificationScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  /**
   * Start all notification cron jobs
   */
  start(): void {
    console.log('Starting notification scheduler...');

    // Process queued notifications every minute
    const queueJob = cron.schedule('* * * * *', async () => {
      try {
        await notificationService.processQueuedNotifications();
      } catch (error) {
        console.error('Error in queue processing job:', error);
      }
    }, {
      timezone: 'UTC'
    });

    // Process custom scheduled notifications every minute
    const customJob = cron.schedule('* * * * *', async () => {
      try {
        await notificationService.scheduleCustomNotifications();
      } catch (error) {
        console.error('Error in custom notification processing job:', error);
      }
    }, {
      timezone: 'UTC'
    });

    // Clean up old notifications daily at 2 AM UTC
    const cleanupJob = cron.schedule('0 2 * * *', async () => {
      try {
        await notificationService.cleanupOldNotifications();
      } catch (error) {
        console.error('Error in cleanup job:', error);
      }
    }, {
      timezone: 'UTC'
    });

    // Start all jobs
    queueJob.start();
    customJob.start();
    cleanupJob.start();

    // Store jobs for management
    this.jobs.set('queue', queueJob);
    this.jobs.set('custom', customJob);
    this.jobs.set('cleanup', cleanupJob);

    console.log('Notification scheduler started successfully');
    console.log('Jobs running:');
    console.log('- Queue processor: every minute');
    console.log('- Custom notifications: every minute');
    console.log('- Cleanup: daily at 2 AM UTC');
  }

  /**
   * Stop all notification cron jobs
   */
  stop(): void {
    console.log('Stopping notification scheduler...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`Stopped ${name} job`);
    });

    this.jobs.clear();
    console.log('Notification scheduler stopped');
  }

  /**
   * Stop a specific job
   */
  stopJob(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (job) {
      job.stop();
      this.jobs.delete(jobName);
      console.log(`Stopped ${jobName} job`);
    } else {
      console.log(`Job ${jobName} not found`);
    }
  }

  /**
   * Start a specific job
   */
  startJob(jobName: string): void {
    const job = this.jobs.get(jobName);
    if (job) {
      job.start();
      console.log(`Started ${jobName} job`);
    } else {
      console.log(`Job ${jobName} not found`);
    }
  }

  /**
   * Get status of all jobs
   */
  getJobStatus(): { [key: string]: boolean } {
    const status: { [key: string]: boolean } = {};
    
    this.jobs.forEach((job, name) => {
      // Note: node-cron doesn't expose running status, so we assume they're running if they exist
      status[name] = true;
    });

    return status;
  }

  /**
   * Manually trigger queue processing
   */
  async triggerQueueProcessing(): Promise<void> {
    console.log('Manually triggering queue processing...');
    try {
      await notificationService.processQueuedNotifications();
      console.log('Queue processing completed');
    } catch (error) {
      console.error('Error in manual queue processing:', error);
      throw error;
    }
  }

  /**
   * Manually trigger custom notification processing
   */
  async triggerCustomNotificationProcessing(): Promise<void> {
    console.log('Manually triggering custom notification processing...');
    try {
      await notificationService.scheduleCustomNotifications();
      console.log('Custom notification processing completed');
    } catch (error) {
      console.error('Error in manual custom notification processing:', error);
      throw error;
    }
  }

  /**
   * Manually trigger cleanup
   */
  async triggerCleanup(): Promise<void> {
    console.log('Manually triggering cleanup...');
    try {
      await notificationService.cleanupOldNotifications();
      console.log('Cleanup completed');
    } catch (error) {
      console.error('Error in manual cleanup:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const notificationScheduler = new NotificationScheduler();

// Export convenience functions
export const startNotificationScheduler = () => notificationScheduler.start();
export const stopNotificationScheduler = () => notificationScheduler.stop();
export const getSchedulerStatus = () => notificationScheduler.getJobStatus();
export const triggerQueueProcessing = () => notificationScheduler.triggerQueueProcessing();
export const triggerCustomNotifications = () => notificationScheduler.triggerCustomNotificationProcessing();
export const triggerCleanup = () => notificationScheduler.triggerCleanup();