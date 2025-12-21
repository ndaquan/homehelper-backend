const AudioCall = require('../models/AudioCall');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const AudioCallService = require('../services/audioCallService');

/**
 * AudioCallHandler - Xử lý socket events cho audio call
 * Sử dụng SQL Server queries thay vì Sequelize ORM
 */
class AudioCallHandler {
  constructor(io, socketHandler) {
    this.io = io;
    this.socketHandler = socketHandler;
    // Map<callId, {callerId, calleeId, conversationId, startTime, isConnected}>
    this.activeCallData = new Map();
  }

  /**
   * Xử lý initiate call (bắt đầu gọi)
   * Kiểm tra busy status trước khi tạo cuộc gọi
   */
  async handleInitiateCall(socket, data) {
    try {
      const { conversationId } = data;
      const callerId = socket.userId;

      console.log(`📞 [AudioCall] User ${callerId} initiating call in conversation ${conversationId}`);

      // 1. Kiểm tra conversation tồn tại và lấy thông tin người nhận
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation không tồn tại');
      }

      const isParticipant = await Conversation.isParticipant(conversationId, callerId);
      if (!isParticipant) {
        throw new Error('Bạn không có quyền gọi trong conversation này');
      }

      // Xác định người nhận (callee)
      const participants = conversation.participants || [];
      const callee = participants.find(p => p.user_id !== callerId);

      if (!callee) {
        throw new Error('Không tìm thấy người nhận cuộc gọi');
      }

      const calleeId = callee.user_id;

      // 2. Kiểm tra người nhận có đang bận không
      const calleeActiveCall = await AudioCall.getActiveCall(calleeId);
      if (calleeActiveCall) {
        console.log(`⚠️ [AudioCall] Callee ${calleeId} is busy with call ${calleeActiveCall.call_id}`);
        socket.emit('call_error', {
          error: 'Người dùng đang bận',
          reason: 'busy'
        });
        return;
      }

      // 3. Tạo audio call record
      const callData = {
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'calling'
      };

      const call = await AudioCall.create(callData);
      const callId = call.call_id;

      console.log(`✅ [AudioCall] Call created: ${callId}`);

      // 4. Lưu thông tin call vào active calls
      this.activeCallData.set(callId, {
        callId,
        callerId,
        calleeId,
        conversationId,
        startTime: new Date(),
        isConnected: false
      });

      // 5. Gửi incoming_call event cho người nhận
      const calleeRoom = `user_${calleeId}`;
      const incomingCallData = {
        callId,
        caller: {
          id: callerId,
          name: call.caller_name,
          avatar: call.caller_avatar
        },
        conversationId,
        timestamp: new Date().toISOString()
      };

      console.log(`📤 [AudioCall] Emitting incoming_call to room: ${calleeRoom}`);
      this.io.to(calleeRoom).emit('incoming_call', incomingCallData);

      // 6. Gửi call_initiated event cho người gọi
      socket.emit('call_initiated', {
        callId,
        callee: {
          id: calleeId,
          name: callee.name,
          avatar: callee.avatar
        },
        conversationId,
        timestamp: new Date().toISOString()
      });

      // 7. Tạo notification cho người nhận
      try {
        await Notification.create({
          user_id: calleeId,
          type: 'incoming_call',
          title: `${call.caller_name} đang gọi bạn`,
          message: `Cuộc gọi âm thanh từ ${call.caller_name}`,
          related_id: callId,
          is_read: false
        });
      } catch (notifError) {
        console.warn('⚠️ [AudioCall] Failed to create notification:', notifError.message);
      }

      console.log(`📞 [AudioCall] Call initiated: ${callerId} → ${calleeId} (callId: ${callId})`);
    } catch (error) {
      console.error('❌ [AudioCall] Error initiating call:', error.message);
      console.error(error.stack);
      socket.emit('call_error', {
        error: error.message
      });
    }
  }

  /**
   * Xử lý accept call (chấp nhận cuộc gọi)
   */
  async handleAcceptCall(socket, data) {
    try {
      const { callId } = data;
      const calleeId = socket.userId;

      console.log(`✅ [AudioCall] User ${calleeId} accepting call ${callId}`);

      // 1. Lấy thông tin call từ database
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.callee_id !== calleeId) {
        throw new Error('Bạn không có quyền chấp nhận cuộc gọi này');
      }

      // Relax check to allow re-sending event if already connected (e.g. by REST API race condition)
      if (call.status !== 'calling' && call.status !== 'connected') {
        throw new Error(`Cuộc gọi không ở trạng thái hợp lệ (${call.status})`);
      }

      // 2. Cập nhật status thành 'connected' nếu chưa connected
      if (call.status === 'calling') {
        await AudioCall.updateStatus(callId, 'connected');
      } else {
        console.log(`ℹ️ [AudioCall] Call ${callId} already connected, skipping DB update and proceeding to emit.`);
      }

      // 3. Cập nhật active call data
      const callData = this.activeCallData.get(callId);
      if (callData) {
        callData.isConnected = true;
        callData.startTime = new Date();
      }

      // 4. Emit call_accepted event cho người gọi
      const callerRoom = `user_${call.caller_id}`;
      // Log room emission
      console.log(`📤 [AudioCall] Emitting call_accepted to room: ${callerRoom}`);

      // DEBUG: Check if room has members
      const roomMembers = this.io.sockets.adapter.rooms.get(callerRoom);
      console.log(`🔍 [AudioCall] Room ${callerRoom} members:`, roomMembers ? Array.from(roomMembers) : 'EMPTY');

      this.io.to(callerRoom).emit('call_accepted', {
        callId,
        callee: {
          id: calleeId,
          name: call.callee_name,
          avatar: call.callee_avatar
        },
        timestamp: new Date().toISOString()
      });

      console.log(`📤 [AudioCall] Sent call_accepted to caller ${call.caller_id}`);

      // BACKUP: Emit directly to caller sockets using connectedUsers map
      if (this.socketHandler && this.socketHandler.connectedUsers) {

        // Try to find caller sockets
        let callerSockets = this.socketHandler.connectedUsers.get(call.caller_id);

        // Debug logging for connected users lookup
        if (!callerSockets) {
          console.log(`⚠️ [AudioCall] Caller ${call.caller_id} not found in connectedUsers map directly.`);
          // Try searching by string/number variants
          for (const [key, value] of this.socketHandler.connectedUsers.entries()) {
            if (String(key) === String(call.caller_id)) {
              console.log(`✅ [AudioCall] Found caller sockets via manual scan: ${key}`);
              callerSockets = value;
              break;
            }
          }
        }

        if (callerSockets && callerSockets.size > 0) {
          console.log(`👉 [AudioCall] Sending backup call_accepted to ${callerSockets.size} individual sockets for caller ${call.caller_id}`);
          callerSockets.forEach(socketId => {
            this.io.to(socketId).emit('call_accepted', {
              callId,
              callee: {
                id: calleeId,
                name: call.callee_name,
                avatar: call.callee_avatar
              },
              timestamp: new Date().toISOString()
            });
          });
        } else {
          console.warn(`⚠️ [AudioCall] Caller ${call.caller_id} appears to be offline or has no active sockets.`);
        }
      }

      // 5. Emit call_accepted_self cho chính người nhận
      socket.emit('call_accepted_self', {
        callId,
        caller: {
          id: call.caller_id,
          name: call.caller_name,
          avatar: call.caller_avatar
        },
        timestamp: new Date().toISOString()
      });

      console.log(`✅ [AudioCall] Call accepted: ${calleeId} accepted call ${callId}`);
    } catch (error) {
      console.error('❌ [AudioCall] Error accepting call:', error.message);
      socket.emit('call_error', {
        error: error.message
      });
    }
  }

  /**
   * Xử lý reject call (từ chối cuộc gọi)
   */
  async handleRejectCall(socket, data) {
    try {
      const { callId, reason = 'Busy' } = data;
      const calleeId = socket.userId;

      console.log(`❌ [AudioCall] User ${calleeId} rejecting call ${callId}`);

      // 1. Lấy và cập nhật call
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.callee_id !== calleeId) {
        throw new Error('Bạn không có quyền từ chối cuộc gọi này');
      }

      // 2. Cập nhật status thành 'rejected'
      await AudioCall.updateStatus(callId, 'rejected');

      // 3. Xóa khỏi active calls
      this.activeCallData.delete(callId);

      // 4. Emit call_rejected event cho người gọi
      const callerRoom = `user_${call.caller_id}`;
      this.io.to(callerRoom).emit('call_rejected', {
        callId,
        reason,
        timestamp: new Date().toISOString()
      });

      // 5. Emit call_rejected_self cho chính người từ chối
      socket.emit('call_rejected_self', {
        callId,
        timestamp: new Date().toISOString()
      });

      console.log(`❌ [AudioCall] Call rejected: ${calleeId} rejected call ${callId}`);
    } catch (error) {
      console.error('❌ [AudioCall] Error rejecting call:', error.message);
      socket.emit('call_error', {
        error: error.message
      });
    }
  }

  /**
   * Xử lý end call (kết thúc cuộc gọi)
   */
  async handleEndCall(socket, data) {
    try {
      const { callId } = data;
      const userId = socket.userId;

      console.log(`📞 [AudioCall] User ${userId} ending call ${callId}`);

      // 1. Lấy thông tin call
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.caller_id !== userId && call.callee_id !== userId) {
        throw new Error('Bạn không tham gia cuộc gọi này');
      }

      // 2. Tính thời lượng cuộc gọi
      const callData = this.activeCallData.get(callId);
      let duration = 0;
      if (callData && callData.startTime) {
        duration = Math.floor((Date.now() - callData.startTime.getTime()) / 1000);
      }

      // 3. Cập nhật status thành 'ended'
      await AudioCall.updateStatus(callId, 'ended', {
        duration,
        quality: data.quality || 'medium'
      });

      // 4. Xóa khỏi active calls
      this.activeCallData.delete(callId);

      // 5. Emit call_ended event cho người kia
      const otherUserId = userId === call.caller_id ? call.callee_id : call.caller_id;
      const otherRoom = `user_${otherUserId}`;

      console.log(`📤 [AudioCall] Emitting call_ended to room: ${otherRoom}`);

      // DEBUG: Check if room has members
      const roomMembers = this.io.sockets.adapter.rooms.get(otherRoom);
      console.log(`🔍 [AudioCall] Room ${otherRoom} members:`, roomMembers ? Array.from(roomMembers) : 'EMPTY');

      this.io.to(otherRoom).emit('call_ended', {
        callId,
        duration,
        endedBy: userId,
        timestamp: new Date().toISOString()
      });

      // BACKUP: Broad scan if room is empty (just like accept call)
      if (!roomMembers || roomMembers.size === 0) {
        if (this.socketHandler && this.socketHandler.connectedUsers) {
          let otherSockets = this.socketHandler.connectedUsers.get(otherUserId);
          if (!otherSockets) {
            // Try string/number variants
            otherSockets = this.socketHandler.connectedUsers.get(String(otherUserId)) || this.socketHandler.connectedUsers.get(Number(otherUserId));
          }

          if (otherSockets) {
            console.log(`👉 [AudioCall] Sending backup call_ended to individual sockets for user ${otherUserId}`);
            otherSockets.forEach(socketId => {
              this.io.to(socketId).emit('call_ended', {
                callId,
                duration,
                endedBy: userId,
                timestamp: new Date().toISOString()
              });
            });
          }
        }
      }

      // 6. Emit call_ended_self cho chính người kết thúc
      socket.emit('call_ended_self', {
        callId,
        duration,
        timestamp: new Date().toISOString()
      });

      console.log(`📞 [AudioCall] Call ended: ${callId} (duration: ${duration}s)`);
    } catch (error) {
      console.error('❌ [AudioCall] Error ending call:', error.message);
      socket.emit('call_error', {
        error: error.message
      });
    }
  }

  /**
   * Xử lý WebRTC offer (SDP offer từ caller)
   */
  async handleWebRTCOffer(socket, data) {
    try {
      const { callId, offer } = data;
      const callerId = socket.userId;

      // Lấy thông tin call
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.caller_id !== callerId) {
        throw new Error('Chỉ người gọi mới có thể gửi offer');
      }

      console.log(`🔊 [AudioCall] WebRTC offer relaying: ${callerId} → ${call.callee_id} (callId: ${callId})`);
      this.io.to(calleeRoom).emit('webrtc_offer', {
        callId,
        offer
      });

      console.log(`✅ [AudioCall] WebRTC offer sent for call ${callId}`);
    } catch (error) {
      console.error('❌ [AudioCall] Error sending WebRTC offer:', error.message);
      socket.emit('call_error', { error: error.message });
    }
  }

  /**
   * Xử lý WebRTC answer (SDP answer từ callee)
   */
  async handleWebRTCAnswer(socket, data) {
    try {
      const { callId, answer } = data;
      const calleeId = socket.userId;

      // Lấy thông tin call
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.callee_id !== calleeId) {
        throw new Error('Chỉ người nhận mới có thể gửi answer');
      }

      console.log(`🔊 [AudioCall] WebRTC answer relaying: ${calleeId} → ${call.caller_id} (callId: ${callId})`);
      this.io.to(callerRoom).emit('webrtc_answer', {
        callId,
        answer
      });

      console.log(`✅ [AudioCall] WebRTC answer sent for call ${callId}`);
    } catch (error) {
      console.error('❌ [AudioCall] Error sending WebRTC answer:', error.message);
      socket.emit('call_error', { error: error.message });
    }
  }

  /**
   * Xử lý ICE candidate (từ cả caller và callee)
   */
  async handleICECandidate(socket, data) {
    try {
      const { callId, candidate } = data;
      const userId = socket.userId;

      // Lấy thông tin call
      const call = await AudioCall.findById(callId);

      if (!call) {
        throw new Error('Cuộc gọi không tồn tại');
      }

      if (call.caller_id !== userId && call.callee_id !== userId) {
        throw new Error('Bạn không tham gia cuộc gọi này');
      }

      console.log(`❄️ [AudioCall] ICE candidate relaying: ${userId} → ${otherUserId} (callId: ${callId})`);
      this.io.to(otherRoom).emit('ice_candidate', {
        callId,
        candidate
      });

      console.log(`✅ [AudioCall] ICE candidate exchanged for call ${callId}`);
      console.log(`❄️ [AudioCall] ICE candidate exchanged for call ${callId}`);
    } catch (error) {
      console.error('❌ [AudioCall] Error sending ICE candidate:', error.message);
      socket.emit('call_error', { error: error.message });
    }
  }

  /**
   * Xử lý khi user disconnect
   * Kiểm tra xem user có đang trong cuộc gọi active nào không
   * Nếu có thì end call và thông báo cho phía bên kia
   */
  async handleDisconnect(socket) {
    try {
      const userId = socket.userId;
      // Tìm xem user này có đang trong cuộc gọi active nào không
      const activeCall = await AudioCall.getActiveCall(userId);

      if (activeCall) {
        console.log(`🔌 [AudioCall] User ${userId} disconnected while in call ${activeCall.call_id}`);

        // Xóa ngay khỏi activeCallData để hạn chế race condition từ memory check (tuy nhiên DB check là quan trọng nhất)
        this.activeCallData.delete(activeCall.call_id);

        let duration = null;
        let calculateDuration = false;

        // Check memory for duration hint if needed (nhưng giờ ưu tiên SQL)
        // Nếu muốn ưu tiên memory calculation thì tính ở đây truyền vào
        // Tuy nhiên user muốn fix lỗi timezone nên ta ưu tiên use SQL calculation
        calculateDuration = true;

        // Gọi Atomic Update
        const { rowsAffected, call: updatedCall } = await AudioCall.endActiveCall(activeCall.call_id, calculateDuration, duration);

        if (rowsAffected > 0 && updatedCall) {
          // Chỉ vào đây nếu chính request này đã thực hiện update thành công
          // Các request concurrent khác sẽ trả về rowsAffected = 0 và bị bỏ qua

          // Lấy duration chuẩn từ DB
          const finalDuration = updatedCall.duration || 0;
          console.log(`✅ [AudioCall] Disconnect handler finalized call ${activeCall.call_id} with duration ${finalDuration}s`);

          // 3. Thông báo cho người còn lại
          const otherUserId = userId === activeCall.caller_id ? activeCall.callee_id : activeCall.caller_id;
          const otherRoom = `user_${otherUserId}`;

          console.log(`📤 [AudioCall] Emitting call_ended to other user ${otherUserId} due to disconnect`);

          this.io.to(otherRoom).emit('call_ended', {
            callId: activeCall.call_id,
            duration: finalDuration,
            endedBy: userId,
            reason: 'disconnected',
            timestamp: new Date().toISOString()
          });

          // Backup send
          if (this.socketHandler && this.socketHandler.connectedUsers) {
            const otherSockets = this.socketHandler.connectedUsers.get(otherUserId);
            if (otherSockets) {
              otherSockets.forEach(sid => {
                this.io.to(sid).emit('call_ended', {
                  callId: activeCall.call_id,
                  duration: finalDuration,
                  endedBy: userId,
                  reason: 'disconnected',
                  timestamp: new Date().toISOString()
                });
              });
            }
          }

          // 4. Tạo system message trong conversation
          if (activeCall.conversation_id) {
            await AudioCallService.createCallMessage(
              activeCall.conversation_id,
              activeCall.call_id,
              userId,
              finalDuration,
              'unknown_disconnect'
            );
          }
        } else {
          console.log(`ℹ️ [AudioCall] Disconnect handler skipped call ${activeCall.call_id} (already ended by another process)`);
        }
      }
    } catch (error) {
      console.error('❌ [AudioCall] Error handling disconnect:', error.message);
    }
  }

  /**
   * Thiết lập event listeners trên socket
   */
  setupSocketListeners(socket) {
    socket.on('initiate_call', (data) => this.handleInitiateCall(socket, data));
    socket.on('accept_call', (data) => this.handleAcceptCall(socket, data));
    socket.on('reject_call', (data) => this.handleRejectCall(socket, data));
    socket.on('end_call', (data) => this.handleEndCall(socket, data));
    socket.on('webrtc_offer', (data) => this.handleWebRTCOffer(socket, data));
    socket.on('webrtc_answer', (data) => this.handleWebRTCAnswer(socket, data));
    socket.on('ice_candidate', (data) => this.handleICECandidate(socket, data));
  }
}

module.exports = AudioCallHandler;
