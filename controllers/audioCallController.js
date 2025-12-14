const AudioCall = require('../models/AudioCall');
const AudioCallService = require('../services/audioCallService');

/**
 * AudioCallController - REST API cho cuộc gọi âm thanh
 * Tích hợp hoàn toàn với chat
 */
class AudioCallController {
  /**
   * Bắt đầu cuộc gọi
   * POST /api/audio-calls/initiate
   */
  static async initiateCall(req, res) {
    try {
      const { conversationId } = req.body;
      const callerId = req.user.user_id;

      if (!conversationId) {
        return res.status(400).json({
          error: 'Thiếu conversationId',
        });
      }

      const result = await AudioCallService.initiateCall(conversationId, callerId);

      // Emit socket event to notify callee about incoming call
      const io = req.app.get('io');
      console.log('🔍 IO instance:', !!io);
      console.log('🔍 Result callee:', result.callee);

      if (io && result.callee) {
        const calleeRoom = `user_${result.callee.id}`;
        const eventData = {
          callId: result.call.call_id,
          caller: {
            id: callerId,
            name: result.call.caller_name,
            avatar: result.call.caller_avatar,
          },
          conversationId: conversationId,
          timestamp: new Date().toISOString(),
        };

        console.log(`📞 Emitting incoming_call to room: ${calleeRoom}`);
        console.log('📞 Event data:', JSON.stringify(eventData, null, 2));

        // Get sockets in that room to check if anyone is listening
        const roomSockets = io.sockets.adapter.rooms.get(calleeRoom);
        console.log(`📞 Sockets in room ${calleeRoom}:`, roomSockets?.size || 0);

        io.to(calleeRoom).emit('incoming_call', eventData);

        console.log(`📞 Incoming call emitted to user ${result.callee.id}`);
      } else {
        console.warn('⚠️ Cannot emit incoming_call - IO:', !!io, 'Callee:', !!result.callee);
      }

      res.status(201).json({
        message: 'Cuộc gọi đã bắt đầu',
        data: result,
      });
    } catch (error) {
      console.error('❌ Lỗi bắt đầu cuộc gọi:', error.message);

      // Xử lý lỗi USER_BUSY
      if (error.code === 'USER_BUSY') {
        return res.status(409).json({
          error: 'Người dùng đang bận',
          code: 'USER_BUSY',
          message: error.message
        });
      }

      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Chấp nhận cuộc gọi
   * POST /api/audio-calls/:callId/accept
   */
  static async acceptCall(req, res) {
    try {
      const { callId } = req.params;
      const calleeId = req.user.user_id;

      const result = await AudioCallService.acceptCall(callId, calleeId);

      res.status(200).json({
        message: 'Cuộc gọi đã được chấp nhận',
        data: result,
      });
    } catch (error) {
      console.error('❌ Lỗi chấp nhận cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Từ chối cuộc gọi
   * POST /api/audio-calls/:callId/reject
   */
  static async rejectCall(req, res) {
    try {
      const { callId } = req.params;
      const { reason } = req.body;
      const calleeId = req.user.user_id;

      const result = await AudioCallService.rejectCall(callId, calleeId, reason);

      res.status(200).json({
        message: 'Cuộc gọi đã bị từ chối',
        data: result,
      });
    } catch (error) {
      console.error('❌ Lỗi từ chối cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Kết thúc cuộc gọi
   * POST /api/audio-calls/:callId/end
   */
  static async endCall(req, res) {
    try {
      const { callId } = req.params;
      const { duration = 0, quality = 'medium' } = req.body;

      const result = await AudioCallService.endCall(callId, duration, quality);

      res.status(200).json({
        message: 'Cuộc gọi đã kết thúc',
        data: result,
      });
    } catch (error) {
      console.error('❌ Lỗi kết thúc cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy lịch sử cuộc gọi của user
   * GET /api/audio-calls/history?limit=50&offset=0
   */
  static async getCallHistory(req, res) {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user.user_id;

      const result = await AudioCall.getCallHistory(userId, limit, offset);

      res.status(200).json({
        message: 'Lấy lịch sử cuộc gọi thành công',
        data: result.calls,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: result.total,
        },
      });
    } catch (error) {
      console.error('❌ Lỗi lấy lịch sử cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy lịch sử cuộc gọi của conversation
   * GET /api/audio-calls/conversation/:conversationId
   */
  static async getConversationCalls(req, res) {
    try {
      const { conversationId } = req.params;
      const { limit = 50 } = req.query;

      const calls = await AudioCallService.getConversationCallHistory(
        conversationId,
        limit
      );

      res.status(200).json({
        message: 'Lấy lịch sử cuộc gọi thành công',
        data: calls,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy lịch sử cuộc gọi conversation:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy audio call messages từ conversation
   * (hiển thị trong chat)
   * GET /api/audio-calls/conversation/:conversationId/messages
   */
  static async getAudioCallMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const { limit = 50 } = req.query;

      const messages = await AudioCallService.getAudioCallMessages(
        conversationId,
        limit
      );

      res.status(200).json({
        message: 'Lấy audio call messages thành công',
        data: messages,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy audio call messages:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy chi tiết cuộc gọi
   * GET /api/audio-calls/:callId
   */
  static async getCallDetail(req, res) {
    try {
      const { callId } = req.params;

      const call = await AudioCall.findById(callId);
      if (!call) {
        return res.status(404).json({
          error: 'Cuộc gọi không tồn tại',
        });
      }

      res.status(200).json({
        message: 'Lấy chi tiết cuộc gọi thành công',
        data: call,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy chi tiết cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy thống kê cuộc gọi
   * GET /api/audio-calls/stats
   */
  static async getCallStats(req, res) {
    try {
      const userId = req.user.user_id;

      const stats = await AudioCallService.getUserCallStats(userId);

      res.status(200).json({
        message: 'Lấy thống kê cuộc gọi thành công',
        data: stats,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy thống kê cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy cuộc gọi active (đang diễn ra)
   * GET /api/audio-calls/active
   */
  static async getActiveCall(req, res) {
    try {
      const userId = req.user.user_id;

      const activeCall = await AudioCallService.getActiveCall(userId);

      res.status(200).json({
        message: 'Lấy cuộc gọi active thành công',
        data: activeCall,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy cuộc gọi active:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Lấy missed calls
   * GET /api/audio-calls/missed
   */
  static async getMissedCalls(req, res) {
    try {
      const { limit = 50 } = req.query;
      const userId = req.user.user_id;

      const missedCalls = await AudioCall.getMissedCalls(userId, limit);

      res.status(200).json({
        message: 'Lấy missed calls thành công',
        data: missedCalls,
      });
    } catch (error) {
      console.error('❌ Lỗi lấy missed calls:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Xóa cuộc gọi
   * DELETE /api/audio-calls/:callId
   */
  static async deleteCall(req, res) {
    try {
      const { callId } = req.params;

      await AudioCall.delete(callId);

      res.status(200).json({
        message: 'Cuộc gọi đã được xóa',
      });
    } catch (error) {
      console.error('❌ Lỗi xóa cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }

  /**
   * Xóa tất cả cuộc gọi của user
   * DELETE /api/audio-calls/all
   */
  static async deleteAllCalls(req, res) {
    try {
      const userId = req.user.user_id;

      await AudioCall.deleteAllByUser(userId);

      res.status(200).json({
        message: 'Tất cả cuộc gọi đã được xóa',
      });
    } catch (error) {
      console.error('❌ Lỗi xóa tất cả cuộc gọi:', error.message);
      res.status(500).json({
        error: error.message,
      });
    }
  }
}

module.exports = AudioCallController;
