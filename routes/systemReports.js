const express = require('express');
const router = express.Router();
const SystemReportController = require('../controllers/systemReportController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// User gửi báo cáo (cần đăng nhập)
router.post('/', authenticateToken, SystemReportController.createReport);

// Admin xem danh sách (cần quyền Admin)
router.get('/', authenticateToken, requireAdmin, SystemReportController.getAllReports);

// Admin cập nhật trạng thái (cần quyền Admin)
router.put('/:id/status', authenticateToken, requireAdmin, SystemReportController.updateReportStatus);

module.exports = router;
