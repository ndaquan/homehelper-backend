const express = require('express');
const router = express.Router();

const walletController = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

// GET /api/wallet/balance
router.get('/balance', authenticateToken, walletController.getBalance);

// GET /api/wallet/history?limit=20
router.get('/history', authenticateToken, walletController.getHistory);

module.exports = router;
