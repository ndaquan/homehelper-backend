const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

// Tìm kiếm user để bắt đầu cuộc trò chuyện
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const limit = parseInt(req.query.limit || 10);
    const currentUserId = req.user.user_id || req.user.userId; // hỗ trợ cả 2 dạng

    const users = await User.search(q, limit, currentUserId);

    // Trả về dữ liệu tối thiểu cần thiết
    const results = users.map(u => ({
      user_id: u.user_id,
      name: u.name,
      email: u.email,
      avatar: null,
      role: u.role,
      phone: u.phone || null
    }));

    res.status(200).json({
      message: 'Tìm kiếm người dùng thành công',
      users: results
    });
  } catch (error) {
    console.error('Lỗi tìm kiếm user:', error);
    // Nếu bảng chưa tồn tại, trả về rỗng để FE hiển thị trạng thái trống
    if (String(error.message).includes('Invalid object name')) {
      return res.status(200).json({ message: 'Tìm kiếm người dùng thành công', users: [] });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


