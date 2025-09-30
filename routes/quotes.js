const express = require('express');
const router = express.Router();
const QuoteController = require('../controllers/quoteController');
const { authenticateToken, requireCustomer } = require('../middleware/auth');

// Routes cho quotes
router.get('/:postId/quotes', authenticateToken, requireCustomer, QuoteController.getQuotes);
router.post('/:quoteId/reject', authenticateToken, requireCustomer, QuoteController.rejectQuote);

module.exports = router;