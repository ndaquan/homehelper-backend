const jwt = require('jsonwebtoken');
const { executeQuery } = require('../config/database');
const User = require('../models/User');
const Tasker = require('../models/Tasker');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const { notifySosRequestToTaskers } = require('../services/notification.service');

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
  this.io.on('connection', async (socket) => {
      // Lưu thông tin kết nối
      if (!this.connectedUsers.has(socket.userId)) {
        this.connectedUsers.set(socket.userId, new Set());
      }
      this.connectedUsers.get(socket.userId).add(socket.id);
      this.userSockets.set(socket.id, socket.userId);
      try {
        // Join a per-user room for targeted emits from services
        socket.join(`user_${socket.userId}`);
      } catch (e) {
        console.warn('Could not join user room for socket:', e?.message || e);
      }
      this.joinedRooms.set(socket.id, new Set());


    // Log danh sách user online sau mỗi kết nối mới
    console.log('Current online users:', Array.from(this.connectedUsers.keys()));

    // Gửi thông báo user online
    this.broadcastUserStatus(socket.userId, 'online');

    // Nếu user là Tasker thì cập nhật trạng thái "Hoạt động"
    try {
      if (socket.user?.role === 'Tasker') {
        await Tasker.updateStatus(socket.userId, 'Active');
      }
    } catch (e) {
      console.error('Không thể cập nhật trạng thái Tasker khi connect:', e?.message || e);
    }

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
      socket.on('create_sos_job', (data) => this.handleCreateSOSJob(socket, data));
      socket.on('accept_sos_job', (data) => this.handleAcceptSOSJob(socket, data));
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
            });v
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
async handleCreateSOSJob(socket, data) {
    console.log('📩 handleCreateSOSJob called by user:', socket.userId, 'role:', socket.user?.role);

    if (socket.user?.role !== 'Customer') {
      console.warn('⚠️ User not Customer, rejecting create SOS job:', socket.userId);
      return socket.emit('error', { message: 'Chỉ khách hàng mới tạo được SOS job' });
    }

    const { variant_id, location, address, start_time, task, duration_hours, duration_days, type: workType, expected_price: client_expected_price } = data || {};
    console.log('📥 createSOS payload:', { variant_id, location, address, start_time, task, duration_hours, duration_days, workType, client_expected_price });

    // Accept either an address (preferred) or location coordinates
    const hasLocation = (address && String(address).trim()) || (location && String(location).trim());
    if (!variant_id || !hasLocation || !task?.description?.trim()) {
      console.warn('⚠️ Missing required fields for SOS job', { variant_id, location, address, task });
      return socket.emit('error', { message: 'Thiếu thông tin bắt buộc' });
    }

    try {
      // Lấy price_max + 30%
      console.log('🔎 Querying variant info for variant_id=', variant_id);
      const variantRes = await executeQuery(`
        SELECT sv.price_max, sv.service_id, sv.variant_name, s.name AS service_name
        FROM ServiceVariants sv
        JOIN Services s ON sv.service_id = s.service_id
        WHERE sv.variant_id = @vId
      `, { vId: variant_id });

      console.log('📊 variantRes:', variantRes && variantRes.recordset ? variantRes.recordset : variantRes);
      if (!variantRes || !variantRes.recordset || variantRes.recordset.length === 0) {
        console.error('❌ Variant not found for id=', variant_id);
        return socket.emit('error', { message: 'Dịch vụ không tồn tại' });
      }

      const { price_max, service_id } = variantRes.recordset[0];
      // Prefer expected_price from client if provided (but keep server-calculated as fallback)
      const expected_price = client_expected_price || Math.round(Number(price_max) * 1.3);  // +30% → vào expected_price
      console.log('💰 Computed expected_price:', expected_price, 'from price_max:', price_max);

      console.log('📝 Inserting booking into DB...');
      const savedLocation = (address && String(address).trim()) ? String(address).trim() : String(location || '').trim();

      // Calculate base_price from duration and pricing type
      // When customer increases duration, price = price_max * duration * 1.3 (30% surcharge)
      const pricingType = variantRes.recordset[0].unit || 'Giờ';
      let base_price = 0;
      if (pricingType.includes('Giờ') || pricingType.includes('Hour')) {
        const hours = duration_hours ? Number(duration_hours) : 1;
        base_price = Math.round(Number(price_max) * hours * 1.3);
      } else if (pricingType.includes('Ngày') || pricingType.includes('Day')) {
        const days = duration_days ? Number(duration_days) : 1;
        base_price = Math.round(Number(price_max) * days * 1.3);
      } else {
        base_price = Math.round(Number(price_max) * 1.3);
      }
      console.log('💰 Price calc:', { base_price, pricingType, duration_hours, duration_days });

      // Insert booking (let DB generate booking_id if it's an IDENTITY column)
      // Use OUTPUT to retrieve the inserted booking_id in both identity and non-identity setups
      // Use server booking_time (GETDATE()) and derive start_time from it (+20 minutes)
      // to avoid timezone mismatches from client-provided ISO strings.
      const insertRes = await executeQuery(`
        INSERT INTO Bookings (
          customer_id, tasker_id, service_id, variant_id,
          booking_time, start_time, end_time, location, status,
          base_price, surcharge, type,
          sos_expires_at, expected_price
        )
        OUTPUT INSERTED.booking_id AS inserted_id
        VALUES (
          @customer_id, NULL, @service_id, @variant_id,
          GETDATE(), DATEADD(MINUTE, 20, GETDATE()),
            CASE
              WHEN TRY_CAST(@duration_hours AS INT) IS NOT NULL AND TRY_CAST(@duration_hours AS INT) > 0 THEN DATEADD(HOUR, TRY_CAST(@duration_hours AS INT), DATEADD(MINUTE, 20, GETDATE()))
              WHEN TRY_CAST(@duration_days AS INT) IS NOT NULL AND TRY_CAST(@duration_days AS INT) > 0 THEN DATEADD(DAY, TRY_CAST(@duration_days AS INT), DATEADD(MINUTE, 20, GETDATE()))
              ELSE NULL
            END,
          @location, N'Chờ xử lý',
          @base_price, 0, @type,
          DATEADD(MINUTE, 10, GETDATE()), @expected_price
        )
      `, {
        customer_id: socket.userId,
        service_id,
        variant_id,
        // We no longer trust/send client start_time to DB; compute on server instead.
        duration_hours: duration_hours != null ? Number(duration_hours) : null,
        duration_days: duration_days != null ? Number(duration_days) : null,
        location: savedLocation,
        base_price,
        expected_price: expected_price,
        type: 'SOS'
      });

      const bookingId = insertRes?.recordset?.[0]?.inserted_id || null;
      if (!insertRes || insertRes.rowsAffected?.[0] === 0) {
        console.error('❌ Failed to insert booking:', insertRes);
        return socket.emit('error', { message: 'Không tạo được booking' });
      }
      console.log('✅ Booking created with id:', bookingId);

      // Tạo Task mô tả công việc
      console.log('📝 Inserting task for booking:', bookingId);
      const taskInsertRes = await executeQuery(`
        INSERT INTO Tasks (booking_id, description, checklist, photos, completed)
        VALUES (@bid, @desc, @check, @photos, 0)
      `, {
        bid: bookingId,
        desc: task.description.trim(),
        check: task.checklist || null,
        photos: JSON.stringify(task.photos || [])
      });
      console.log('🗂 taskInsertRes:', taskInsertRes && taskInsertRes.recordset ? taskInsertRes.recordset : taskInsertRes);

      // Phát sóng cho tất cả Tasker cung cấp variant này
      console.log('🔎 Querying taskers for variant:', variant_id);
      const taskers = await executeQuery(`
        SELECT DISTINCT tsv.tasker_id
        FROM TaskerServiceVariants tsv
        WHERE tsv.variant_id = @vId
      `, { vId: variant_id });

      console.log('📊 taskers result:', taskers && taskers.recordset ? taskers.recordset : taskers);

      // Calculate exact expires_at timestamp (10 minutes from now)
      const sosExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      // Compute the same start_time on the Node server so emitted payload matches DB
      const computedStartTime = new Date(Date.now() + 20 * 60 * 1000);

      const sosJob = {
        booking_id: bookingId,
        customer_id: socket.userId,
        customer_name: socket.user.name,
        variant_id,
        variant_name: variantRes.recordset[0].variant_name,
        service_name: variantRes.recordset[0].service_name,
        location: savedLocation,
        address: savedLocation,
        start_time: computedStartTime.toISOString(),
        description: task.description,
        final_price: base_price,
        type: 'SOS',
        sos_expires_at: sosExpiresAt,
        expires_in_seconds: 600
      };

      // Use unified notification service to notify customer + taskers and emit broadcast
      try {
        await notifySosRequestToTaskers(this.io, {
          booking_id: bookingId,
          customer_id: socket.userId,
          variant_id,
          service_id,
          location: savedLocation,
        });
      } catch (notifyErr) {
        console.warn('[SOS] notifySosRequestToTaskers failed:', notifyErr?.message || notifyErr);
      }

      // Additionally emit direct SOS job object to online taskers (for specialized UIs)
      if (taskers && taskers.recordset && taskers.recordset.length > 0) {
        for (const t of taskers.recordset) {
          const sockets = this.connectedUsers.get(t.tasker_id);
          if (sockets) {
            const uniqueSid = Array.from(sockets)[0];
            if (uniqueSid) {
              this.io.to(uniqueSid).emit('new_sos_job', sosJob);
              console.log(`📢 Emitted new_sos_job to tasker ${t.tasker_id}`);
            }
          }
        }
      } else {
        console.warn('⚠️ No taskers found for variant:', variant_id);
      }

      socket.emit('sos_job_created', {
        success: true,
        booking_id: bookingId,
        final_price: base_price,
        message: 'SOS Job đã phát sóng thành công!'
      });

      console.log(`[SOS] Job #${bookingId} | Price=${base_price}đ`);

    } catch (err) {
      console.error('Lỗi tạo SOS job:', err && err.stack ? err.stack : err);
      // Emit a more specific event for SOS creation failure so frontend can show detailed debug info during development
      try {
        socket.emit('sos_create_failed', {
          message: 'Không thể tạo SOS job',
          error: err && err.message ? err.message : String(err),
          stack: err && err.stack ? err.stack : null
        });
      } catch (emitErr) {
        // fallback to generic error event
        socket.emit('error', { message: 'Không thể tạo SOS job' });
      }
    }
  }

  // ================================
  // 2. TASKER NHẬN SOS JOB → Chuyển status thành "Đã chấp nhận"
  // ================================
  async handleAcceptSOSJob(socket, data) {
    console.log(`\n[SOS ACCEPT] ====== STARTING handleAcceptSOSJob ======`);
    console.log(`[SOS ACCEPT] socket.userId: ${socket.userId}, socket.user?.role: ${socket.user?.role}`);
    console.log(`[SOS ACCEPT] data:`, data);
    
    if (socket.user?.role !== 'Tasker') {
      console.log(`[SOS ACCEPT] ❌ User is not Tasker, rejecting`);
      return socket.emit('error', { message: 'Chỉ Tasker mới được nhận SOS job' });
    }

    const { booking_id } = data;
    if (!booking_id) {
      console.log(`[SOS ACCEPT] ❌ Missing booking_id`);
      return;
    }

    console.log(`[SOS ACCEPT] Accepting SOS job - tasker_id: ${socket.userId}, booking_id: ${booking_id}`);

    try {
      console.log(`[SOS ACCEPT] Executing UPDATE query...`);
      
      const result = await executeQuery(`
        BEGIN TRAN;

        DECLARE @taken BIT = 0;
        DECLARE @rowcount INT = 0;

        UPDATE Bookings WITH (ROWLOCK, UPDLOCK)
        SET tasker_id = @tasker_id,
            status = N'Đã chấp nhận'
        WHERE booking_id = @booking_id
          AND type = N'SOS'
          AND status = N'Chờ xử lý'
          AND tasker_id IS NULL;

        SET @rowcount = @@ROWCOUNT;
        IF @rowcount > 0 SET @taken = 1;

        SELECT @taken AS taken, @rowcount AS affected_rows;
        COMMIT;
      `, {
        booking_id,
        tasker_id: socket.userId
      });

      console.log(`[SOS ACCEPT] Query result:`, result);
      console.log(`[SOS ACCEPT] result.recordset:`, result.recordset);
      const taken = result.recordset?.[0]?.taken === 1;
      const affectedRows = result.recordset?.[0]?.affected_rows;

      if (taken) {
        console.log(`[SOS] Job #${booking_id} → ĐÃ CẬP NHẬT (${affectedRows} row affected) với tasker_id=${socket.userId}`);
        
        // Broadcast broadly and also notify only taskers who received the job
        const takenPayload = {
          booking_id,
          taken_by_tasker_id: socket.userId,
          taken_by_name: socket.user.name
        };
        this.io.emit('sos_job_taken', takenPayload);

        try {
          // Find variant_id for this booking so we can notify taskers who were targeted
          const bidRes = await executeQuery(`SELECT variant_id FROM Bookings WHERE booking_id = @id`, { id: booking_id });
          const variantId = bidRes.recordset?.[0]?.variant_id;
          if (variantId) {
            const tRes = await executeQuery(`SELECT DISTINCT tsv.tasker_id FROM TaskerServiceVariants tsv WHERE tsv.variant_id = @vId`, { vId: variantId });
            const targeted = tRes.recordset || [];
            targeted.forEach(t => {
              if (t.tasker_id === socket.userId) return; // skip the taker
              const sockets = this.connectedUsers.get(t.tasker_id);
              if (sockets) {
                sockets.forEach(sid => {
                  // Notify remaining taskers that the job was taken
                  this.io.to(sid).emit('sos_job_taken', takenPayload);
                });
              }
            });
          }
        } catch (notifErr) {
          console.warn('Không thể gửi notification cho taskers đã nhận SOS trước đó:', notifErr?.message || notifErr);
        }

        // Thông báo riêng cho khách hàng
        const custRes = await executeQuery(`SELECT customer_id FROM Bookings WHERE booking_id = @id`, { id: booking_id });
        const customerId = custRes.recordset?.[0]?.customer_id;
        console.log(`[SOS] Looking for customer socket - customerId: ${customerId}, connectedUsers:`, Array.from(this.connectedUsers.keys()));
        
        const acceptedPayload = {
          booking_id,
          taken_by_tasker_id: socket.userId,
          taken_by_name: socket.user.name,
          message: 'Có Tasker đã nhận công việc của bạn!'
        };
        
        const custSockets = this.connectedUsers.get(customerId);
        if (custSockets && custSockets.size > 0) {
          console.log(`[SOS] Found customer socket(s) for customer ${customerId}:`, custSockets.size);
          custSockets.forEach(sid => {
            // Notify customer with both tasker id and name so frontend can immediately show info
            console.log(`[SOS] Emitting sos_job_accepted to customer socket ${sid}`);
            this.io.to(sid).emit('sos_job_accepted', acceptedPayload);
          });
        } else {
          console.warn(`[SOS] ❌ Customer ${customerId} not connected! Broadcasting to all users instead`);
          // Fallback: broadcast to all users if customer not found
          this.io.emit('sos_job_accepted', acceptedPayload);
        }

        socket.emit('sos_accept_success', { 
          booking_id, 
          message: 'Chúc mừng! Bạn đã nhận được công việc!' 
        });

        console.log(`[SOS] Job #${booking_id} → ĐÃ CHẤP NHẬN bởi Tasker ${socket.userId}`);

      } else {
        console.log(`[DEBUG FAIL] Job #${booking_id} chưa được update. affectedRows=${affectedRows}. Kiểm tra điều kiện WHERE`);
        socket.emit('sos_accept_failed', {
          booking_id,
          message: 'Rất tiếc! Đã có người nhận trước hoặc job hết hạn'
        });
      }
    } catch (err) {
      console.error('Lỗi nhận SOS job:', err);
      socket.emit('sos_accept_failed', { message: 'Lỗi hệ thống' });
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
      // Emit updated unread count to this user so FE can refresh the badge immediately
      try {
        const unread = await Notification.countUnread(socket.userId);
        const sockets = this.connectedUsers.get(socket.userId);
        if (sockets) {
          sockets.forEach(sid => this.io.to(sid).emit('notifications_unread_count', { unread }));
        }
      } catch (e) {
        console.warn('Không thể emit notifications_unread_count:', e?.message || e);
      }
    } catch (error) {
      console.error('Lỗi notification read:', error);
    }
  }

  // Disconnect
  async handleDisconnect(socket) {
    try {
      const userId = socket.userId;
      const sockets = this.connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.connectedUsers.delete(userId);
          this.broadcastUserStatus(userId, 'offline');
          // Nếu user là Tasker và không còn kết nối nào thì cập nhật "Không hoạt động"
          try {
            if (socket.user?.role === 'Tasker') {
              await Tasker.updateStatus(userId, 'Inactive');
            }
          } catch (e) {
            console.error('Không thể cập nhật trạng thái Tasker khi disconnect:', e?.message || e);
          }
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
