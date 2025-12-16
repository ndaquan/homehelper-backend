const { chatbotResponse } = require("../config/gemini.service");

// Rate limiting - simple in-memory store
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20; // 20 requests per minute

function checkRateLimit(userId) {
  const now = Date.now();
  const key = userId || 'anonymous';
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  const record = rateLimitStore.get(key);
  
  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  // Check if limit exceeded
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  // Increment counter
  record.count++;
  return true;
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

class ChatbotController {
  // POST /api/chatbot/message
  static async sendMessage(req, res) {
    try {
      const userId = req.user?.userId || req.ip;
      
      // Rate limiting
      if (!checkRateLimit(userId)) {
        return res.status(429).json({
          success: false,
          error: "Bạn đã gửi quá nhiều tin nhắn. Vui lòng đợi 1 phút."
        });
      }

      const { message, conversationHistory } = req.body;

      // Validation
      if (!message) {
        return res.status(400).json({
          success: false,
          error: "Vui lòng nhập tin nhắn"
        });
      }

      if (typeof message !== 'string') {
        return res.status(400).json({
          success: false,
          error: "Tin nhắn không hợp lệ"
        });
      }

      const trimmedMessage = message.trim();

      if (trimmedMessage.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Tin nhắn không được để trống"
        });
      }

      if (trimmedMessage.length > 1000) {
        return res.status(400).json({
          success: false,
          error: "Tin nhắn quá dài (tối đa 1000 ký tự)"
        });
      }

      // Validate conversation history if provided
      let history = [];
      if (conversationHistory) {
        if (!Array.isArray(conversationHistory)) {
          return res.status(400).json({
            success: false,
            error: "Lịch sử hội thoại không hợp lệ"
          });
        }
        
        // Validate each message in history
        history = conversationHistory.filter(msg => 
          msg && 
          typeof msg.role === 'string' && 
          typeof msg.content === 'string' &&
          ['user', 'assistant', 'model'].includes(msg.role)
        ).slice(-10); // Keep only last 10 messages
      }

      // Get AI response
      const result = await chatbotResponse(trimmedMessage, history);

      res.json({
        success: true,
        data: {
          message: result.message,
          timestamp: result.timestamp
        }
      });

    } catch (error) {
      console.error("Chatbot error:", error);
      
      res.status(500).json({
        success: false,
        error: error.message || "Có lỗi xảy ra, vui lòng thử lại sau"
      });
    }
  }

  // GET /api/chatbot/status - Check if chatbot is available
  static async getStatus(req, res) {
    try {
      const hasApiKey = !!process.env.GEMINI_API_KEY;
      
      res.json({
        success: true,
        data: {
          available: hasApiKey,
          rateLimit: {
            maxRequests: MAX_REQUESTS_PER_WINDOW,
            windowSeconds: RATE_LIMIT_WINDOW / 1000
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Không thể kiểm tra trạng thái"
      });
    }
  }
}

module.exports = ChatbotController;


