import admin from 'firebase-admin';
import { supabaseAdmin } from '../lib/supabase';

interface PushNotificationData {
  title: string;
  body: string;
  data?: { [key: string]: string };
  imageUrl?: string;
  sound?: string;
  badge?: number;
  clickAction?: string;
  icon?: string;
}

interface NotificationTarget {
  userId?: string;
  deviceTokens?: string[];
  topic?: string;
  condition?: string;
}

interface ScheduledNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  scheduledFor: Date;
  sent: boolean;
  notificationType: string;
  metadata?: any;
}

class NotificationService {
  private initialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    try {
      // Check if Firebase Admin is already initialized
      if (admin.apps.length === 0) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        
        if (!serviceAccount) {
          console.warn('Firebase Service Account Key not found. Push notifications will be disabled.');
          return;
        }

        const serviceAccountJson = JSON.parse(serviceAccount);
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccountJson),
          projectId: serviceAccountJson.project_id,
        });
      }

      this.initialized = true;
      console.log('Firebase Admin initialized for push notifications');
    } catch (error) {
      console.error('Error initializing Firebase Admin:', error);
    }
  }

  /**
   * Send push notification to specific device tokens
   */
  async sendToDevices(
    tokens: string[],
    notification: PushNotificationData,
    userId?: string
  ): Promise<{ success: number; failure: number; errors: string[] }> {
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }

    if (!tokens || tokens.length === 0) {
      return { success: 0, failure: 0, errors: ['No device tokens provided'] };
    }

    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl,
        },
        data: notification.data || {},
        android: {
          notification: {
            icon: notification.icon || 'ic_notification',
            sound: notification.sound || 'default',
            clickAction: notification.clickAction || 'FLUTTER_NOTIFICATION_CLICK',
            channelId: 'default',
            priority: 'high' as const,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              sound: notification.sound || 'default',
              badge: notification.badge,
              category: notification.clickAction,
            },
          },
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      
      const errors: string[] = [];
      const invalidTokens: string[] = [];

      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          errors.push(resp.error?.message || 'Unknown error');
          
          // Check for invalid tokens
          if (resp.error?.code === 'messaging/registration-token-not-registered' ||
              resp.error?.code === 'messaging/invalid-registration-token') {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      // Remove invalid tokens from database
      if (invalidTokens.length > 0) {
        await this.removeInvalidTokens(invalidTokens);
      }

      // Log notification to history
      if (userId) {
        await this.logNotificationToHistory(userId, notification, 'push', response.successCount > 0);
      }

      return {
        success: response.successCount,
        failure: response.failureCount,
        errors,
      };
    } catch (error) {
      console.error('Error sending push notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to a specific user (all their devices)
   */
  async sendToUser(
    userId: string,
    notification: PushNotificationData,
    notificationType: string = 'general'
  ): Promise<{ success: number; failure: number; errors: string[] }> {
    try {
      // Check if user wants to receive this type of notification
      const shouldSend = await this.shouldSendNotification(userId, notificationType, 'push');
      if (!shouldSend) {
        console.log(`User ${userId} has disabled ${notificationType} push notifications`);
        return { success: 0, failure: 0, errors: ['User has disabled this notification type'] };
      }

      // Get user's device tokens
      const { data: devices, error } = await supabaseAdmin
        .from('user_devices')
        .select('device_token')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      if (!devices || devices.length === 0) {
        console.log(`No active devices found for user ${userId}`);
        return { success: 0, failure: 0, errors: ['No active devices found'] };
      }

      const tokens = devices.map(device => device.device_token);
      return await this.sendToDevices(tokens, notification, userId);
    } catch (error) {
      console.error('Error sending notification to user:', error);
      throw error;
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendToUsers(
    userIds: string[],
    notification: PushNotificationData,
    notificationType: string = 'general'
  ): Promise<{ totalSuccess: number; totalFailure: number; userResults: any[] }> {
    const userResults = [];
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const userId of userIds) {
      try {
        const result = await this.sendToUser(userId, notification, notificationType);
        userResults.push({ userId, ...result });
        totalSuccess += result.success;
        totalFailure += result.failure;
      } catch (error) {
        userResults.push({ 
          userId, 
          success: 0, 
          failure: 1, 
          errors: [error instanceof Error ? error.message : 'Unknown error'] 
        });
        totalFailure += 1;
      }
    }

    return { totalSuccess, totalFailure, userResults };
  }

  /**
   * Send notification to users with specific role
   */
  async sendToRole(
    role: string,
    notification: PushNotificationData,
    notificationType: string = 'system_announcement'
  ): Promise<{ totalSuccess: number; totalFailure: number; userResults: any[] }> {
    try {
      // Get all users with the specified role
      const { data: users, error } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('role', role)
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      if (!users || users.length === 0) {
        return { totalSuccess: 0, totalFailure: 0, userResults: [] };
      }

      const userIds = users.map(user => user.id);
      return await this.sendToUsers(userIds, notification, notificationType);
    } catch (error) {
      console.error('Error sending notification to role:', error);
      throw error;
    }
  }

  /**
   * Queue a notification for later sending
   */
  async queueNotification(
    userId: string,
    notification: PushNotificationData,
    notificationType: string,
    scheduledFor?: Date,
    customNotificationId?: string
  ): Promise<string> {
    try {
      const { data, error } = await supabaseAdmin.rpc('queue_notification', {
        p_user_id: userId,
        p_notification_type: notificationType,
        p_title: notification.title,
        p_message: notification.body,
        p_delivery_method: 'push',
        p_scheduled_for: scheduledFor ? scheduledFor.toISOString() : new Date().toISOString(),
        p_custom_notification_id: customNotificationId,
        p_metadata: JSON.stringify(notification.data || {})
      });

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error queueing notification:', error);
      throw error;
    }
  }

  /**
   * Process queued notifications (called by cron job)
   */
  async processQueuedNotifications(): Promise<void> {
    try {
      console.log('Processing queued notifications...');

      // Get notifications that are ready to be sent
      const { data: queuedNotifications, error } = await supabaseAdmin
        .from('notification_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .lt('attempts', 3) // Don't retry more than 3 times
        .order('scheduled_for', { ascending: true })
        .limit(100); // Process in batches

      if (error) {
        throw error;
      }

      if (!queuedNotifications || queuedNotifications.length === 0) {
        console.log('No queued notifications to process');
        return;
      }

      console.log(`Processing ${queuedNotifications.length} queued notifications`);

      for (const queuedNotification of queuedNotifications) {
        try {
          // Mark as processing
          await supabaseAdmin
            .from('notification_queue')
            .update({ 
              status: 'processing',
              attempts: queuedNotification.attempts + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', queuedNotification.id);

          // Send the notification
          const notificationData: PushNotificationData = {
            title: queuedNotification.title,
            body: queuedNotification.message,
            data: queuedNotification.metadata ? JSON.parse(queuedNotification.metadata) : {},
          };

          const result = await this.sendToUser(
            queuedNotification.user_id,
            notificationData,
            queuedNotification.notification_type_id
          );

          // Update queue status based on result
          const status = result.success > 0 ? 'sent' : 'failed';
          const errorMessage = result.errors.length > 0 ? result.errors.join(', ') : null;

          await supabaseAdmin
            .from('notification_queue')
            .update({ 
              status,
              error_message: errorMessage,
              updated_at: new Date().toISOString()
            })
            .eq('id', queuedNotification.id);

          console.log(`Notification ${queuedNotification.id} ${status}`);
        } catch (error) {
          console.error(`Error processing notification ${queuedNotification.id}:`, error);
          
          // Mark as failed if max attempts reached
          const status = queuedNotification.attempts >= 2 ? 'failed' : 'pending';
          
          await supabaseAdmin
            .from('notification_queue')
            .update({ 
              status,
              error_message: error instanceof Error ? error.message : 'Unknown error',
              updated_at: new Date().toISOString()
            })
            .eq('id', queuedNotification.id);
        }
      }

      console.log('Finished processing queued notifications');
    } catch (error) {
      console.error('Error processing queued notifications:', error);
    }
  }

  /**
   * Schedule custom notifications
   */
  async scheduleCustomNotifications(): Promise<void> {
    try {
      console.log('Processing scheduled custom notifications...');

      // Get custom notifications that are ready to be sent
      const { data: customNotifications, error } = await supabaseAdmin
        .from('custom_notifications')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(50);

      if (error) {
        throw error;
      }

      if (!customNotifications || customNotifications.length === 0) {
        console.log('No custom notifications to process');
        return;
      }

      console.log(`Processing ${customNotifications.length} custom notifications`);

      for (const customNotification of customNotifications) {
        try {
          const notificationData: PushNotificationData = {
            title: customNotification.title,
            body: customNotification.message,
            data: customNotification.metadata ? JSON.parse(customNotification.metadata) : {},
          };

          let result;

          if (customNotification.target_user_id) {
            // Send to specific user
            result = await this.sendToUser(
              customNotification.target_user_id,
              notificationData,
              'custom_reminder'
            );
          } else if (customNotification.target_role) {
            // Send to all users with specific role
            result = await this.sendToRole(
              customNotification.target_role,
              notificationData,
              'custom_reminder'
            );
          } else {
            // Send to all users (system announcement)
            const { data: allUsers } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .eq('is_active', true);

            if (allUsers) {
              const userIds = allUsers.map(user => user.id);
              result = await this.sendToUsers(userIds, notificationData, 'system_announcement');
            }
          }

          // Mark as sent and set up recurring if needed
          await supabaseAdmin
            .from('custom_notifications')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', customNotification.id);

          // Handle recurring notifications
          if (customNotification.is_recurring && customNotification.recurrence_pattern) {
            await this.handleRecurringNotification(customNotification);
          }

          console.log(`Custom notification ${customNotification.id} processed successfully`);
        } catch (error) {
          console.error(`Error processing custom notification ${customNotification.id}:`, error);
          
          await supabaseAdmin
            .from('custom_notifications')
            .update({
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', customNotification.id);
        }
      }

      console.log('Finished processing custom notifications');
    } catch (error) {
      console.error('Error processing custom notifications:', error);
    }
  }

  /**
   * Handle recurring notifications
   */
  private async handleRecurringNotification(notification: any): Promise<void> {
    try {
      const pattern = JSON.parse(notification.recurrence_pattern);
      let nextSchedule: Date;

      const currentSchedule = new Date(notification.scheduled_for);

      switch (pattern.type) {
        case 'daily':
          nextSchedule = new Date(currentSchedule.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          nextSchedule = new Date(currentSchedule.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          nextSchedule = new Date(currentSchedule);
          nextSchedule.setMonth(nextSchedule.getMonth() + 1);
          break;
        default:
          return; // Unknown pattern
      }

      // Create next occurrence
      await supabaseAdmin
        .from('custom_notifications')
        .insert({
          created_by: notification.created_by,
          target_user_id: notification.target_user_id,
          target_role: notification.target_role,
          title: notification.title,
          message: notification.message,
          notification_type_id: notification.notification_type_id,
          scheduled_for: nextSchedule.toISOString(),
          is_recurring: true,
          recurrence_pattern: notification.recurrence_pattern,
          priority: notification.priority,
          status: 'scheduled',
          metadata: notification.metadata,
        });

      console.log(`Next recurring notification scheduled for ${nextSchedule.toISOString()}`);
    } catch (error) {
      console.error('Error handling recurring notification:', error);
    }
  }

  /**
   * Check if user should receive notification based on preferences
   */
  private async shouldSendNotification(
    userId: string,
    notificationType: string,
    deliveryMethod: string
  ): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin.rpc('should_send_notification', {
        p_user_id: userId,
        p_notification_type: notificationType,
        p_delivery_method: deliveryMethod
      });

      if (error) {
        console.error('Error checking notification preferences:', error);
        return true; // Default to sending if we can't check preferences
      }

      return data;
    } catch (error) {
      console.error('Error checking notification preferences:', error);
      return true; // Default to sending if we can't check preferences
    }
  }

  /**
   * Remove invalid device tokens from database
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    try {
      await supabaseAdmin
        .from('user_devices')
        .update({ is_active: false })
        .in('device_token', tokens);

      console.log(`Marked ${tokens.length} invalid tokens as inactive`);
    } catch (error) {
      console.error('Error removing invalid tokens:', error);
    }
  }

  /**
   * Log notification to history
   */
  private async logNotificationToHistory(
    userId: string,
    notification: PushNotificationData,
    deliveryMethod: string,
    success: boolean
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('notification_history')
        .insert({
          user_id: userId,
          title: notification.title,
          message: notification.body,
          delivery_method: deliveryMethod,
          status: success ? 'sent' : 'failed',
          metadata: JSON.stringify(notification.data || {}),
        });
    } catch (error) {
      console.error('Error logging notification to history:', error);
    }
  }

  /**
   * Clean up old notifications and queue items
   */
  async cleanupOldNotifications(): Promise<void> {
    try {
      console.log('Cleaning up old notifications...');

      // Delete old notification history (older than 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      await supabaseAdmin
        .from('notification_history')
        .delete()
        .lt('sent_at', ninetyDaysAgo.toISOString());

      // Delete processed queue items (older than 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      await supabaseAdmin
        .from('notification_queue')
        .delete()
        .in('status', ['sent', 'failed'])
        .lt('created_at', sevenDaysAgo.toISOString());

      console.log('Cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export convenience functions
export const sendPushNotification = (userId: string, notification: PushNotificationData, type?: string) =>
  notificationService.sendToUser(userId, notification, type);

export const sendPushToRole = (role: string, notification: PushNotificationData, type?: string) =>
  notificationService.sendToRole(role, notification, type);

export const queueNotification = (userId: string, notification: PushNotificationData, type: string, scheduledFor?: Date) =>
  notificationService.queueNotification(userId, notification, type, scheduledFor);

export { PushNotificationData, NotificationTarget, ScheduledNotification };