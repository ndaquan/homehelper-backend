const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // Map<userId, Set<socketId>>
    this.userSockets = new Map(); // Map<socketId, userId>
    this.typingUsers = new Map(); // Map<conversationId, Set<userId>>
    this.joinedRooms = new Map(); // Map<socketId, Set<roomName>>
    this.readThrottle = new Map(); // Map<userId:conversationId, timestamp>
    
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  // Middleware xác thực JWT cho Socket.IO
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Không có token xác thực'));
        }

        if (!process.env.JWT_SECRET) {
          return next(new Error('JWT_SECRET chưa được cấu hình'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.user_id ?? decoded.userId;
        const user = await User.findById(userId);
        
        if (!user) {
          return next(new Error('User không tồn tại'));
        }

        socket.userId = userId;
        socket.user = user;
        next();
      } catch (error) {
        next(new Error('Token không hợp lệ'));
      }
    });
  }

  // Thiết lập các event handlers
  setupEventHandlers() {
  this.io.on('connection', (socket) => {
      // Lưu thông tin kết nối
      if (!this.connectedUsers.has(socket.userId)) {
        this.connectedUsers.set(socket.userId, new Set());
      }
      this.connectedUsers.get(socket.userId).add(socket.id);
      this.userSockets.set(socket.id, socket.userId);
      this.joinedRooms.set(socket.id, new Set());


    // Log danh sách user online sau mỗi kết nối mới
    console.log('Current online users:', Array.from(this.connectedUsers.keys()));

    // Gửi thông báo user online
    this.broadcastUserStatus(socket.userId, 'online');

    // Gửi danh sách user online cho riêng socket mới connect
    console.log(`📤 Emit online_users cho user ${socket.userId}`);
    socket.emit('online_users', this.getOnlineUsers());
    // Gửi danh sách user online cho toàn bộ client (nếu muốn cập nhật realtime cho các client khác)
    console.log('📤 Emit online_users cho toàn bộ client');
    this.io.emit('online_users', this.getOnlineUsers());

      // Đăng ký events
      socket.on('join_conversation', (data) => this.handleJoinConversation(socket, data));
      socket.on('leave_conversation', (data) => this.handleLeaveConversation(socket, data));
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
      socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
      socket.on('message_read', (data) => this.handleMessageRead(socket, data));
      socket.on('notification_read', (data) => this.handleNotificationRead(socket, data));
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  // Xử lý join conversation room
  async handleJoinConversation(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) {
        socket.emit('error', { message: 'Thiếu conversationId' });
        return;
      }

      const isParticipant = await Conversation.isParticipant(conversationId, socket.userId);
      if (!isParticipant) {
        socket.emit('error', { message: 'Bạn không có quyền vào cuộc trò chuyện này' });
        return;
      }

      const room = `conversation_${conversationId}`;
      const rooms = this.joinedRooms.get(socket.id) || new Set();
      if (!rooms.has(room)) {
        socket.join(room);
        rooms.add(room);
        this.joinedRooms.set(socket.id, rooms);

        socket.to(room).emit('user_joined', {
          userId: socket.userId,
          userName: socket.user.name,
          conversationId
        });
      }
    } catch (error) {
      console.error('Lỗi join conversation:', error);
      socket.emit('error', { message: 'Lỗi join conversation' });
    }
  }

  // Xử lý leave conversation room
  async handleLeaveConversation(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) return;

      const room = `conversation_${conversationId}`;
      const rooms = this.joinedRooms.get(socket.id) || new Set();
      if (rooms.has(room)) {
        socket.leave(room);
        rooms.delete(room);
        this.joinedRooms.set(socket.id, rooms);

        socket.to(room).emit('user_left', {
          userId: socket.userId,
          userName: socket.user.name,
          conversationId
        });
      }
    } catch (error) {
      console.error('Lỗi leave conversation:', error);
    }
  }

  // Xử lý gửi tin nhắn
  async handleSendMessage(socket, data) {
    try {
      const { conversationId, content, messageType = 'text', replyToMessageId } = data;
      if (!conversationId || !content) {
        socket.emit('error', { message: 'Thiếu thông tin bắt buộc' });
        return;
      }

      const isParticipant = await Conversation.isParticipant(conversationId, socket.userId);
      if (!isParticipant) {
        socket.emit('error', { message: 'Bạn không có quyền gửi tin nhắn' });
        return;
      }

      const messageData = {
        conversation_id: conversationId,
        sender_id: socket.userId,
        content: content.trim(),
        message_type: messageType,
        reply_to_message_id: replyToMessageId || null
      };
      const message = await Message.create(messageData);

      // Gửi lại cho chính người gửi
      socket.emit('new_message', { message, conversationId });

      // Gửi đến các user khác trong phòng
      socket.broadcast.to(`conversation_${conversationId}`).emit('new_message', {
        message,
        conversationId
      });

      // Gửi notification cho các user khác
      const conversation = await Conversation.findById(conversationId);
      const otherParticipants = conversation.participants
        .filter(p => p.user_id !== socket.userId)
        .map(p => p.user_id);

      for (const participantId of otherParticipants) {
        try {
          await Notification.createMessageNotification(conversationId, socket.userId, participantId, content);

          const sockets = this.connectedUsers.get(participantId);
          if (sockets) {
            sockets.forEach(sid => {
              this.io.to(sid).emit('new_notification', {
                type: 'message',
                conversationId,
                senderId: socket.userId,
                senderName: socket.user.name,
                content: content.length > 100 ? content.substring(0, 100) + '...' : content
              });
            });
          }
        } catch (err) {
          console.error('Lỗi tạo notification:', err);
        }
      }
    } catch (error) {
      console.error('Lỗi gửi tin nhắn:', error);
      socket.emit('error', { message: 'Lỗi gửi tin nhắn' });
    }
  }

  // Typing start
  handleTypingStart(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) return;

      if (!this.typingUsers.has(conversationId)) {
        this.typingUsers.set(conversationId, new Set());
      }
      this.typingUsers.get(conversationId).add(socket.userId);

      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.user.name,
        conversationId,
        isTyping: true
      });

      setTimeout(() => this.handleTypingStop(socket, { conversationId }), 3000);
    } catch (error) {
      console.error('Lỗi typing start:', error);
    }
  }

  // Typing stop
  handleTypingStop(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) return;

      if (this.typingUsers.has(conversationId)) {
        this.typingUsers.get(conversationId).delete(socket.userId);
        if (this.typingUsers.get(conversationId).size === 0) {
          this.typingUsers.delete(conversationId);
        }
      }

      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.user.name,
        conversationId,
        isTyping: false
      });
    } catch (error) {
      console.error('Lỗi typing stop:', error);
    }
  }

  // Message read
  async handleMessageRead(socket, data) {
    try {
      const { conversationId } = data;
      if (!conversationId) return;

      const key = `${socket.userId}:${conversationId}`;
      const now = Date.now();
      const last = this.readThrottle.get(key) || 0;
      if (now - last < 5000) return;
      this.readThrottle.set(key, now);

      await Conversation.updateLastRead(conversationId, socket.userId);

      socket.to(`conversation_${conversationId}`).emit('message_read', {
        userId: socket.userId,
        userName: socket.user.name,
        conversationId,
        readAt: new Date()
      });
    } catch (error) {
      console.error('Lỗi message read:', error);
    }
  }

  // Notification read
  async handleNotificationRead(socket, data) {
    try {
      const { notificationId } = data;
      if (!notificationId) return;
      await Notification.markAsRead(notificationId);
    } catch (error) {
      console.error('Lỗi notification read:', error);
    }
  }

  // Disconnect
  handleDisconnect(socket) {
    try {
      const userId = socket.userId;
      const sockets = this.connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.connectedUsers.delete(userId);
          this.broadcastUserStatus(userId, 'offline');
        }
      }
  this.userSockets.delete(socket.id);
  // Log danh sách user online trước khi gửi cho FE
  console.log('Emit online_users after disconnect:', this.getOnlineUsers());
  this.io.emit('online_users', this.getOnlineUsers());
    } catch (error) {
      console.error('Lỗi disconnect:', error);
    }
  }

  // Helpers
  broadcastUserStatus(userId, status) {
    this.io.emit('user_status_changed', { userId, status, timestamp: new Date() });
  }

  sendNotificationToUser(userId, notification) {
    const sockets = this.connectedUsers.get(userId);
    if (sockets) {
      sockets.forEach(sid => this.io.to(sid).emit('new_notification', notification));
    }
  }

  sendNotificationToUsers(userIds, notification) {
    userIds.forEach(uid => this.sendNotificationToUser(uid, notification));
  }

  getOnlineUsers() {
    return Array.from(this.connectedUsers.keys());
  }

  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }
}

module.exports = SocketHandler;
