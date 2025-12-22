const AudioCall = require('../models/AudioCall');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

/**
 * AudioCallService - Business logic cho audio call
 * Xử lý tất cả logic liên quan đến cuộc gọi âm thanh
 */
class AudioCallService {
    /**
     * Bắt đầu cuộc gọi từ conversation
     * @param {number} conversationId - ID của conversation
     * @param {number} callerId - ID người gọi
     * @returns {Promise<Object>} - Thông tin cuộc gọi
     */
    static async initiateCall(conversationId, callerId) {
        try {
            // Kiểm tra conversation tồn tại và user có quyền
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

            // Kiểm tra người nhận có đang bận không
            const calleeActiveCall = await AudioCall.getActiveCall(callee.user_id);
            if (calleeActiveCall) {
                // Người nhận đang trong cuộc gọi khác
                const error = new Error('Người dùng đang bận');
                error.code = 'USER_BUSY';
                error.statusCode = 409; // Conflict
                throw error;
            }

            // Tạo audio call record
            const callData = {
                caller_id: callerId,
                callee_id: callee.user_id,
                conversation_id: conversationId,
                status: 'calling',
                started_at: new Date()
            };

            const call = await AudioCall.create(callData);

            return {
                call,
                callee: {
                    id: callee.user_id,
                    name: callee.name,
                    avatar: callee.avatar_url || callee.avatar // Handle both cases for robustness
                }
            };
        } catch (error) {
            console.error('❌ Error in initiateCall:', error);
            throw error;
        }
    }

    /**
     * Chấp nhận cuộc gọi
     * @param {string} callId - ID cuộc gọi
     * @param {number} calleeId - ID người nhận
     * @returns {Promise<Object>}
     */
    static async acceptCall(callId, calleeId) {
        try {
            const call = await AudioCall.findById(callId);

            if (!call) {
                throw new Error('Cuộc gọi không tồn tại');
            }

            if (call.callee_id !== calleeId) {
                throw new Error('Bạn không có quyền chấp nhận cuộc gọi này');
            }

            if (call.status !== 'calling') {
                throw new Error('Cuộc gọi không ở trạng thái chờ');
            }

            // Cập nhật status - updateStatus tự động set started_at khi status = 'connected'
            const updatedCall = await AudioCall.updateStatus(callId, 'connected');
            return updatedCall;
        } catch (error) {
            console.error('❌ Error in acceptCall:', error);
            throw error;
        }
    }

    /**
     * Từ chối cuộc gọi
     * @param {string} callId - ID cuộc gọi
     * @param {number} calleeId - ID người nhận
     * @param {string} reason - Lý do từ chối
     * @returns {Promise<Object>}
     */
    static async rejectCall(callId, calleeId, reason = 'Busy') {
        try {
            const call = await AudioCall.findById(callId);

            if (!call) {
                throw new Error('Cuộc gọi không tồn tại');
            }

            if (call.callee_id !== calleeId) {
                throw new Error('Bạn không có quyền từ chối cuộc gọi này');
            }

            // Cập nhật status - updateStatus tự động set ended_at khi status = 'rejected'
            const updatedCall = await AudioCall.updateStatus(callId, 'rejected');
            return updatedCall;
        } catch (error) {
            console.error('❌ Error in rejectCall:', error);
            throw error;
        }
    }

    /**
     * Kết thúc cuộc gọi
     * @param {string} callId - ID cuộc gọi
     * @param {number} duration - Thời lượng (giây)
     * @param {string} quality - Chất lượng cuộc gọi
     * @returns {Promise<Object>}
     */
    static async endCall(callId, duration, quality = 'medium') {
        try {
            const call = await AudioCall.findById(callId);

            if (!call) {
                throw new Error('Cuộc gọi không tồn tại');
            }

            // Cập nhật thông tin kết thúc - updateStatus tự động set ended_at và nhận duration + quality
            const updatedCall = await AudioCall.updateStatus(callId, 'ended', {
                duration: duration,
                quality: quality
            });

            // Tạo message trong conversation
            if (call.conversation_id) {
                await this.createCallMessage(call.conversation_id, callId, call.caller_id, duration, quality);
            }

            return updatedCall;
        } catch (error) {
            console.error('❌ Error in endCall:', error);
            throw error;
        }
    }

    /**
     * Tạo message audio call trong conversation
     * @param {number} conversationId
     * @param {string} callId
     * @param {number} senderId
     * @param {number} duration
     * @param {string} quality
     */
    static async createCallMessage(conversationId, callId, senderId, duration, quality) {
        try {
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const durationText = `${minutes}m ${seconds}s`;

            const messageContent = `📞 Cuộc gọi kết thúc (${durationText})`;

            await Message.create({
                conversation_id: conversationId,
                sender_id: senderId,
                content: messageContent,
                message_type: 'audio_call',
                metadata: JSON.stringify({
                    call_id: callId,
                    duration,
                    quality
                })
            });
        } catch (error) {
            console.error('❌ Error creating call message:', error);
            // Don't throw - message creation failure shouldn't fail the call end
        }
    }

    /**
     * Lấy lịch sử cuộc gọi của conversation
     * @param {number} conversationId
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    static async getConversationCallHistory(conversationId, limit = 50) {
        try {
            const calls = await AudioCall.getCallsByConversation(conversationId, limit);
            return calls;
        } catch (error) {
            console.error('❌ Error in getConversationCallHistory:', error);
            throw error;
        }
    }

    /**
     * Lấy audio call messages từ conversation
     * @param {number} conversationId
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    static async getAudioCallMessages(conversationId, limit = 50) {
        try {
            const messages = await Message.findByConversation(conversationId, {
                message_type: 'audio_call',
                limit
            });
            return messages;
        } catch (error) {
            console.error('❌ Error in getAudioCallMessages:', error);
            throw error;
        }
    }

    /**
     * Lấy cuộc gọi đang active của user
     * @param {number} userId
     * @returns {Promise<Object|null>}
     */
    static async getActiveCall(userId) {
        try {
            const activeCall = await AudioCall.getActiveCall(userId);
            return activeCall;
        } catch (error) {
            console.error('❌ Error in getActiveCall:', error);
            throw error;
        }
    }

    /**
     * Lấy thống kê cuộc gọi của user
     * @param {number} userId
     * @returns {Promise<Object>}
     */
    static async getUserCallStats(userId) {
        try {
            const stats = await AudioCall.getStats(userId);
            return stats;
        } catch (error) {
            console.error('❌ Error in getUserCallStats:', error);
            throw error;
        }
    }
}

module.exports = AudioCallService;
