const express = require('express');
const router = express.Router();
const { createMomoPayment, momoIpn, devConfirm, checkOrderStatus } = require('../controllers/momoController');
const { authenticateToken } = require('../middleware/auth');

router.post('/create',
  (req, res, next) => { console.log('[momo] /create hit'); next(); },
  authenticateToken,
  (req, res, next) => { console.log('[momo] userId=', req.user?.userId, 'amount=', req.body?.amount); next(); },
  createMomoPayment
);

// Trạng thái đơn (Polling) - Cần auth
router.get('/order/:orderId', authenticateToken, checkOrderStatus);

// IPN: không cần auth, MoMo gọi trực tiếp
router.post('/ipn', express.json({ type: '*/*' }), momoIpn);

// (tuỳ): confirm tay khi DEV
router.post('/dev/confirm', devConfirm);

module.exports = router;
