const { executeQuery, getPool } = require('../config/database');
const Quote = require('../models/Quotes');

const getTaskerIdByUserId = async (userId) => {
  // In our schema, Taskers.tasker_id equals Users.user_id. There's no separate user_id column on Taskers.
  const q = `SELECT tasker_id FROM Taskers WHERE tasker_id = @param1`;
  const r = await executeQuery(q, [userId]);
  return r.recordset[0]?.tasker_id || null;
};

exports.createQuote = async (req, res) => {
  try {
    const requester = req.user;
    if (!requester) return res.status(401).json({ success:false, message: 'Thiếu thông tin đăng nhập' });
    const role = String(requester.role || requester.roleName || '').toLowerCase();
    if (role !== 'tasker') return res.status(403).json({ success:false, message: 'Chỉ Tasker mới được gửi báo giá' });

    const { post_id, variant_id, proposed_price, proposal } = req.body || {};
    if (!post_id || !variant_id || !proposed_price || Number(proposed_price) <= 0) {
      return res.status(400).json({ success:false, message: 'Thiếu dữ liệu hoặc giá không hợp lệ' });
    }

    const taskerId = await getTaskerIdByUserId(requester.userId || requester.user_id);
    if (!taskerId) return res.status(403).json({ success:false, message: 'Tài khoản chưa là Tasker' });

    // Validate post exists
    const postRes = await executeQuery(`SELECT post_id FROM Posts WHERE post_id = @param1`, [post_id]);
    if (!postRes.recordset[0]) return res.status(404).json({ success:false, message: 'Bài viết không tồn tại' });

    // Prevent duplicates
    const existed = await Quote.findExistingForTasker(post_id, taskerId, variant_id);
    if (existed && (existed.status === 'Chờ xử lý' || existed.status === 'Đã chấp nhận')) {
      return res.status(409).json({ success:false, message: 'Bạn đã gửi báo giá cho bài viết này' });
    }

    // Price validation against ServiceVariants (only min/max)
    const vRes = await executeQuery(
      `SELECT price_min, price_max FROM ServiceVariants WHERE variant_id = @param1`,
      [variant_id]
    );
    const v = vRes.recordset[0];
    if (!v) return res.status(400).json({ success:false, message: 'Biến thể dịch vụ không hợp lệ' });
    const priceNum = Number(proposed_price);
    if (v.price_min != null && v.price_max != null) {
      const min = Number(v.price_min);
      const max = Number(v.price_max);
      if (priceNum < min || priceNum > max) {
        return res.status(400).json({ success:false, message: `Giá phải nằm trong khoảng ${min} - ${max}` });
      }
    }

    const quoteId = await Quote.createQuote(post_id, taskerId, variant_id, Number(proposed_price), proposal?.toString().slice(0, 2000) || '');
    return res.status(201).json({ success: true, data: { quote_id: quoteId } });
  } catch (err) {
    console.error('createQuote error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

exports.listQuotesByPostForOwner = async (req, res) => {
  try {
    const requesterId = req.user?.userId || req.user?.user_id;
    const { postId } = req.params;
    // Ensure owner
    const isOwner = await Quote.checkPostOwnership(postId, requesterId);
    if (!isOwner) return res.status(403).json({ success:false, message: 'Không có quyền xem báo giá của bài viết này' });

    const rows = await Quote.getQuotesByPostId(postId);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listQuotesByPostForOwner error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

exports.getMyQuoteForPost = async (req, res) => {
  try {
    const requester = req.user;
    const role = String(requester.role || '').toLowerCase();
    if (role !== 'tasker') return res.status(403).json({ success:false, message: 'Chỉ Tasker' });

    const taskerId = await getTaskerIdByUserId(requester.userId || requester.user_id);
    if (!taskerId) return res.status(403).json({ success:false, message: 'Chưa là Tasker' });

    const { postId } = req.params;
    const row = await Quote.getMyQuoteByPost(postId, taskerId);
    return res.json({ success: true, data: row || null });
  } catch (err) {
    console.error('getMyQuoteForPost error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

exports.acceptQuote = async (req, res) => {
  const pool = await getPool();
  const transaction = new pool.Transaction();
  try {
    await transaction.begin();

    const requesterId = req.user?.userId || req.user?.user_id;
    const { quoteId } = req.params;

    const quote = await Quote.findQuoteById(quoteId);
    if (!quote) {
      await transaction.rollback();
      return res.status(404).json({ success:false, message: 'Quote không tồn tại' });
    }
    if (quote.customer_id !== requesterId) {
      await transaction.rollback();
      return res.status(403).json({ success:false, message: 'Không có quyền chấp nhận quote này' });
    }
    if (quote.status !== 'Chờ xử lý') {
      await transaction.rollback();
      return res.status(409).json({ success:false, message: 'Quote đã được xử lý' });
    }

    await Quote.updateQuoteStatus(quoteId, 'Đã chấp nhận', transaction);
    await Quote.rejectOtherQuotesOfPost(quote.post_id, quoteId, transaction);

    await transaction.commit();
    return res.json({ success: true });
  } catch (err) {
    console.error('acceptQuote error', err);
    try { await transaction.rollback(); } catch (_) {}
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

exports.rejectQuote = async (req, res) => {
  const pool = await getPool();
  const transaction = new pool.Transaction();
  try {
    await transaction.begin();

    const requesterId = req.user?.userId || req.user?.user_id;
    const { quoteId } = req.params;

    const quote = await Quote.findQuoteById(quoteId);
    if (!quote) {
      await transaction.rollback();
      return res.status(404).json({ success:false, message: 'Quote không tồn tại' });
    }
    if (quote.customer_id !== requesterId) {
      await transaction.rollback();
      return res.status(403).json({ success:false, message: 'Không có quyền từ chối quote này' });
    }
    if (quote.status !== 'Chờ xử lý') {
      await transaction.rollback();
      return res.status(409).json({ success:false, message: 'Quote đã được xử lý' });
    }

    await Quote.updateQuoteStatus(quoteId, 'Đã từ chối', transaction);
    await transaction.commit();
    return res.json({ success: true });
  } catch (err) {
    console.error('rejectQuote error', err);
    try { await transaction.rollback(); } catch (_) {}
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

exports.listMyQuotes = async (req, res) => {
  try {
    const requesterId = req.user?.userId || req.user?.user_id;
    const { status = null, page = 1, pageSize = 20 } = req.query;
    const rows = await Quote.getQuotesForCustomer(requesterId, { status, page: Number(page), pageSize: Number(pageSize) });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('listMyQuotes error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

// Get latest pending quote between requester and the peer user
exports.getLatestPendingQuoteWithPeer = async (req, res) => {
  try {
    const requesterId = req.user?.userId || req.user?.user_id;
    const peerUserId = parseInt(req.params.peerUserId, 10);
    if (!peerUserId || Number.isNaN(peerUserId)) {
      return res.status(400).json({ success: false, message: 'peerUserId không hợp lệ' });
    }

    // Compute tasker ids for requester and peer if applicable
    const requesterTaskerId = await getTaskerIdByUserId(requesterId);
    const peerTaskerId = await getTaskerIdByUserId(peerUserId);

    // Find latest pending quote where participants are (requester as customer and peer as tasker) OR vice versa
    const rows = await executeQuery(`
      SELECT TOP 1 
        q.quote_id, q.post_id, q.tasker_id, q.variant_id, q.proposed_price, q.proposal, q.status, q.sent_at,
        sv.variant_name, sv.price_min, sv.price_max, sv.specific_price, sv.unit,
        p.user_id AS customer_id
      FROM Quotes q
      INNER JOIN Posts p ON q.post_id = p.post_id
      INNER JOIN ServiceVariants sv ON q.variant_id = sv.variant_id
      WHERE q.status = N'Chờ xử lý'
        AND (
          (q.tasker_id = @param1 AND p.user_id = @param2)
          OR
          (q.tasker_id = @param3 AND p.user_id = @param4)
        )
      ORDER BY q.sent_at DESC
    `, [requesterTaskerId || -1, peerUserId, peerTaskerId || -1, requesterId]);

    const data = rows.recordset?.[0] || null;
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getLatestPendingQuoteWithPeer error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};

// Get quote details including variant bounds for negotiation UI
exports.getQuoteDetails = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const rowRes = await executeQuery(`
      SELECT q.quote_id, q.post_id, q.tasker_id, q.variant_id, q.proposed_price, q.proposal, q.status, q.sent_at,
             sv.variant_name, sv.price_min, sv.price_max, sv.specific_price, sv.unit,
             p.user_id AS customer_id
      FROM Quotes q
      INNER JOIN ServiceVariants sv ON q.variant_id = sv.variant_id
      INNER JOIN Posts p ON q.post_id = p.post_id
      WHERE q.quote_id = @param1
    `, [quoteId]);
    const data = rowRes.recordset?.[0] || null;
    if (!data) return res.status(404).json({ success:false, message: 'Quote không tồn tại' });

    // Authorization: allow participants (post owner or quote tasker) to view
    const requesterId = req.user?.userId || req.user?.user_id;
    if (data.customer_id !== requesterId && data.tasker_id !== requesterId) {
      return res.status(403).json({ success:false, message: 'Không có quyền' });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('getQuoteDetails error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};
// Update proposed price during negotiation (either tasker owner of quote or post owner)
exports.updateQuotePrice = async (req, res) => {
  try {
    const requesterId = req.user?.userId || req.user?.user_id;
    const { quoteId } = req.params;
    const { proposed_price } = req.body || {};
    const price = Number(proposed_price);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ success:false, message: 'Giá không hợp lệ' });

    const quote = await Quote.findQuoteById(quoteId);
    if (!quote) return res.status(404).json({ success:false, message: 'Quote không tồn tại' });

    // Only allow when quote is pending
    if (quote.status !== 'Chờ xử lý') return res.status(409).json({ success:false, message: 'Chỉ cập nhật khi đang Chờ xử lý' });

    // Permission: post owner or tasker who owns the quote
    const isPostOwner = quote.customer_id === requesterId;
    const isTaskerOwner = !!(await executeQuery(`SELECT 1 as ok FROM Quotes WHERE quote_id = @param1 AND tasker_id = (SELECT tasker_id FROM Taskers WHERE tasker_id = @param2)`, [quoteId, requesterId])).recordset[0];
    if (!isPostOwner && !isTaskerOwner) return res.status(403).json({ success:false, message: 'Không có quyền cập nhật báo giá này' });

    // Validate against a min–max range derived from variant config
    const vRes = await executeQuery(`SELECT price_min, price_max, specific_price FROM ServiceVariants WHERE variant_id = @param1`, [quote.variant_id]);
    const v = vRes.recordset[0];
    if (!v) return res.status(400).json({ success:false, message: 'Biến thể dịch vụ không hợp lệ' });
    const min = v.price_min != null ? Number(v.price_min) : (v.specific_price != null ? Number(v.specific_price) : null);
    const max = v.price_max != null ? Number(v.price_max) : (v.specific_price != null ? Number(v.specific_price) : null);
    if (min == null || max == null) {
      return res.status(400).json({ success:false, message: 'Biến thể dịch vụ chưa cấu hình khoảng giá' });
    }
    if (price < min || price > max) {
      return res.status(400).json({ success:false, message: `Giá phải nằm trong khoảng ${min} - ${max}` });
    }

    await executeQuery(`UPDATE Quotes SET proposed_price = @param1 WHERE quote_id = @param2`, [price, quoteId]);
    return res.json({ success: true, data: { quote_id: Number(quoteId), proposed_price: price } });
  } catch (err) {
    console.error('updateQuotePrice error', err);
    return res.status(500).json({ success:false, message: 'Lỗi server' });
  }
};
