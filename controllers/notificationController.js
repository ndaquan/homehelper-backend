const Notification = require('../models/Notification');

class NotificationController {
  // Lấy danh sách thông báo của user
  static async getNotifications(req, res) {
    try {
      const userId = req.user.user_id;
      const { page = 1, limit = 20, type, is_read, date_from, date_to } = req.query;

      const filters = {};
      if (type) filters.type = type;
      if (is_read !== undefined) filters.is_read = is_read === 'true';
      if (date_from) filters.date_from = new Date(date_from);
      if (date_to) filters.date_to = new Date(date_to);

      const result = await Notification.findByUserId(userId, parseInt(page), parseInt(limit), filters);

      res.status(200).json({
        message: 'Lấy danh sách thông báo thành công',
        ...result
      });
    } catch (error) {
      console.error('Lỗi lấy danh sách thông báo:', error);
      if (String(error.message).includes('Invalid object name')) {
        return res.status(200).json({
          message: 'Lấy danh sách thông báo thành công',
          notifications: [],
          total: 0,
          page: parseInt(req.query.page || 1),
          limit: parseInt(req.query.limit || 20),
          totalPages: 0,
          hasMore: false
        });
      }
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy thông báo theo ID
  static async getNotification(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.user_id;

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        return res.status(404).json({
          error: 'Không tìm thấy thông báo'
        });
      }

      // Kiểm tra quyền truy cập
      if (notification.user_id !== userId) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập thông báo này'
        });
      }

      res.status(200).json({
        message: 'Lấy thông báo thành công',
        notification
      });
    } catch (error) {
      console.error('Lỗi lấy thông báo:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Đánh dấu thông báo đã đọc
  static async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.user_id;

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        return res.status(404).json({
          error: 'Không tìm thấy thông báo'
        });
      }

      // Kiểm tra quyền truy cập
      if (notification.user_id !== userId) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập thông báo này'
        });
      }

      const updatedNotification = await Notification.markAsRead(notificationId);

      res.status(200).json({
        message: 'Đánh dấu thông báo đã đọc thành công',
        notification: updatedNotification
      });
    } catch (error) {
      console.error('Lỗi đánh dấu thông báo đã đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Đánh dấu tất cả thông báo đã đọc
  static async markAllAsRead(req, res) {
    try {
      const userId = req.user.user_id;

      await Notification.markAllAsRead(userId);

      res.status(200).json({
        message: 'Đánh dấu tất cả thông báo đã đọc thành công'
      });
    } catch (error) {
      console.error('Lỗi đánh dấu tất cả thông báo đã đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa thông báo
  static async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.user_id;

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        return res.status(404).json({
          error: 'Không tìm thấy thông báo'
        });
      }

      // Kiểm tra quyền truy cập
      if (notification.user_id !== userId) {
        return res.status(403).json({
          error: 'Bạn không có quyền xóa thông báo này'
        });
      }

      await Notification.delete(notificationId);

      res.status(200).json({
        message: 'Xóa thông báo thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa thông báo:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa tất cả thông báo đã đọc
  static async deleteReadNotifications(req, res) {
    try {
      const userId = req.user.user_id;

      await Notification.deleteReadNotifications(userId);

      res.status(200).json({
        message: 'Xóa tất cả thông báo đã đọc thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa thông báo đã đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Đếm thông báo chưa đọc
  static async countUnreadNotifications(req, res) {
    try {
      const userId = req.user.user_id;

      const unreadCount = await Notification.countUnread(userId);

      res.status(200).json({
        message: 'Đếm thông báo chưa đọc thành công',
        unread_count: unreadCount
      });
    } catch (error) {
      console.error('Lỗi đếm thông báo chưa đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Lấy thông báo chưa đọc
  static async getUnreadNotifications(req, res) {
    try {
      const userId = req.user.user_id;
      const { limit = 10 } = req.query;

      const unreadNotifications = await Notification.getUnreadNotifications(userId, parseInt(limit));

      res.status(200).json({
        message: 'Lấy thông báo chưa đọc thành công',
        notifications: unreadNotifications
      });
    } catch (error) {
      console.error('Lỗi lấy thông báo chưa đọc:', error);
      if (String(error.message).includes('Invalid object name')) {
        return res.status(200).json({
          message: 'Lấy thông báo chưa đọc thành công',
          notifications: []
        });
      }
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy thống kê thông báo
  static async getNotificationStats(req, res) {
    try {
      const userId = req.user.user_id;

      const stats = await Notification.getNotificationStats(userId);

      res.status(200).json({
        message: 'Lấy thống kê thông báo thành công',
        stats
      });
    } catch (error) {
      console.error('Lỗi lấy thống kê thông báo:', error);
      if (String(error.message).includes('Invalid object name')) {
        return res.status(200).json({
          message: 'Lấy thống kê thông báo thành công',
          stats: { total: 0, unread: 0, byType: {} }
        });
      }
      res.status(500).json({ error: error.message });
    }
  }

  // Tạo thông báo mới (chỉ admin)
  static async createNotification(req, res) {
    try {
      const userRole = req.user.role;
      
      // Chỉ admin mới có quyền tạo thông báo
      if (userRole !== 'Admin') {
        return res.status(403).json({
          error: 'Chỉ admin mới có quyền tạo thông báo'
        });
      }

      const { user_id, title, content, type, data, expires_at } = req.body;

      // Validate input
      if (!user_id || !title || !content || !type) {
        return res.status(400).json({
          error: 'Thiếu thông tin bắt buộc: user_id, title, content, type'
        });
      }

      // Kiểm tra type hợp lệ
      if (!['message', 'booking', 'payment', 'system', 'rating', 'task'].includes(type)) {
        return res.status(400).json({
          error: 'Type không hợp lệ'
        });
      }

      const notificationData = {
        user_id,
        title,
        content,
        type,
        data,
        expires_at: expires_at ? new Date(expires_at) : null
      };

      const notification = await Notification.create(notificationData);

      res.status(201).json({
        message: 'Tạo thông báo thành công',
        notification
      });
    } catch (error) {
      console.error('Lỗi tạo thông báo:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Tạo thông báo cho nhiều user (chỉ admin)
  static async createNotificationForMultipleUsers(req, res) {
    try {
      const userRole = req.user.role;
      
      // Chỉ admin mới có quyền tạo thông báo
      if (userRole !== 'Admin') {
        return res.status(403).json({
          error: 'Chỉ admin mới có quyền tạo thông báo'
        });
      }

      const { user_ids, title, content, type, data, expires_at } = req.body;

      // Validate input
      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({
          error: 'user_ids phải là mảng không rỗng'
        });
      }

      if (!title || !content || !type) {
        return res.status(400).json({
          error: 'Thiếu thông tin bắt buộc: title, content, type'
        });
      }

      // Kiểm tra type hợp lệ
      if (!['message', 'booking', 'payment', 'system', 'rating', 'task'].includes(type)) {
        return res.status(400).json({
          error: 'Type không hợp lệ'
        });
      }

      const notificationData = {
        title,
        content,
        type,
        data,
        expires_at: expires_at ? new Date(expires_at) : null
      };

      await Notification.createForMultipleUsers(user_ids, notificationData);

      res.status(201).json({
        message: `Tạo thông báo cho ${user_ids.length} user thành công`
      });
    } catch (error) {
      console.error('Lỗi tạo thông báo cho nhiều user:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa thông báo hết hạn (chỉ admin)
  static async deleteExpiredNotifications(req, res) {
    try {
      const userRole = req.user.role;
      
      // Chỉ admin mới có quyền xóa thông báo hết hạn
      if (userRole !== 'Admin') {
        return res.status(403).json({
          error: 'Chỉ admin mới có quyền xóa thông báo hết hạn'
        });
      }

      const deletedCount = await Notification.deleteExpiredNotifications();

      res.status(200).json({
        message: 'Xóa thông báo hết hạn thành công',
        deleted_count: deletedCount
      });
    } catch (error) {
      console.error('Lỗi xóa thông báo hết hạn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }
}

module.exports = NotificationController;
