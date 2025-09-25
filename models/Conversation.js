const { executeQuery } = require('../config/database');

class Conversation {
  // Tạo cuộc trò chuyện mới
  static async create(conversationData) {
    try {
      const { title, type, created_by, participants } = conversationData;
      
      // Bắt đầu transaction
      const query = `
        SET NOCOUNT ON;
        BEGIN TRY
          BEGIN TRANSACTION;

          DECLARE @cid TABLE (conversation_id INT);

          INSERT INTO Conversations (title, type, created_by, created_at, updated_at)
          OUTPUT INSERTED.conversation_id INTO @cid
          VALUES (@param1, @param2, @param3, GETDATE(), GETDATE());

          DECLARE @conversation_id INT;
          SELECT TOP 1 @conversation_id = conversation_id FROM @cid;

          -- Thêm người tạo vào participants
          INSERT INTO ConversationParticipants (conversation_id, user_id, role, joined_at)
          VALUES (@conversation_id, @param3, 'admin', GETDATE());

          -- Thêm các participants khác
          ${participants.map((_, index) => `
            INSERT INTO ConversationParticipants (conversation_id, user_id, role, joined_at)
            VALUES (@conversation_id, @param${index + 4}, 'member', GETDATE());
          `).join('')}

          SELECT @conversation_id AS conversation_id;

          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;
      `;
      
      const params = [title, type, created_by, ...participants];
      const result = await executeQuery(query, params);
      
      const conversationId = result.recordset[0].conversation_id;
      
      return await this.findById(conversationId);
    } catch (error) {
      throw new Error(`Lỗi tạo cuộc trò chuyện: ${error.message}`);
    }
  }

  // Lấy cuộc trò chuyện theo ID
  static async findById(conversationId) {
    try {
      const query = `
        SELECT c.*, 
               u.name as created_by_name,
               u.email as created_by_email
        FROM Conversations c
        LEFT JOIN Users u ON c.created_by = u.user_id
        WHERE c.conversation_id = @param1 AND c.is_active = 1
      `;
      
      const result = await executeQuery(query, [conversationId]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      const conversation = result.recordset[0];
      
      // Lấy danh sách participants
      const participantsQuery = `
        SELECT cp.*, u.name, u.email, u.role as user_role
        FROM ConversationParticipants cp
        LEFT JOIN Users u ON cp.user_id = u.user_id
        WHERE cp.conversation_id = @param1 AND cp.is_active = 1
        ORDER BY cp.joined_at ASC
      `;
      
      const participantsResult = await executeQuery(participantsQuery, [conversationId]);
      conversation.participants = participantsResult.recordset;
      
      return conversation;
    } catch (error) {
      throw new Error(`Lỗi tìm cuộc trò chuyện: ${error.message}`);
    }
  }

  // Lấy danh sách cuộc trò chuyện của user
  static async findByUserId(userId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      // Query riêng biệt để tránh lỗi với multiple result sets
      const conversationsQuery = `
        SELECT c.*, 
               u.name as created_by_name,
               m.content as last_message_content,
               m.created_at as last_message_time,
               m.sender_id as last_message_sender_id,
               sender.name as last_message_sender_name,
               ISNULL((SELECT COUNT(*) FROM Messages m2 WHERE m2.conversation_id = c.conversation_id AND m2.created_at > ISNULL(cp.last_read_at, '1900-01-01') AND m2.sender_id != @param1), 0) as unread_count
        FROM Conversations c
        INNER JOIN ConversationParticipants cp ON c.conversation_id = cp.conversation_id
        LEFT JOIN Users u ON c.created_by = u.user_id
        LEFT JOIN Messages m ON c.conversation_id = m.conversation_id AND m.message_id = (
          SELECT TOP 1 message_id FROM Messages m3 
          WHERE m3.conversation_id = c.conversation_id AND ISNULL(m3.is_deleted, 0) = 0
          ORDER BY m3.created_at DESC
        )
        LEFT JOIN Users sender ON m.sender_id = sender.user_id
        WHERE cp.user_id = @param1 AND ISNULL(cp.is_active, 1) = 1 AND ISNULL(c.is_active, 1) = 1
        ORDER BY ISNULL(c.last_message_at, c.updated_at) DESC, c.updated_at DESC
        OFFSET @param2 ROWS
        FETCH NEXT @param3 ROWS ONLY;
      `;
      
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM Conversations c
        INNER JOIN ConversationParticipants cp ON c.conversation_id = cp.conversation_id
        WHERE cp.user_id = @param1 AND ISNULL(cp.is_active, 1) = 1 AND ISNULL(c.is_active, 1) = 1;
      `;
      
      // Thực hiện 2 query riêng biệt
      const conversationsResult = await executeQuery(conversationsQuery, [userId, offset, limit]);
      const countResult = await executeQuery(countQuery, [userId]);
      
      const conversations = conversationsResult.recordset;

      // Gắn participants tối thiểu để FE hiển thị tên đối phương
      if (conversations.length > 0) {
        const conversationIds = conversations.map(c => c.conversation_id);
        const placeholders = conversationIds.map((_, i) => `@param${i + 1}`).join(',');
        const participantsQuery = `
          SELECT cp.conversation_id, u.user_id, u.name, u.email, u.role as user_role
          FROM ConversationParticipants cp
          INNER JOIN Users u ON cp.user_id = u.user_id
          WHERE cp.conversation_id IN (${placeholders})
            AND ISNULL(cp.is_active, 1) = 1
          ORDER BY cp.joined_at ASC
        `;
        const params = conversationIds;
        const participantsResult = await executeQuery(participantsQuery, params);
        const rows = participantsResult.recordset;
        const convIdToParticipants = new Map();
        for (const row of rows) {
          if (!convIdToParticipants.has(row.conversation_id)) {
            convIdToParticipants.set(row.conversation_id, []);
          }
          convIdToParticipants.get(row.conversation_id).push({
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            user_role: row.user_role
          });
        }
        for (const conv of conversations) {
          conv.participants = convIdToParticipants.get(conv.conversation_id) || [];
        }
      }
      const total = countResult.recordset[0].total;
      
      return {
        conversations,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      throw new Error(`Lỗi lấy danh sách cuộc trò chuyện: ${error.message}`);
    }
  }

  // Tìm cuộc trò chuyện direct giữa 2 user
  static async findDirectConversation(userId1, userId2) {
    try {
      const query = `
        SELECT c.*
        FROM Conversations c
        INNER JOIN ConversationParticipants cp1 ON c.conversation_id = cp1.conversation_id
        INNER JOIN ConversationParticipants cp2 ON c.conversation_id = cp2.conversation_id
        WHERE c.type = 'direct' 
          AND c.is_active = 1
          AND cp1.user_id = @param1 AND cp1.is_active = 1
          AND cp2.user_id = @param2 AND cp2.is_active = 1
      `;
      
      const result = await executeQuery(query, [userId1, userId2]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi tìm cuộc trò chuyện direct: ${error.message}`);
    }
  }

  // Thêm participant vào cuộc trò chuyện
  static async addParticipant(conversationId, userId, role = 'member') {
    try {
      const query = `
        INSERT INTO ConversationParticipants (conversation_id, user_id, role, joined_at)
        VALUES (@param1, @param2, @param3, GETDATE())
      `;
      
      await executeQuery(query, [conversationId, userId, role]);
      
      return true;
    } catch (error) {
      throw new Error(`Lỗi thêm participant: ${error.message}`);
    }
  }

  // Xóa participant khỏi cuộc trò chuyện
  static async removeParticipant(conversationId, userId) {
    try {
      const query = `
        UPDATE ConversationParticipants 
        SET is_active = 0, left_at = GETDATE()
        WHERE conversation_id = @param1 AND user_id = @param2
      `;
      
      await executeQuery(query, [conversationId, userId]);
      
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa participant: ${error.message}`);
    }
  }

  // Cập nhật thời gian đọc cuối
  static async updateLastRead(conversationId, userId) {
    try {
      const query = `
        UPDATE ConversationParticipants 
        SET last_read_at = GETDATE()
        WHERE conversation_id = @param1 AND user_id = @param2
      `;
      
      await executeQuery(query, [conversationId, userId]);
      
      return true;
    } catch (error) {
      throw new Error(`Lỗi cập nhật thời gian đọc: ${error.message}`);
    }
  }

  // Cập nhật cuộc trò chuyện
  static async update(conversationId, updateData) {
    try {
      const allowedFields = ['title'];
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

      updates.push('updated_at = GETDATE()');
      params.push(conversationId);

      const query = `
        UPDATE Conversations 
        SET ${updates.join(', ')}
        WHERE conversation_id = @param${paramIndex}
      `;

      await executeQuery(query, params);
      
      return await this.findById(conversationId);
    } catch (error) {
      throw new Error(`Lỗi cập nhật cuộc trò chuyện: ${error.message}`);
    }
  }

  // Xóa cuộc trò chuyện (soft delete)
  static async delete(conversationId) {
    try {
      const query = `
        UPDATE Conversations 
        SET is_active = 0, updated_at = GETDATE()
        WHERE conversation_id = @param1
      `;
      
      await executeQuery(query, [conversationId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa cuộc trò chuyện: ${error.message}`);
    }
  }

  // Kiểm tra user có trong cuộc trò chuyện không
  static async isParticipant(conversationId, userId) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM ConversationParticipants 
        WHERE conversation_id = @param1 AND user_id = @param2 AND is_active = 1
      `;
      
      const result = await executeQuery(query, [conversationId, userId]);
      
      return result.recordset[0].count > 0;
    } catch (error) {
      throw new Error(`Lỗi kiểm tra participant: ${error.message}`);
    }
  }
}

module.exports = Conversation;
