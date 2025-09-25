const { executeQuery } = require('../config/database');

class Message {
  // Tạo tin nhắn mới
  static async create(messageData) {
    try {
  const { conversation_id, sender_id, content, message_type = 'text', file_url, file_name, file_size } = messageData;
      
      const query = `
        INSERT INTO Messages (conversation_id, sender_id, content, message_type, file_url, file_name, file_size, created_at, updated_at)
        VALUES (@param1, @param2, @param3, @param4, @param5, @param6, @param7, GETDATE(), GETDATE());
        
        SELECT SCOPE_IDENTITY() AS message_id;
      `;
      
      const params = [conversation_id, sender_id, content, message_type, file_url, file_name, file_size];
      const result = await executeQuery(query, params);
      
      const messageId = result.recordset[0].message_id;
      
      return await this.findById(messageId);
    } catch (error) {
      throw new Error(`Lỗi tạo tin nhắn: ${error.message}`);
    }
  }

  // Lấy tin nhắn theo ID
  static async findById(messageId) {
    try {
      const query = `
        SELECT m.*, 
               u.name as sender_name,
               u.email as sender_email,
               u.role as sender_role
        FROM Messages m
        LEFT JOIN Users u ON m.sender_id = u.user_id
        WHERE m.message_id = @param1 AND m.is_deleted = 0
      `;
      
      const result = await executeQuery(query, [messageId]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi tìm tin nhắn: ${error.message}`);
    }
  }

  // Lấy danh sách tin nhắn trong cuộc trò chuyện
  static async findByConversationId(conversationId, page = 1, limit = 50, beforeMessageId = null) {
    try {
      let whereClause = 'WHERE m.conversation_id = @param1 AND m.is_deleted = 0';
      const params = [conversationId];
      let paramIndex = 2;

      // Nếu có beforeMessageId, lấy tin nhắn trước đó (cho pagination)
      if (beforeMessageId) {
        whereClause += ` AND m.message_id < @param${paramIndex}`;
        params.push(beforeMessageId);
        paramIndex++;
      }

      const offset = (page - 1) * limit;

      // Query 1: Get paginated messages
      const messagesQuery = `
        SELECT m.*, 
               u.name as sender_name,
               u.email as sender_email,
               u.role as sender_role
        FROM Messages m
        LEFT JOIN Users u ON m.sender_id = u.user_id
        ${whereClause}
        ORDER BY m.created_at DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY;
      `;
      const messagesResult = await executeQuery(messagesQuery, params);
      const messages = messagesResult.recordset.reverse(); // Reverse để có thứ tự từ cũ đến mới

      // Query 2: Get total count
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM Messages m
        ${whereClause};
      `;
      const countResult = await executeQuery(countQuery, params);
      const total = countResult.recordset[0].total;

      return {
        messages,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      throw new Error(`Lỗi lấy danh sách tin nhắn: ${error.message}`);
    }
  }

  // Lấy tin nhắn mới nhất trong cuộc trò chuyện
  static async getLatestMessage(conversationId) {
    try {
      const query = `
        SELECT TOP 1 m.*, 
               u.name as sender_name,
               u.email as sender_email
        FROM Messages m
        LEFT JOIN Users u ON m.sender_id = u.user_id
        WHERE m.conversation_id = @param1 AND m.is_deleted = 0
        ORDER BY m.created_at DESC
      `;
      
      const result = await executeQuery(query, [conversationId]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi lấy tin nhắn mới nhất: ${error.message}`);
    }
  }

  // Tìm kiếm tin nhắn
  static async search(conversationId, searchTerm, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const query = `
        SELECT m.*, 
               u.name as sender_name,
               u.email as sender_email
        FROM Messages m
        LEFT JOIN Users u ON m.sender_id = u.user_id
        WHERE m.conversation_id = @param1 
          AND m.is_deleted = 0
          AND m.content LIKE '%' + @param2 + '%'
        ORDER BY m.created_at DESC
  OFFSET ${offset} ROWS
  FETCH NEXT ${limit} ROWS ONLY;
        
        SELECT COUNT(*) AS total
        FROM Messages m
        WHERE m.conversation_id = @param1 
          AND m.is_deleted = 0
          AND m.content LIKE '%' + @param2 + '%';
      `;
      
  const result = await executeQuery(query, [conversationId, searchTerm]);
      
      const messages = result.recordset.slice(0, -1);
      const total = result.recordset[result.recordset.length - 1].total;
      
      return {
        messages,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      throw new Error(`Lỗi tìm kiếm tin nhắn: ${error.message}`);
    }
  }

  // Cập nhật tin nhắn
  static async update(messageId, updateData) {
    try {
      const allowedFields = ['content'];
      const updates = [];
      const params = [];
      let paramIndex = 1;

      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field) && value !== undefined) {
          updates.push(`${field} = @param${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (updates.length === 0) {
        throw new Error('Không có trường nào được cập nhật');
      }

      updates.push('is_edited = 1', 'updated_at = GETDATE()');
      params.push(messageId);

      const query = `
        UPDATE Messages 
        SET ${updates.join(', ')}
        WHERE message_id = @param${paramIndex}
      `;

      await executeQuery(query, params);
      
      return await this.findById(messageId);
    } catch (error) {
      throw new Error(`Lỗi cập nhật tin nhắn: ${error.message}`);
    }
  }

  // Xóa tin nhắn (soft delete)
  static async delete(messageId) {
    try {
      const query = `
        UPDATE Messages 
        SET is_deleted = 1, deleted_at = GETDATE(), updated_at = GETDATE()
        WHERE message_id = @param1
      `;
      
      await executeQuery(query, [messageId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa tin nhắn: ${error.message}`);
    }
  }

  // Xóa vĩnh viễn tin nhắn
  static async permanentDelete(messageId) {
    try {
      const query = `
        DELETE FROM Messages 
        WHERE message_id = @param1
      `;
      
      await executeQuery(query, [messageId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa vĩnh viễn tin nhắn: ${error.message}`);
    }
  }

  // Đếm tin nhắn chưa đọc
  static async countUnread(conversationId, userId) {
    try {
      const query = `
        SELECT COUNT(*) as unread_count
        FROM Messages m
        INNER JOIN ConversationParticipants cp ON m.conversation_id = cp.conversation_id
        WHERE m.conversation_id = @param1 
          AND cp.user_id = @param2
          AND m.sender_id != @param2
          AND m.is_deleted = 0
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      `;
      
      const result = await executeQuery(query, [conversationId, userId]);
      
      return result.recordset[0].unread_count;
    } catch (error) {
      throw new Error(`Lỗi đếm tin nhắn chưa đọc: ${error.message}`);
    }
  }

  // Lấy tin nhắn chưa đọc
  static async getUnreadMessages(conversationId, userId) {
    try {
      const query = `
        SELECT m.*, 
               u.name as sender_name,
               u.email as sender_email
        FROM Messages m
        INNER JOIN ConversationParticipants cp ON m.conversation_id = cp.conversation_id
        LEFT JOIN Users u ON m.sender_id = u.user_id
        WHERE m.conversation_id = @param1 
          AND cp.user_id = @param2
          AND m.sender_id != @param2
          AND m.is_deleted = 0
          AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
        ORDER BY m.created_at ASC
      `;
      
      const result = await executeQuery(query, [conversationId, userId]);
      
      return result.recordset;
    } catch (error) {
      throw new Error(`Lỗi lấy tin nhắn chưa đọc: ${error.message}`);
    }
  }

  // Kiểm tra quyền sửa/xóa tin nhắn
  static async canModify(messageId, userId) {
    try {
      const query = `
        SELECT sender_id
        FROM Messages 
        WHERE message_id = @param1 AND is_deleted = 0
      `;
      
      const result = await executeQuery(query, [messageId]);
      
      if (result.recordset.length === 0) {
        return false;
      }
      
      return result.recordset[0].sender_id === userId;
    } catch (error) {
      throw new Error(`Lỗi kiểm tra quyền: ${error.message}`);
    }
  }
}

module.exports = Message;
