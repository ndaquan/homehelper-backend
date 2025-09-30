const { executeQuery, getPool } = require('../config/database');

const Quote = {
  getQuotesByPostId: async (postId) => {
    const query = `
      SELECT q.quote_id, q.tasker_id, u.name AS tasker_name, q.variant_id, sv.variant_name, q.proposed_price, q.proposal, q.status, q.sent_at
      FROM Quotes q
      INNER JOIN Users u ON q.tasker_id = u.user_id
      INNER JOIN ServiceVariants sv ON q.variant_id = sv.variant_id
      WHERE q.post_id = @param1
    `;
    const result = await executeQuery(query, [postId]);
    return result.recordset;
  },

  checkPostOwnership: async (postId, userId) => {
    const query = `SELECT user_id FROM Posts WHERE post_id = @param1`;
    const result = await executeQuery(query, [postId]);
    if (result.recordset.length === 0) return false;
    return result.recordset[0].user_id === userId;
  },

  findQuoteById: async (quoteId) => {
    const query = `
      SELECT q.post_id, q.tasker_id, q.variant_id, q.proposed_price, p.user_id AS customer_id
      FROM Quotes q
      INNER JOIN Posts p ON q.post_id = p.post_id
      WHERE q.quote_id = @param1 AND q.status = N'Chờ xử lý'
    `;
    const result = await executeQuery(query, [quoteId]);
    return result.recordset[0];
  },

  updateQuoteStatus: async (quoteId, status, transaction) => {
    const query = `UPDATE Quotes SET status = @param1 WHERE quote_id = @param2`;
    await transaction.request()
      .input('param1', status)
      .input('param2', quoteId)
      .query(query);
  }
};

module.exports = Quote;