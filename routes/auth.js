const express = require('express');
const router = express.Router();
const { 
  register, 
  login, 
  getCurrentUser, 
  changePassword, 
  forgotPassword, 
  resetPassword,
  verifyEmail,
  updateProfile,
  loginWithGoogle
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

// POST /api/auth/register - Đăng ký user mới
router.post('/register', register);

// POST /api/auth/login - Đăng nhập
router.post('/login', login);

// POST /api/auth/google - Đăng nhập với Google ID token
router.post('/google', loginWithGoogle);

// POST /api/auth/forgot-password - Quên password
router.post('/forgot-password', forgotPassword);

// POST /api/auth/reset-password - Reset password
router.post('/reset-password', resetPassword);

// GET /api/auth/verify-email - Xác minh email
router.get('/verify-email', verifyEmail);

// GET /api/auth/me - Lấy thông tin user hiện tại (cần xác thực)
router.get('/me', authenticateToken, getCurrentUser);

// POST /api/auth/change-password - Đổi password (cần xác thực)
router.post('/change-password', authenticateToken, changePassword);

// PUT /api/auth/profile - Cập nhật profile (cần xác thực)
router.put('/profile', authenticateToken, updateProfile);

module.exports = router;
