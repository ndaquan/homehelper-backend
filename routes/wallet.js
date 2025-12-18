const express = require('express');
const router = express.Router();

const walletController = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

// GET /api/wallet/balance
router.get('/balance', authenticateToken, walletController.getBalance);

// GET /api/wallet/history?limit=20
router.get('/history', authenticateToken, walletController.getHistory);

router.post("/pay", authenticateToken, walletController.payForBooking);

// RÚT TIỀN (FLOW 2 GIAI ĐOẠN)
router.post("/withdraw/request", authenticateToken, walletController.requestWithdrawal); // User yêu cầu
router.get("/withdraw/my-requests", authenticateToken, walletController.getMyWithdrawRequests); // User xem lịch sử của mình
router.get("/withdraw/list", authenticateToken, walletController.getWithdrawRequests); // Admin xem list
router.post("/withdraw/process", authenticateToken, walletController.processWithdrawal); // Admin xử lý

module.exports = router;
