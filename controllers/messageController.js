const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

class MessageController {
  // Lấy tin nhắn theo ID
  static async getMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.user_id;

      const message = await Message.findById(messageId);
      if (!message) {
        return res.status(404).json({
          error: 'Không tìm thấy tin nhắn'
        });
      }

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(message.conversation_id, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập tin nhắn này'
        });
      }

      res.status(200).json({
        message: 'Lấy tin nhắn thành công',
        message: message
      });
    } catch (error) {
      console.error('Lỗi lấy tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Cập nhật tin nhắn
  static async updateMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.user_id;
      const { content } = req.body;

      // Validate input
      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          error: 'Nội dung tin nhắn không được để trống'
        });
      }

      // Kiểm tra quyền sửa tin nhắn
      const canModify = await Message.canModify(messageId, userId);
      if (!canModify) {
        return res.status(403).json({
          error: 'Bạn không có quyền sửa tin nhắn này'
        });
      }

      const updatedMessage = await Message.update(messageId, { content: content.trim() });

      // Realtime emit qua Socket.IO nếu có io instance gắn vào app
      try {
        const io = req.app.get('io');
        if (io && updatedMessage) {
          // Lấy conversationId từ record
          const conversationId = updatedMessage.conversation_id;
          const room = `conversation_${conversationId}`;
          // Emit tới phòng (các user khác) và cả người sửa để đồng bộ trạng thái is_edited
          io.to(room).emit('message_updated', { conversationId, message: updatedMessage });
        }
      } catch (emitErr) {
        console.error('Không emit được message_updated:', emitErr.message);
      }

      res.status(200).json({
        message: 'Cập nhật tin nhắn thành công',
        message: updatedMessage
      });
    } catch (error) {
      console.error('Lỗi cập nhật tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa tin nhắn
  static async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.user_id;

      // Kiểm tra quyền xóa tin nhắn
      const canModify = await Message.canModify(messageId, userId);
      if (!canModify) {
        return res.status(403).json({
          error: 'Bạn không có quyền xóa tin nhắn này'
        });
      }

      await Message.delete(messageId);

      res.status(200).json({
        message: 'Xóa tin nhắn thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Xóa vĩnh viễn tin nhắn (chỉ admin)
  static async permanentDeleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.user_id;
      const userRole = req.user.role;

      // Chỉ admin mới có quyền xóa vĩnh viễn
      if (userRole !== 'Admin') {
        return res.status(403).json({
          error: 'Chỉ admin mới có quyền xóa vĩnh viễn tin nhắn'
        });
      }

      await Message.permanentDelete(messageId);

      res.status(200).json({
        message: 'Xóa vĩnh viễn tin nhắn thành công'
      });
    } catch (error) {
      console.error('Lỗi xóa vĩnh viễn tin nhắn:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Đếm tin nhắn chưa đọc
  static async countUnreadMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.user_id;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      const unreadCount = await Message.countUnread(conversationId, userId);

      res.status(200).json({
        message: 'Đếm tin nhắn chưa đọc thành công',
        unread_count: unreadCount
      });
    } catch (error) {
      console.error('Lỗi đếm tin nhắn chưa đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Lấy tin nhắn chưa đọc
  static async getUnreadMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.user_id;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      const unreadMessages = await Message.getUnreadMessages(conversationId, userId);

      res.status(200).json({
        message: 'Lấy tin nhắn chưa đọc thành công',
        messages: unreadMessages
      });
    } catch (error) {
      console.error('Lỗi lấy tin nhắn chưa đọc:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Lấy tin nhắn mới nhất trong cuộc trò chuyện
  static async getLatestMessage(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.user_id;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền truy cập cuộc trò chuyện này'
        });
      }

      const latestMessage = await Message.getLatestMessage(conversationId);

      res.status(200).json({
        message: 'Lấy tin nhắn mới nhất thành công',
        message: latestMessage
      });
    } catch (error) {
      console.error('Lỗi lấy tin nhắn mới nhất:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }

  // Upload file (hình ảnh, tài liệu)
  static async uploadFile(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.user_id;
  const { content } = req.body;

      // Kiểm tra user có trong cuộc trò chuyện không
      const isParticipant = await Conversation.isParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          error: 'Bạn không có quyền gửi file trong cuộc trò chuyện này'
        });
      }

      // Kiểm tra có file được upload không
      if (!req.file) {
        return res.status(400).json({
          error: 'Không có file được upload'
        });
      }

      const file = req.file;
      const message_type = file.mimetype.startsWith('image/') ? 'image' : 'file';

      const messageData = {
        conversation_id: conversationId,
        sender_id: userId,
        content: content || `Đã gửi ${message_type === 'image' ? 'hình ảnh' : 'file'}: ${file.originalname}`,
        message_type,
        file_url: `/uploads/${file.filename}`,
        file_name: file.originalname,
        file_size: file.size
      };

      const message = await Message.create(messageData);

      res.status(201).json({
        message: 'Upload file thành công',
        message: message
      });
    } catch (error) {
      console.error('Lỗi upload file:', error);
      res.status(500).json({
        error: error.message
      });
    }
  }
}

module.exports = MessageController;
