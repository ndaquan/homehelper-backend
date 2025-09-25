const { executeQuery } = require('../config/database');

class Notification {
  // Tạo thông báo mới
  static async create(notificationData) {
    try {
      const { user_id, title, content, type, data, expires_at } = notificationData;
      
      const query = `
        INSERT INTO Notifications (user_id, title, content, type, data, expires_at, created_at)
        VALUES (@param1, @param2, @param3, @param4, @param5, @param6, GETDATE());
        
        SELECT SCOPE_IDENTITY() AS notification_id;
      `;
      
      const params = [user_id, title, content, type, data, expires_at];
      const result = await executeQuery(query, params);
      
      const notificationId = result.recordset[0].notification_id;
      
      return await this.findById(notificationId);
    } catch (error) {
      throw new Error(`Lỗi tạo thông báo: ${error.message}`);
    }
  }

  // Tạo thông báo cho nhiều user
  static async createForMultipleUsers(userIds, notificationData) {
    try {
      const { title, content, type, data, expires_at } = notificationData;
      
      const query = `
        INSERT INTO Notifications (user_id, title, content, type, data, expires_at, created_at)
        VALUES ${userIds.map((_, index) => `(@param${index * 6 + 1}, @param${index * 6 + 2}, @param${index * 6 + 3}, @param${index * 6 + 4}, @param${index * 6 + 5}, @param${index * 6 + 6}, GETDATE())`).join(', ')};
      `;
      
      const params = [];
      userIds.forEach(userId => {
        params.push(userId, title, content, type, data, expires_at);
      });
      
      await executeQuery(query, params);
      
      return true;
    } catch (error) {
      throw new Error(`Lỗi tạo thông báo cho nhiều user: ${error.message}`);
    }
  }

  // Lấy thông báo theo ID
  static async findById(notificationId) {
    try {
      const query = `
        SELECT n.*, u.name as user_name, u.email as user_email
        FROM Notifications n
        LEFT JOIN Users u ON n.user_id = u.user_id
        WHERE n.notification_id = @param1
      `;
      
      const result = await executeQuery(query, [notificationId]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi tìm thông báo: ${error.message}`);
    }
  }

  // Lấy danh sách thông báo của user
  static async findByUserId(userId, page = 1, limit = 20, filters = {}) {
    try {
      let whereClause = 'WHERE n.user_id = @param1';
      const params = [userId];
      let paramIndex = 2;

      // Xử lý filters
      if (filters.type) {
        whereClause += ` AND n.type = @param${paramIndex}`;
        params.push(filters.type);
        paramIndex++;
      }

      if (filters.is_read !== undefined) {
        whereClause += ` AND n.is_read = @param${paramIndex}`;
        params.push(filters.is_read);
        paramIndex++;
      }

      if (filters.date_from) {
        whereClause += ` AND n.created_at >= @param${paramIndex}`;
        params.push(filters.date_from);
        paramIndex++;
      }

      if (filters.date_to) {
        whereClause += ` AND n.created_at <= @param${paramIndex}`;
        params.push(filters.date_to);
        paramIndex++;
      }

      // Loại bỏ thông báo hết hạn
      whereClause += ` AND (n.expires_at IS NULL OR n.expires_at > GETDATE())`;

      const offset = (page - 1) * limit;
      
      const query = `
        SELECT n.*
        FROM Notifications n
        ${whereClause}
        ORDER BY n.created_at DESC
        OFFSET @param${paramIndex} ROWS
        FETCH NEXT @param${paramIndex + 1} ROWS ONLY;
        
        SELECT COUNT(*) AS total
        FROM Notifications n
        ${whereClause};
      `;
      
      params.push(offset, limit);
      const result = await executeQuery(query, params);
      
      const notifications = (result.recordset && result.recordset.length > 0)
        ? result.recordset.slice(0, -1)
        : [];
      const total = (result.recordset && result.recordset.length > 0)
        ? result.recordset[result.recordset.length - 1].total
        : 0;
      
      return {
        notifications,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      throw new Error(`Lỗi lấy danh sách thông báo: ${error.message}`);
    }
  }

  // Đếm thông báo chưa đọc
  static async countUnread(userId) {
    try {
      const query = `
        SELECT COUNT(*) as unread_count
        FROM Notifications 
        WHERE user_id = @param1 
          AND is_read = 0
          AND (expires_at IS NULL OR expires_at > GETDATE())
      `;
      
      const result = await executeQuery(query, [userId]);
      
      return result.recordset[0].unread_count;
    } catch (error) {
      throw new Error(`Lỗi đếm thông báo chưa đọc: ${error.message}`);
    }
  }

  // Lấy thông báo chưa đọc
  static async getUnreadNotifications(userId, limit = 10) {
    try {
      const query = `
        SELECT TOP ${limit} n.*
        FROM Notifications n
        WHERE n.user_id = @param1 
          AND n.is_read = 0
          AND (n.expires_at IS NULL OR n.expires_at > GETDATE())
        ORDER BY n.created_at DESC
      `;
      
      const result = await executeQuery(query, [userId]);
      
      return result.recordset;
    } catch (error) {
      throw new Error(`Lỗi lấy thông báo chưa đọc: ${error.message}`);
    }
  }

  // Đánh dấu thông báo đã đọc
  static async markAsRead(notificationId) {
    try {
      const query = `
        UPDATE Notifications 
        SET is_read = 1, read_at = GETDATE()
        WHERE notification_id = @param1
      `;
      
      await executeQuery(query, [notificationId]);
      
      return await this.findById(notificationId);
    } catch (error) {
      throw new Error(`Lỗi đánh dấu thông báo đã đọc: ${error.message}`);
    }
  }

  // Đánh dấu tất cả thông báo đã đọc
  static async markAllAsRead(userId) {
    try {
      const query = `
        UPDATE Notifications 
        SET is_read = 1, read_at = GETDATE()
        WHERE user_id = @param1 AND is_read = 0
      `;
      
      await executeQuery(query, [userId]);
      
      return true;
    } catch (error) {
      throw new Error(`Lỗi đánh dấu tất cả thông báo đã đọc: ${error.message}`);
    }
  }

  // Xóa thông báo
  static async delete(notificationId) {
    try {
      const query = `
        DELETE FROM Notifications 
        WHERE notification_id = @param1
      `;
      
      await executeQuery(query, [notificationId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa thông báo: ${error.message}`);
    }
  }

  // Xóa tất cả thông báo đã đọc
  static async deleteReadNotifications(userId) {
    try {
      const query = `
        DELETE FROM Notifications 
        WHERE user_id = @param1 AND is_read = 1
      `;
      
      await executeQuery(query, [userId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa thông báo đã đọc: ${error.message}`);
    }
  }

  // Xóa thông báo hết hạn
  static async deleteExpiredNotifications() {
    try {
      const query = `
        DELETE FROM Notifications 
        WHERE expires_at IS NOT NULL AND expires_at < GETDATE()
      `;
      
      const result = await executeQuery(query);
      
      return result.rowsAffected[0];
    } catch (error) {
      throw new Error(`Lỗi xóa thông báo hết hạn: ${error.message}`);
    }
  }

  // Tạo thông báo tin nhắn mới
  static async createMessageNotification(conversationId, senderId, recipientId, messageContent) {
    try {
      const query = `
        SELECT u.name as sender_name, c.title as conversation_title
        FROM Users u, Conversations c
        WHERE u.user_id = @param1 AND c.conversation_id = @param2
      `;
      
      const result = await executeQuery(query, [senderId, conversationId]);
      
      if (result.recordset.length === 0) {
        throw new Error('Không tìm thấy thông tin sender hoặc conversation');
      }
      
      const { sender_name, conversation_title } = result.recordset[0];
      const title = `Tin nhắn mới từ ${sender_name}`;
      const content = messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent;
      const data = JSON.stringify({
        conversation_id: conversationId,
        sender_id: senderId,
        type: 'message'
      });
      
      return await this.create({
        user_id: recipientId,
        title,
        content,
        type: 'message',
        data
      });
    } catch (error) {
      throw new Error(`Lỗi tạo thông báo tin nhắn: ${error.message}`);
    }
  }

  // Tạo thông báo hệ thống
  static async createSystemNotification(userId, title, content, data = null) {
    try {
      return await this.create({
        user_id: userId,
        title,
        content,
        type: 'system',
        data: data ? JSON.stringify(data) : null
      });
    } catch (error) {
      throw new Error(`Lỗi tạo thông báo hệ thống: ${error.message}`);
    }
  }

  // Lấy thống kê thông báo
  static async getNotificationStats(userId) {
    try {
      const query = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
          SUM(CASE WHEN type = 'message' AND is_read = 0 THEN 1 ELSE 0 END) as unread_messages,
          SUM(CASE WHEN type = 'system' AND is_read = 0 THEN 1 ELSE 0 END) as unread_system,
          SUM(CASE WHEN type = 'booking' AND is_read = 0 THEN 1 ELSE 0 END) as unread_bookings,
          SUM(CASE WHEN type = 'payment' AND is_read = 0 THEN 1 ELSE 0 END) as unread_payments
        FROM Notifications 
        WHERE user_id = @param1 
          AND (expires_at IS NULL OR expires_at > GETDATE())
      `;
      
      const result = await executeQuery(query, [userId]);
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê thông báo: ${error.message}`);
    }
  }
}

module.exports = Notification;
