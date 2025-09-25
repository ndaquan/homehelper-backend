// Fix punycode deprecation warning
try {
  const punycode = require('punycode.js');
  if (typeof global.punycode === 'undefined') {
    global.punycode = punycode;
  }
} catch (e) {
  console.warn('punycode.js not available, punycode deprecation warnings may appear');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { connectDB } = require('./config/database');

// Khởi tạo Express app
const app = express();

// Middleware bảo mật
app.use(helmet());

// Middleware CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Middleware logging
app.use(morgan('combined'));

// Middleware parse JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware static files
app.use('/uploads', express.static('uploads'));
app.use('/public', express.static('public'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/cccd', require('./routes/cccd'));
// app.use('/api/users', require('./routes/users'));
// app.use('/api/services', require('./routes/services'));
// app.use('/api/bookings', require('./routes/bookings'));
// app.use('/api/posts', require('./routes/posts'));
// app.use('/api/ratings', require('./routes/ratings'));
// app.use('/api/notifications', require('./routes/notifications'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'HomeHelper Backend đang hoạt động!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// Test OCR page
app.get('/test-ocr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test-ocr.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint không tồn tại',
    path: req.originalUrl
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('❌ Global error:', error);
  
  res.status(error.status || 500).json({
    error: {
      message: error.message || 'Lỗi server nội bộ',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    }
  });
});

// Khởi động server
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Kết nối database - tạm thời comment out để test
    // await connectDB();
    
    // Khởi động server
    app.listen(PORT, () => {
      console.log('🚀 HomeHelper Backend đã khởi động!');
      console.log(`📍 Server đang chạy tại: http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`📅 Thời gian: ${new Date().toLocaleString('vi-VN')}`);
      console.log('='.repeat(50));
    });
  } catch (error) {
    console.error('❌ Không thể khởi động server:', error);
    process.exit(1);
  }
}

// Xử lý tắt server gracefully
process.on('SIGTERM', () => {
  console.log('🛑 Nhận tín hiệu SIGTERM, đang tắt server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Nhận tín hiệu SIGINT, đang tắt server...');
  process.exit(0);
});

// Khởi động server
startServer();
