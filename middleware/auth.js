const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware xác thực JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      console.log('No token provided');
      return res.status(401).json({
        error: 'Access token không được cung cấp'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Kiểm tra user có tồn tại không
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        error: 'Token không hợp lệ - User không tồn tại'
      });
    }

    // Thêm thông tin user vào request (chuẩn hóa cả 2 kiểu khóa)
    req.user = {
      userId: decoded.userId,
      user_id: decoded.userId,
      role: decoded.role,
      email: user.email
    };
    req.user.user_id = decoded.userId;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token đã hết hạn'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token không hợp lệ'
      });
    }

    console.error('❌ Lỗi xác thực token:', error);
    return res.status(500).json({
      error: 'Lỗi xác thực token'
    });
  }
};

// Middleware kiểm tra role
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Chưa xác thực'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Không có quyền truy cập',
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
};

// Middleware kiểm tra quyền admin
const requireAdmin = authorizeRole('Admin');

// Middleware kiểm tra quyền tasker
const requireTasker = authorizeRole('Tasker', 'Admin');

// Middleware kiểm tra quyền customer
const requireCustomer = authorizeRole('Customer', 'Admin','User');

// Middleware kiểm tra quyền user đã đăng nhập
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Chưa xác thực'
    });
  }
  next();
};

// Middleware kiểm tra quyền sở hữu (chỉ user sở hữu hoặc admin mới được truy cập)
const requireOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Chưa xác thực'
        });
      }

      // Admin có thể truy cập tất cả
      if (req.user.role === 'Admin') {
        return next();
      }

      // Kiểm tra quyền sở hữu dựa trên resource type
      const resourceId = req.params.id || req.params.userId || req.params.postId;
      
      if (!resourceId) {
        return res.status(400).json({
          error: 'Thiếu ID resource'
        });
      }

      // TODO: Implement logic kiểm tra quyền sở hữu dựa trên resourceType
      // Ví dụ: kiểm tra user có phải là chủ sở hữu của post, booking, etc.

      next();
    } catch (error) {
      console.error('❌ Lỗi kiểm tra quyền sở hữu:', error);
      return res.status(500).json({
        error: 'Lỗi kiểm tra quyền truy cập'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  authorizeRole,
  requireAdmin,
  requireTasker,
  requireCustomer,
  requireAuth,
  requireOwnership
};