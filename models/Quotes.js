const { executeQuery, getPool } = require('../config/database');

const Quote = {
  getQuotesByPostId: async (postId) => {
    const query = `
      SELECT q.quote_id, q.post_id, q.tasker_id, u.name AS tasker_name, q.variant_id, sv.variant_name, q.proposed_price, q.proposal, q.status, q.sent_at
      FROM Quotes q
      INNER JOIN Users u ON q.tasker_id = u.user_id
      INNER JOIN ServiceVariants sv ON q.variant_id = sv.variant_id
      WHERE q.post_id = @param1
      ORDER BY q.sent_at DESC
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
      SELECT q.quote_id, q.post_id, q.tasker_id, q.variant_id, q.proposed_price, q.proposal, q.status, p.user_id AS customer_id
      FROM Quotes q
      INNER JOIN Posts p ON q.post_id = p.post_id
      WHERE q.quote_id = @param1
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
  },

  // Create new quote
  createQuote: async (postId, taskerId, variantId, proposedPrice, proposal) => {
    // Attempt IDENTITY-based insert first
    const identityInsert = `
      INSERT INTO Quotes (post_id, tasker_id, variant_id, proposed_price, proposal, status, sent_at)
      VALUES (@param1, @param2, @param3, @param4, @param5, N'Chờ xử lý', GETDATE());
      SELECT SCOPE_IDENTITY() AS quote_id;
    `;
    try {
      const result = await executeQuery(identityInsert, [postId, taskerId, variantId, proposedPrice, proposal || '']);
      const id = result.recordset?.[0]?.quote_id;
      if (id != null) return id;
      // If SCOPE_IDENTITY returns null, fall through to manual id strategy
    } catch (err) {
      // Fall back below on specific errors (e.g., column 'quote_id' cannot be null)
      const msg = String(err?.message || '');
      const code = err?.number;
      const shouldFallback = msg.includes("Cannot insert the value NULL into column 'quote_id'") || code === 515;
      if (!shouldFallback) throw err;
    }

    // Fallback: compute next quote_id manually and insert explicitly
    const nextIdQuery = `SELECT ISNULL(MAX(quote_id), 0) + 1 AS next_id FROM Quotes`;
    const nextRes = await executeQuery(nextIdQuery);
    const nextId = nextRes.recordset?.[0]?.next_id;
    if (!nextId) throw new Error('Không thể tạo quote_id mới');

    const explicitInsert = `
      INSERT INTO Quotes (quote_id, post_id, tasker_id, variant_id, proposed_price, proposal, status, sent_at)
      VALUES (@param1, @param2, @param3, @param4, @param5, @param6, N'Chờ xử lý', GETDATE());
    `;
    await executeQuery(explicitInsert, [nextId, postId, taskerId, variantId, proposedPrice, proposal || '']);
    return nextId;
  },

  // Prevent duplicates for same post + tasker + variant
  findExistingForTasker: async (postId, taskerId, variantId) => {
    const query = `
      SELECT TOP 1 quote_id, status, sent_at
      FROM Quotes
      WHERE post_id = @param1 AND tasker_id = @param2 AND variant_id = @param3
      ORDER BY sent_at DESC
    `;
    const result = await executeQuery(query, [postId, taskerId, variantId]);
    return result.recordset[0];
  },

  // Tasker: get latest own quote on a post
  getMyQuoteByPost: async (postId, taskerId) => {
    const query = `
      SELECT TOP 1 q.quote_id, q.post_id, q.variant_id, q.proposed_price, q.proposal, q.status, q.sent_at
      FROM Quotes q
      WHERE q.post_id = @param1 AND q.tasker_id = @param2
      ORDER BY q.sent_at DESC
    `;
    const result = await executeQuery(query, [postId, taskerId]);
    return result.recordset[0];
  },

  // Customer: list quotes across all own posts (inbox)
  getQuotesForCustomer: async (userId, { status = null, page = 1, pageSize = 20 } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const offset = (safePage - 1) * safeSize;
    const whereStatus = status ? 'AND q.status = @param2' : '';
    const query = `
      SELECT q.quote_id, q.post_id, p.title AS post_title, q.tasker_id, u.name AS tasker_name,
             q.variant_id, sv.variant_name, q.proposed_price, q.proposal, q.status, q.sent_at
      FROM Quotes q
      INNER JOIN Posts p ON q.post_id = p.post_id
      INNER JOIN Users u ON q.tasker_id = u.user_id
      INNER JOIN ServiceVariants sv ON q.variant_id = sv.variant_id
      WHERE p.user_id = @param1 ${whereStatus}
      ORDER BY q.sent_at DESC
      OFFSET ${offset} ROWS FETCH NEXT ${safeSize} ROWS ONLY
    `;
    const params = status ? [userId, status] : [userId];
    const result = await executeQuery(query, params);
    return result.recordset;
  },

  // Bulk reject other quotes for the same post
  rejectOtherQuotesOfPost: async (postId, exceptQuoteId, transaction) => {
    const query = `
      UPDATE Quotes
      SET status = N'Đã từ chối'
      WHERE post_id = @param1 AND quote_id <> @param2 AND status = N'Chờ xử lý'
    `;
    await transaction.request()
      .input('param1', postId)
      .input('param2', exceptQuoteId)
      .query(query);
  }
};

module.exports = Quote;