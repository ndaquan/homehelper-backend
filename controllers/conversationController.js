const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { moderateAndBlurImage } = require('../services/sightengine.service');
// Lưu trữ io instance để emit events
let ioInstance = null;

// Function để set io instance
const setIOInstance = (io) => {
  ioInstance = io;
};

class ConversationController {
  // Tạo cuộc trò chuyện mới
  static async createConversation(req, res) {
    try {
      const { title, type, participants } = req.body;
      const userId = req.user.user_id || req.user.userId;

      // Validate input
      if (!type || !participants || !Array.isArray(participants)) {
        return res.status(400).json({
          error: 'Thiếu thông tin bắt buộc: type và participants'
        });
      }

      // Kiểm tra type hợp lệ
      if (!['direct', 'group', 'support'].includes(type)) {
        return res.status(400).json({
          error: 'Type không hợp lệ. Chỉ chấp nhận: direct, group, support'
        });
      }

      // Đối với direct conversation, chỉ cho phép 1 participant
      if (type === 'direct' && participants.length !== 1) {
        return res.status(400).json({
          error: 'Direct conversation chỉ cho phép 1 participant'
        });
      }

      // Kiểm tra không tự thêm mình vào participants
      if (participants.includes(userId)) {
        return res.status(400).json({
          error: 'Không thể tự thêm mình vào participants'
        });
      }

      // Đối với direct conversation, kiểm tra xem đã tồn tại chưa
      if (type === 'direct') {
        const existingConversation = await Conversation.findDirectConversation(userId, participants[0]);
        if (existingConversation) {
          return res.status(200).json({
            message: 'Cuộc trò chuyện đã tồn tại',
            conversation: existingConversation
          });
        }
      }

      const conversationData = {
        title: title || (type === 'direct' ? null : 'Cuộc trò chuyện mới'),
        type,
        created_by: userId,
        participants
      };

      const conversation = await Conversation.create(conversationData);

      res.status(201).json({
        message: 'Tạo cuộc trò chuyện thành công',
        conversation
      });
    } catch (error) {
      console.error('Lỗi tạo cuộc trò chuyện:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Lấy danh sách cuộc trò chuyện của user
  static async getConversations(req, res) {
    try {
      const userId = req.user.user_id || req.user.userId;

      const pageRaw = req.query.page;
      const limitRaw = req.query.limit;
      const page = Number.isInteger(pageRaw) ? pageRaw : parseInt(pageRaw, 10);
      const limit = Number.isInteger(limitRaw) ? limitRaw : parseInt(limitRaw, 10);

      const safePage = Number.isNaN(page) || page < 1 ? 1 : page;
      const safeLimit = Number.isNaN(limit) || limit < 1 ? 20 : limit;

      const result = await Conversation.findByUserId(userId, safePage, safeLimit);


      res.status(200).json({
        message: 'Lấy danh sách cuộc trò chuyện thành công',
        ...result
      });
    } catch (error) {
      console.error('Lỗi lấy danh sách cuộc trò chuyện:', error);
      // Nếu bảng chưa tồn tại, trả về rỗng để client hiển thị trạng thái trống
      if (String(error.message).includes('Invalid object name')) {
        return res.status(200).json({
          message: 'Lấy danh sách cuộc trò chuyện thành công',
          conversations: [],
          total: 0,
          page: safePage,
          limit: safeLimit,
          totalPages: 0
        });
      }
      res.status(500).json({ error: error.message });
    }
  }

  // Lấy chi tiết cuộc trò chuyện
  static async getConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      const conversation = await Conversation.findById(convId);
      if (!conversation) {
        return res.status(404).json({
          error: 'Không tìm thấy cuộc trò chuyện'
        });
      }

      res.status(200).json({
        message: 'Lấy chi tiết cuộc trò chuyện thành công',
        conversation
      });
    } catch (error) {
      console.error('Lỗi lấy chi tiết cuộc trò chuyện:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Cập nhật cuộc trò chuyện
  static async updateConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;
      const { title } = req.body;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền cập nhật cuộc trò chuyện này'
        });
      }

      const conversation = await Conversation.update(convId, { title });

      res.status(200).json({
        message: 'Cập nhật cuộc trò chuyện thành công',
        conversation
      });
    } catch (error) {
      console.error('Lỗi cập nhật cuộc trò chuyện:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa cuộc trò chuyện
  static async deleteConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền xóa cuộc trò chuyện này'
        });
      }

      await Conversation.delete(convId);

      res.status(200).json({
        message: 'Xóa cuộc trò chuyện thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa cuộc trò chuyện:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Thêm participant vào cuộc trò chuyện
  static async addParticipant(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;
      const { participantId, role = 'member' } = req.body;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền thêm participant'
        });
      }

      await Conversation.addParticipant(convId, participantId, role);

      res.status(200).json({
        message: 'Thêm participant thành công'
      });
    } catch (error) {
      console.error('Lỗi thêm participant:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa participant khỏi cuộc trò chuyện
  static async removeParticipant(req, res) {
    try {
      const { conversationId, participantId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền xóa participant'
        });
      }

      await Conversation.removeParticipant(convId, participantId);

      res.status(200).json({
        message: 'Xóa participant thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa participant:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Đánh dấu đã đọc cuộc trò chuyện
  static async markAsRead(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      await Conversation.updateLastRead(convId, userId);

      res.status(200).json({
        message: 'Đánh dấu đã đọc thành công'
      });
    } catch (error) {
      console.error('Lỗi đánh dấu đã đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Lấy tin nhắn trong cuộc trò chuyện
  static async getMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const convId = parseInt(conversationId, 10);
      if (Number.isNaN(convId)) {
        return res.status(400).json({ error: 'conversationId không hợp lệ' });
      }
      const userId = req.user.user_id || req.user.userId;
      const { page = 1, limit = 50, beforeMessageId } = req.query;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(convId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      const result = await Message.findByConversationId(
        convId,
        parseInt(page),
        parseInt(limit),
        beforeMessageId
      );

      res.status(200).json({
        message: 'Lấy tin nhắn thành công',
        ...result
      });
    } catch (error) {
      console.error('Lỗi lấy tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Gửi tin nhắn
 static async sendMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const convId = parseInt(conversationId, 10);
    if (Number.isNaN(convId)) {
      return res.status(400).json({ error: 'conversationId không hợp lệ' });
    }

    const userId = req.user.user_id || req.user.userId;
    const { content } = req.body;
    const uploadedImages = req.files || [];

    const isParticipant = await Conversation.isParticipant(convId, userId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Không có quyền gửi tin nhắn' });
    }

    const hasCaption = content && content.trim() !== '';
    const imageCount = uploadedImages.length;
    let finalContent = hasCaption ? content.trim() : null;

    if (!hasCaption && imageCount > 0) {
      finalContent = imageCount === 1 ? 'Đã gửi một hình ảnh' : `Đã gửi ${imageCount} hình ảnh`;
    }

    if (imageCount === 0 && !hasCaption) {
      return res.status(400).json({ error: 'Tin nhắn không được để trống' });
    }

    const createdMessages = [];

    // XỬ LÝ ẢNH – ĐÃ FIX HOÀN TOÀN
    if (imageCount > 0) {
      for (const file of uploadedImages) {
        const publicId = file.filename;
        const moderation = await moderateAndBlurImage(publicId);

        // LOG PII NẾU CÓ
        if (moderation.detections?.personalPII?.length > 0) {
          console.log('PII Detected:', moderation.detections.personalPII);
        }

        // DÙNG URL ĐÃ BLUR NẾU CÓ PII/FACE/NUDITY
        const finalImageUrl = moderation.blurred ? moderation.url : moderation.originalUrl;

        const messageData = {
          conversation_id: convId,
          sender_id: userId,
          content: finalContent,
          message_type: 'image',
          file_url: finalImageUrl,                    // ← ẢNH ĐÃ BỊ BLUR Ở ĐÂY
          original_file_url: moderation.originalUrl,
          file_name: file.originalname,
          file_size: file.size,
          public_id: file.filename,
          is_blurred: moderation.blurred,
          moderation_data: JSON.stringify(moderation.detections),
        };

        const message = await Message.create(messageData);
        createdMessages.push(message);
      }
    }
    // Gửi text thường
    else {
      const messageData = {
        conversation_id: convId,
        sender_id: userId,
        content: finalContent,
        message_type: 'text',
      };
      const message = await Message.create(messageData);
      createdMessages.push(message);
    }

    // Emit + Notification (giữ nguyên)
    const conversation = await Conversation.findById(convId);
    const otherParticipants = conversation.participants
      .filter(p => p.user_id !== userId)
      .map(p => p.user_id);

    if (ioInstance) {
      createdMessages.forEach(msg => {
        ioInstance.to(`conversation_${convId}`).emit('new_message', {
          message: msg,
          conversationId: convId
        });
      });
    }

    const notificationText = hasCaption
      ? content.trim()
      : (imageCount === 1 ? 'đã gửi một hình ảnh' : `đã gửi ${imageCount} hình ảnh`);

    for (const participantId of otherParticipants) {
      await Notification.createMessageNotification(
        convId,
        userId,
        participantId,
        notificationText
      ).catch(console.error);
    }

    return res.status(201).json({
      message: 'Gửi tin nhắn thành công',
      data: createdMessages.length === 1 ? createdMessages[0] : createdMessages
    });

  } catch (error) {
    console.error('Lỗi gửi tin nhắn:', error);
    return res.status(500).json({ error: error.message || 'Lỗi server' });
  }
}
  // Tìm kiếm tin nhắn
  static async searchMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.user_id || req.user.userId;
      const { q, page = 1, limit = 20 } = req.query;

      if (!q || q.trim().length === 0) {
        return res.status(400).json({
          error: 'Từ khóa tìm kiếm không được để trống'
        });
      }

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền tìm kiếm trong cuộc trò chuyện này'
        });
      }

      const result = await Message.search(conversationId, q.trim(), parseInt(page), parseInt(limit));

      res.status(200).json({
        message: 'Tìm kiếm tin nhắn thành công',
        ...result
      });
    } catch (error) {
      console.error('Lỗi tìm kiếm tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }
}

module.exports = { ConversationController, setIOInstance };