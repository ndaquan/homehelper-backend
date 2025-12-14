const { executeQuery } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * AudioCall Model - Quản lý lịch sử cuộc gọi âm thanh
 * Tích hợp với Messages table & Conversations table từ chat
 * Sử dụng SQL Server T-SQL
 */
class AudioCall {
  /**
   * Tạo bản ghi cuộc gọi mới
   */
  static async create(callData) {
    try {
      const {
        call_id = uuidv4(),
        caller_id,
        callee_id,
        conversation_id,
        status = 'calling',
      } = callData;

      const query = `
        INSERT INTO AudioCalls (
          call_id, 
          caller_id, 
          callee_id, 
          conversation_id, 
          status, 
          created_at
        )
        VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE())
      `;

      await executeQuery(query, [
        call_id,
        caller_id,
        callee_id,
        conversation_id,
        status,
      ]);

      console.log('✅ Cuộc gọi đã được tạo với ID:', call_id);

      const createdCall = await this.findById(call_id);

      if (!createdCall) {
        console.error('❌ Không thể tìm thấy cuộc gọi vừa tạo:', call_id);
        throw new Error('Không thể tạo cuộc gọi');
      }

      return createdCall;
    } catch (error) {
      console.error('❌ Lỗi tạo cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Lấy cuộc gọi theo ID
   */
  static async findById(callId) {
    try {
      const query = `
        SELECT
          ac.call_id,
          ac.caller_id,
          uc.name as caller_name,
          uc.avatar_url as caller_avatar,
          ac.callee_id,
          ue.name as callee_name,
          ue.avatar_url as callee_avatar,
          ac.conversation_id,
          conv.title as conversation_title,
          ac.status,
          ac.started_at,
          ac.ended_at,
          ac.duration,
          ac.quality,
          ac.created_at,
          ac.updated_at
        FROM AudioCalls ac
        LEFT JOIN Users uc ON ac.caller_id = uc.user_id
        LEFT JOIN Users ue ON ac.callee_id = ue.user_id
        LEFT JOIN Conversations conv ON ac.conversation_id = conv.conversation_id
        WHERE ac.call_id = @param1
      `;

      const result = await executeQuery(query, [callId]);

      console.log('🔍 findById result for', callId, ':', {
        hasRecordset: !!result.recordset,
        recordsetLength: result.recordset?.length,
        firstRecord: result.recordset?.[0]?.call_id
      });

      return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (error) {
      console.error('❌ Lỗi lấy cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Lấy lịch sử cuộc gọi của user (incoming + outgoing)
   */
  static async getCallHistory(userId, limit = 50, offset = 0) {
    try {
      const query = `
        SELECT
          ac.call_id,
          ac.caller_id,
          uc.name as caller_name,
          uc.avatar_url as caller_avatar,
          ac.callee_id,
          ue.name as callee_name,
          ue.avatar_url as callee_avatar,
          ac.conversation_id,
          conv.title as conversation_title,
          ac.status,
          ac.started_at,
          ac.ended_at,
          ac.duration,
          ac.quality,
          ac.created_at,
          CASE 
            WHEN ac.caller_id = @param1 THEN 'outgoing'
            WHEN ac.callee_id = @param1 THEN 'incoming'
          END as call_type,
          ROW_NUMBER() OVER (ORDER BY ac.created_at DESC) as row_num
        FROM AudioCalls ac
        LEFT JOIN Users uc ON ac.caller_id = uc.user_id
        LEFT JOIN Users ue ON ac.callee_id = ue.user_id
        LEFT JOIN Conversations conv ON ac.conversation_id = conv.conversation_id
        WHERE ac.caller_id = @param1 OR ac.callee_id = @param1
      `;

      const result = await executeQuery(query, [userId]);

      // Pagination
      const paginatedResult = result.recordset.slice(offset, offset + limit);

      return {
        calls: paginatedResult,
        total: result.recordset.length,
        limit,
        offset,
      };
    } catch (error) {
      console.error('❌ Lỗi lấy lịch sử cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Lấy cuộc gọi theo conversation
   */
  static async getCallsByConversation(conversationId, limit = 50) {
    try {
      const query = `
        SELECT TOP ${limit}
          ac.call_id,
          ac.caller_id,
          uc.name as caller_name,
          ac.callee_id,
          ue.name as callee_name,
          ac.status,
          ac.started_at,
          ac.ended_at,
          ac.duration,
          ac.created_at
        FROM AudioCalls ac
        LEFT JOIN Users uc ON ac.caller_id = uc.user_id
        LEFT JOIN Users ue ON ac.callee_id = ue.user_id
        WHERE ac.conversation_id = @param1
        ORDER BY ac.created_at DESC
      `;

      const result = await executeQuery(query, [conversationId]);
      return result.recordset;
    } catch (error) {
      console.error('❌ Lỗi lấy cuộc gọi theo conversation:', error.message);
      throw error;
    }
  }

  /**
   * Cập nhật trạng thái cuộc gọi
   */
  static async updateStatus(callId, status, additionalData = {}) {
    try {
      let query = `
        UPDATE AudioCalls 
        SET status = @param2
      `;

      const params = [callId, status];
      let paramIndex = 3;

      // Nếu connected → set started_at
      if (status === 'connected' && !additionalData.started_at) {
        query += `, started_at = GETDATE()`;
      }

      // Nếu ended → set ended_at & duration
      if (status === 'ended') {
        query += `, ended_at = GETDATE()`;

        if (additionalData.calculateDuration) {
          query += `, duration = DATEDIFF(SECOND, started_at, GETDATE())`;
        } else if (additionalData.duration !== undefined && additionalData.duration !== null) {
          query += `, duration = @param${paramIndex}`;
          params.push(additionalData.duration);
          paramIndex++;
        }

        if (additionalData.quality) {
          query += `, quality = @param${paramIndex}`;
          params.push(additionalData.quality);
          paramIndex++;
        }
      }

      query += `, updated_at = GETDATE() WHERE call_id = @param1`;

      await executeQuery(query, params);
      return await this.findById(callId);
    } catch (error) {
      console.error('❌ Lỗi cập nhật trạng thái cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Kết thúc cuộc gọi active (Atomic update)
   * Chỉ update nếu status đang là calling hoặc connected
   * Trả về { rowsAffected, call }
   */
  static async endActiveCall(callId, calculateDuration = true, durationValue = null) {
    try {
      let query = `
            UPDATE AudioCalls
            SET status = 'ended',
                ended_at = GETDATE(),
                updated_at = GETDATE()
          `;

      const params = [callId];

      if (calculateDuration) {
        query += `, duration = DATEDIFF(SECOND, started_at, GETDATE())`;
      } else if (durationValue !== null) {
        query += `, duration = @param2`;
        params.push(durationValue);
      }

      query += ` 
            WHERE call_id = @param1 
            AND status IN ('calling', 'connected')
          `;

      const result = await executeQuery(query, params);
      const rowsAffected = result.rowsAffected ? result.rowsAffected[0] : 0;

      let call = null;
      if (rowsAffected > 0) {
        call = await this.findById(callId);
      }

      return { rowsAffected, call };
    } catch (error) {
      console.error('❌ Lỗi endActiveCall:', error.message);
      throw error;
    }
  }

  /**
   * Lấy cuộc gọi active (đang diễn ra)
   */
  static async getActiveCall(userId) {
    try {
      const query = `
        SELECT TOP 1
          ac.call_id,
          ac.caller_id,
          ac.callee_id,
          ac.conversation_id,
          ac.status,
          ac.started_at,
          ac.created_at
        FROM AudioCalls ac
        WHERE (ac.caller_id = @param1 OR ac.callee_id = @param1)
        AND ac.status IN ('calling', 'connected')
        ORDER BY ac.created_at DESC
      `;

      const result = await executeQuery(query, [userId]);
      return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (error) {
      console.error('❌ Lỗi lấy cuộc gọi active:', error.message);
      throw error;
    }
  }

  /**
   * Xóa cuộc gọi khỏi lịch sử
   */
  static async delete(callId) {
    try {
      const query = `DELETE FROM AudioCalls WHERE call_id = @param1`;
      await executeQuery(query, [callId]);
      return { success: true };
    } catch (error) {
      console.error('❌ Lỗi xóa cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Xóa tất cả cuộc gọi của user
   */
  static async deleteAllByUser(userId) {
    try {
      const query = `DELETE FROM AudioCalls WHERE caller_id = @param1 OR callee_id = @param1`;
      await executeQuery(query, [userId]);
      return { success: true };
    } catch (error) {
      console.error('❌ Lỗi xóa cuộc gọi của user:', error.message);
      throw error;
    }
  }

  /**
   * Lấy thống kê cuộc gọi
   */
  static async getStats(userId) {
    try {
      const query = `
        SELECT
          COUNT(*) as total_calls,
          SUM(CASE WHEN caller_id = @param1 THEN 1 ELSE 0 END) as outgoing_calls,
          SUM(CASE WHEN callee_id = @param1 THEN 1 ELSE 0 END) as incoming_calls,
          SUM(CASE WHEN status = 'ended' THEN 1 ELSE 0 END) as completed_calls,
          SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed_calls,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_calls,
          ISNULL(SUM(duration), 0) as total_duration_seconds,
          ISNULL(AVG(CASE WHEN status = 'ended' THEN duration END), 0) as avg_duration
        FROM AudioCalls
        WHERE caller_id = @param1 OR callee_id = @param1
      `;

      const result = await executeQuery(query, [userId]);
      return result.recordset[0];
    } catch (error) {
      console.error('❌ Lỗi lấy thống kê cuộc gọi:', error.message);
      throw error;
    }
  }

  /**
   * Lấy missed calls
   */
  static async getMissedCalls(userId, limit = 50) {
    try {
      const query = `
        SELECT TOP ${limit}
          ac.call_id,
          ac.caller_id,
          uc.name as caller_name,
          uc.avatar_url as caller_avatar,
          ac.conversation_id,
          ac.status,
          ac.created_at
        FROM AudioCalls ac
        LEFT JOIN Users uc ON ac.caller_id = uc.user_id
        WHERE ac.callee_id = @param1 AND ac.status = 'missed'
        ORDER BY ac.created_at DESC
      `;

      const result = await executeQuery(query, [userId]);
      return result.recordset;
    } catch (error) {
      console.error('❌ Lỗi lấy missed calls:', error.message);
      throw error;
    }
  }

  /**
   * Lấy cuộc gọi giữa 2 user
   */
  static async getCallsBetweenUsers(userId1, userId2, limit = 20) {
    try {
      const query = `
        SELECT TOP ${limit}
          ac.call_id,
          ac.caller_id,
          ac.callee_id,
          ac.status,
          ac.duration,
          ac.created_at
        FROM AudioCalls ac
        WHERE (
          (ac.caller_id = @param1 AND ac.callee_id = @param2) OR
          (ac.caller_id = @param2 AND ac.callee_id = @param1)
        )
        ORDER BY ac.created_at DESC
      `;

      const result = await executeQuery(query, [userId1, userId2]);
      return result.recordset;
    } catch (error) {
      console.error('❌ Lỗi lấy cuộc gọi giữa 2 user:', error.message);
      throw error;
    }
  }
}

module.exports = AudioCall;
