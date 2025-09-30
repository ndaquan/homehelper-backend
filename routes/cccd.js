const express = require('express');
const router = express.Router();
const { submit, getUserCccd, getLatestCccd, updateVerificationStatus, uploadCccd, getCCCDStatus, checkVerifiedCCCD, uploadFaceImage } = require('../controllers/idCardController');
const { authenticateToken } = require('../middleware/auth');

// Submit CCCD để xác minh
router.post('/submit', authenticateToken, uploadCccd, submit);

// Lấy danh sách CCCD của user
router.get('/user', authenticateToken, getUserCccd);

// Lấy CCCD mới nhất của user
router.get('/latest', authenticateToken, getLatestCccd);

// Lấy trạng thái CCCD của user
router.get('/status', authenticateToken, getCCCDStatus);

// Kiểm tra user đã có CCCD được duyệt chưa
router.get('/verified', authenticateToken, checkVerifiedCCCD);

// Cập nhật trạng thái xác minh (admin)
router.put('/:cccdId/status', authenticateToken, updateVerificationStatus);

// Upload ảnh mặt lên Cloudinary
router.post('/upload-face', authenticateToken, uploadFaceImage);

module.exports = router;