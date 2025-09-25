import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticateUser, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { 
  notificationService, 
  sendPushNotification, 
  sendPushToRole, 
  queueNotification 
} from '../services/notificationService';
import { 
  notificationScheduler,
  triggerQueueProcessing,
  triggerCustomNotifications,
  getSchedulerStatus 
} from '../services/notificationScheduler';

const router = Router();

// Middleware to handle validation errors
const handleValidationErrors = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
};

/**
 * GET /api/notifications/preferences
 * Get user's notification preferences
 */
router.get('/preferences', authenticateUser, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  try {
    const userId = authReq.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .select(`
        *,
        notification_types(*)
      `)
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching notification preferences:', error);
      return res.status(500).json({ error: 'Failed to fetch preferences' });
    }

    res.json({ preferences: data || [] });
  } catch (error) {
    console.error('Error in GET /preferences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/notifications/preferences
 * Update user's notification preferences
 */
router.put('/preferences', 
  authenticateUser,
  body('notificationType').isString().notEmpty(),
  body('pushEnabled').isBoolean(),
  body('emailEnabled').optional().isBoolean(),
  body('smsEnabled').optional().isBoolean(),
  body('inAppEnabled').optional().isBoolean(),
  body('quietHoursStart').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('quietHoursEnd').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('timezone').optional().isString(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        notificationType,
        pushEnabled,
        emailEnabled = false,
        smsEnabled = false,
        inAppEnabled = true,
        quietHoursStart,
        quietHoursEnd,
        timezone = 'UTC'
      } = req.body;

      // Get notification type ID
      const { data: notificationTypeData, error: typeError } = await supabaseAdmin
        .from('notification_types')
        .select('id')
        .eq('name', notificationType)
        .single();

      if (typeError || !notificationTypeData) {
        return res.status(400).json({ error: 'Invalid notification type' });
      }

      // Upsert preferences
      const { error } = await supabaseAdmin
        .from('notification_preferences')
        .upsert({
          user_id: userId,
          notification_type_id: notificationTypeData.id,
          push_enabled: pushEnabled,
          email_enabled: emailEnabled,
          sms_enabled: smsEnabled,
          in_app_enabled: inAppEnabled,
          quiet_hours_start: quietHoursStart,
          quiet_hours_end: quietHoursEnd,
          timezone,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,notification_type_id'
        });

      if (error) {
        console.error('Error updating notification preferences:', error);
        return res.status(500).json({ error: 'Failed to update preferences' });
      }

      res.json({ message: 'Preferences updated successfully' });
    } catch (error) {
      console.error('Error in PUT /preferences:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/notifications/history
 * Get user's notification history
 */
router.get('/history',
  authenticateUser,
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  query('type').optional().isString(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const type = req.query.type as string;

      let query = supabaseAdmin
        .from('notification_history')
        .select(`
          *,
          notification_types(name, display_name)
        `)
        .eq('user_id', userId)
        .order('sent_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (type) {
        query = query.eq('notification_types.name', type);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching notification history:', error);
        return res.status(500).json({ error: 'Failed to fetch history' });
      }

      res.json({ notifications: data || [] });
    } catch (error) {
      console.error('Error in GET /history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/notifications/send
 * Send immediate notification (support/admin only)
 */
router.post('/send',
  authenticateUser,
  requireRole(['support', 'admin']),
  body('userId').optional().isUUID(),
  body('role').optional().isIn(['user', 'support', 'admin']),
  body('title').isString().isLength({ min: 1, max: 100 }),
  body('message').isString().isLength({ min: 1, max: 500 }),
  body('type').optional().isString(),
  body('data').optional().isObject(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
    try {
      const { userId, role, title, message, type = 'system_announcement', data } = req.body;

      const notificationData = {
        title,
        body: message,
        data: data || {}
      };

      let result: any;

      if (userId) {
        // Send to specific user
        result = await sendPushNotification(userId, notificationData, type);
      } else if (role) {
        // Send to all users with specific role
        result = await sendPushToRole(role, notificationData, type);
      } else {
        return res.status(400).json({ error: 'Either userId or role must be specified' });
      }

      res.json({
        message: 'Notification sent',
        result: {
          success: result.success || result.totalSuccess,
          failure: result.failure || result.totalFailure,
          errors: result.errors || []
        }
      });
    } catch (error) {
      console.error('Error in POST /send:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/notifications/register-device
 * Register device for push notifications
 */
router.post('/register-device',
  authenticateUser,
  body('deviceToken').isString().notEmpty(),
  body('deviceType').isIn(['ios', 'android', 'web']),
  body('deviceName').optional().isString(),
  body('appVersion').optional().isString(),
  body('osVersion').optional().isString(),
  handleValidationErrors,
  async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
    try {
      const userId = authReq.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { deviceToken, deviceType, deviceName, appVersion, osVersion } = req.body;

      const { error } = await supabaseAdmin
        .from('user_devices')
        .upsert({
          user_id: userId,
          device_token: deviceToken,
          device_type: deviceType,
          device_name: deviceName,
          app_version: appVersion,
          os_version: osVersion,
          is_active: true,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,device_token'
        });

      if (error) {
        console.error('Error registering device:', error);
        return res.status(500).json({ error: 'Failed to register device' });
      }

      res.json({ message: 'Device registered successfully' });
    } catch (error) {
      console.error('Error in POST /register-device:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/notifications/types
 * Get available notification types
 */
router.get('/types', authenticateUser, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_types')
      .select('*')
      .eq('is_active', true)
      .order('display_name');

    if (error) {
      console.error('Error fetching notification types:', error);
      return res.status(500).json({ error: 'Failed to fetch notification types' });
    }

    res.json({ types: data || [] });
  } catch (error) {
    console.error('Error in GET /types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;