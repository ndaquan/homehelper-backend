// models/Quotes.js
const { executeQuery } = require('../config/database');

class Quotes {
  // Lấy danh sách Quotes theo post_id
  static async getQuotesByPostId(postId) {
    try {
      const query = `
        SELECT 
          q.quote_id,
          q.post_id,
          q.tasker_id,
          q.proposed_price,
          q.proposal,
          q.status,
          q.sent_at,
          p.title AS post_title,
          u.name AS tasker_name
        FROM Quotes q
        INNER JOIN Posts p ON q.post_id = p.post_id
        INNER JOIN Taskers t ON q.tasker_id = t.tasker_id
        INNER JOIN Users u ON t.tasker_id = u.user_id
        WHERE q.post_id = @param1
        ORDER BY q.sent_at DESC`;

      const result = await executeQuery(query, [postId]);
      return result.recordset;
    } catch (error) {
      console.error('Error getting quotes:', error);
      throw error;
    }
  }

  // Cập nhật trạng thái Quote (Chấp nhận/Từ chối)
  static async updateQuoteStatus(quoteId, status, userId) {
    try {
      // Kiểm tra trạng thái hợp lệ
      if (!['Chấp nhận', 'Từ chối'].includes(status)) {
        throw new Error('Trạng thái không hợp lệ. Chỉ chấp nhận "Chấp nhận" hoặc "Từ chối".');
      }

      // Kiểm tra quyền người dùng và lấy thông tin Quote
      const checkQuery = `
        SELECT 
          q.quote_id,
          q.post_id,
          q.tasker_id,
          q.proposed_price,
          q.proposal,
          q.status,
          q.sent_at,
          p.title AS post_title,
          p.user_id AS post_owner_id,
          u.name AS tasker_name
        FROM Quotes q
        INNER JOIN Posts p ON q.post_id = p.post_id
        INNER JOIN Taskers t ON q.tasker_id = t.tasker_id
        INNER JOIN Users u ON t.tasker_id = u.user_id
        WHERE q.quote_id = @param1`;

      const checkResult = await executeQuery(checkQuery, [quoteId]);
      const quote = checkResult.recordset[0];

      if (!quote) {
        throw new Error('Không tìm thấy báo giá');
      }

      if (quote.post_owner_id !== userId) {
        throw new Error('Bạn không có quyền cập nhật báo giá này');
      }

      // Cập nhật trạng thái Quote
      const updateQuery = `
        UPDATE Quotes
        SET status = @param1
        WHERE quote_id = @param2`;

      await executeQuery(updateQuery, [status, quoteId]);

      // Trả về thông tin Quote đã cập nhật
      const updatedQuote = await executeQuery(checkQuery, [quoteId]);
      return updatedQuote.recordset[0];
    } catch (error) {
      console.error('Error updating quote status:', error);
      throw error;
    }
  }
}

module.exports = Quotes;