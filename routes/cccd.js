const express = require('express');
const router = express.Router();
const { submit, getUserCccd, getLatestCccd, updateVerificationStatus, uploadCccd, getCCCDStatus, checkVerifiedCCCD, uploadFaceImage, getSignedCccdUrl } = require('../controllers/idCardController');
const { authenticateToken } = require('../middleware/auth');

// Submit CCCD để xác minh
router.post('/submit', authenticateToken, uploadCccd, submit);

// Lấy danh sách CCCD của user
router.get('/user', authenticateToken, getUserCccd);

// Lấy URL CCCD đã ký (hết hạn sau thời gian ngắn)
router.get('/signed-url', authenticateToken, getSignedCccdUrl);
// Lấy URL ảnh mặt đã ký (nếu đã lưu public_id trong bản ghi CCCD)
router.get('/face-signed-url', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.user_id;
    const CCCD = require('../models/CCCD');
    const latest = await CCCD.findLatestByUserId(userId);
    const publicId = latest?.face_image_path;
    if (!publicId || String(publicId).startsWith('http')) {
      return res.status(404).json({ success:false, message:'Không có ảnh mặt an toàn' });
    }
    const { generateSignedCertificateUrl } = require('../config/cloudinary');
    const { url, expiresAt } = generateSignedCertificateUrl(publicId, { resource_type: 'image', ttlSeconds: 600 });
    return res.json({ success:true, data:{ url, expires_at: expiresAt } });
  } catch (e) {
    console.error('face-signed-url error', e);
    return res.status(500).json({ success:false, message:'Không tạo được URL ảnh mặt' });
  }
});
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