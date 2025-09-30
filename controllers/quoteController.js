const { getPool, sql } = require('../config/database');
const Quote = require('../models/Quotes');

class QuoteController {
  // Lấy danh sách quotes của bài viết
  static async getQuotes(req, res) {
    const { postId } = req.params;
    const userId = req.user.user_id;

    try {
      const hasPermission = await Quote.checkPostOwnership(postId, userId);
      if (!hasPermission) {
        return res.status(403).json({ error: 'Bạn không có quyền xem quotes của bài viết này' });
      }

      const quotes = await Quote.getQuotesByPostId(postId);
      res.json({ success: true, data: quotes });
    } catch (err) {
      console.error('Lỗi lấy quotes:', err);
      res.status(500).json({ error: 'Lỗi khi lấy danh sách quotes' });
    }
  }

  // Từ chối quote
  static async rejectQuote(req, res) {
    const { quoteId } = req.params;
    const userId = req.user.user_id;

    try {
      const pool = await getPool();
      const transaction = new sql.Transaction(pool);

      try {
        await transaction.begin();

        const quote = await Quote.findQuoteById(quoteId);
        if (!quote) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Quote không tồn tại hoặc đã xử lý' });
        }

        if (quote.customer_id !== userId) {
          await transaction.rollback();
          return res.status(403).json({ error: 'Bạn không có quyền từ chối quote này' });
        }

        await Quote.updateQuoteStatus(quoteId, 'Từ chối', transaction);

        await transaction.commit();

        res.json({ success: true, message: 'Quote đã được từ chối' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Lỗi khi từ chối quote:', err);
      res.status(500).json({ error: 'Lỗi khi từ chối quote' });
    }
  }
}

module.exports = QuoteController;