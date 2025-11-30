const express = require('express');
const router = express.Router();
const { authenticateToken, requireAuth } = require('../middleware/auth');
const quotesCtrl = require('../controllers/quotesController');

// Tasker tạo quote
router.post('/', authenticateToken, requireAuth, quotesCtrl.createQuote);

// Chủ post xem tất cả quote của post (canonical)
router.get('/posts/:postId', authenticateToken, requireAuth, quotesCtrl.listQuotesByPostForOwner);
// Backward-compatible: /:postId/quotes
router.get('/:postId/quotes', authenticateToken, requireAuth, quotesCtrl.listQuotesByPostForOwner);

// Tasker xem quote của chính mình trên bài post
router.get('/posts/:postId/me', authenticateToken, requireAuth, quotesCtrl.getMyQuoteForPost);
// Get latest pending quote between requester and a peer user (for negotiation auto-discovery)
router.get('/peer/:peerUserId/latest', authenticateToken, requireAuth, quotesCtrl.getLatestPendingQuoteWithPeer);
// Get quote details (for negotiation UI)
router.get('/:quoteId', authenticateToken, requireAuth, quotesCtrl.getQuoteDetails);

// Customer chấp nhận/từ chối quote
router.post('/:quoteId/accept', authenticateToken, requireAuth, quotesCtrl.acceptQuote);
router.post('/:quoteId/reject', authenticateToken, requireAuth, quotesCtrl.rejectQuote);
// Chấp nhận mới (status 'Chấp nhận') cho front-end /approve
router.post('/:quoteId/approve', authenticateToken, requireAuth, quotesCtrl.approveQuote);
// Negotiation: update proposed_price
router.post('/:quoteId/price', authenticateToken, requireAuth, quotesCtrl.updateQuotePrice);

// Customer inbox: list tất cả quotes theo các bài của mình
router.get('/', authenticateToken, requireAuth, quotesCtrl.listMyQuotes);

module.exports = router;