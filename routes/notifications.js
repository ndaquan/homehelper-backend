const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Tất cả routes đều cần authentication
router.use(authenticateToken);

// Routes cho notifications
router.get('/', NotificationController.getNotifications);
router.get('/stats', NotificationController.getNotificationStats);
router.get('/unread', NotificationController.getUnreadNotifications);
router.get('/unread/count', NotificationController.countUnreadNotifications);
router.get('/:notificationId', NotificationController.getNotification);
router.post('/:notificationId/read', NotificationController.markAsRead);
router.post('/read-all', NotificationController.markAllAsRead);
router.delete('/:notificationId', NotificationController.deleteNotification);
router.delete('/read', NotificationController.deleteReadNotifications);

// Routes chỉ dành cho admin
router.post('/', requireAdmin, NotificationController.createNotification);
router.post('/multiple', requireAdmin, NotificationController.createNotificationForMultipleUsers);
router.delete('/expired', requireAdmin, NotificationController.deleteExpiredNotifications);

module.exports = router;
