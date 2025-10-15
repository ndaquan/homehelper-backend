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
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { connectDB } = require("./config/database");
const SocketHandler = require("./socket/socketHandler");
const { setIOInstance } = require("./controllers/conversationController");

// Khởi tạo Express app
const app = express();
const server = http.createServer(app);

// Middleware bảo mật
app.use(helmet());

// Khởi tạo Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Gắn io vào app để controller có thể lấy qua req.app.get('io')
app.set('io', io);

// Khởi tạo Socket Handler
const socketHandler = new SocketHandler(io);

// Set IO instance cho controllers
setIOInstance(io);

// Middleware CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);

// Middleware logging
app.use(morgan("combined"));

// Middleware parse JSON
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Middleware static files
app.use('/uploads', express.static('uploads'));
app.use('/public', express.static('public'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/cccd', require('./routes/cccd'));
app.use("/uploads", express.static("uploads"));

// Routes
app.use("/api/tasker-profile", require("./routes/taskerProfile"));
// app.use('/api/users', require('./routes/users'));
app.use("/api/bookings", require("./routes/bookings"));
// app.use('/api/posts', require('./routes/posts'));
app.use("/api/ratings", require("./routes/ratings"));
app.use("/api/wishlists", require("./routes/wishlist"));

// app.use('/api/feedbacks', require('./routes/feedbacks'));
// app.use('/api/complaints', require('./routes/complaints'));
// app.use('/api/notifications', require('./routes/notifications'));
app.use("/api/momo", require("./routes/momo"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/tasker", require("./routes/tasker"));
app.use("/api/services", require("./routes/services"));
app.use("/api/conversations", require("./routes/conversations"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/users", require("./routes/users"));
app.use("/api/blogs", require("./routes/blogs"));
app.use("/api/uploads", require("./routes/uploads"));
app.use("/api/quotes", require("./routes/quotes"));
app.use("/api/videos", require("./routes/videoRoutes"));
app.use("/api/negotiations", require("./routes/negotiations"));
// app.use('/api/users', require('./routes/users'));
// app.use('/api/bookings', require('./routes/bookings'));
// app.use('/api/posts', require('./routes/posts'));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "HomeHelper Backend đang hoạt động!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Test OCR page
app.get('/test-ocr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test-ocr.html'));
});

// 404 handler with logging
app.use((req, res) => {
  console.warn("⚠️ 404 Not Found:", req.method, req.originalUrl, "Headers:", {
    accept: req.headers['accept'],
    contentType: req.headers['content-type'],
    auth: req.headers['authorization'] ? 'present' : 'none'
  });
  res.status(404).json({
    error: "API endpoint không tồn tại",
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("❌ Global error:", error);

  res.status(error.status || 500).json({
    error: {
      message: error.message || "Lỗi server nội bộ",
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    },
  });
});

// Khởi động server
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Kết nối database
    await connectDB();

    // Khởi động server
    server.listen(PORT, () => {
      console.log("🚀 HomeHelper Backend đã khởi động!");
      console.log(`📍 Server đang chạy tại: http://localhost:${PORT}`);
      console.log(`🔌 Socket.IO đã sẵn sàng!`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`📅 Thời gian: ${new Date().toLocaleString("vi-VN")}`);
      console.log("=".repeat(50));
    });
  } catch (error) {
    console.error("❌ Không thể khởi động server:", error);
    process.exit(1);
  }
}

// Xử lý tắt server gracefully
process.on("SIGTERM", () => {
  console.log("🛑 Nhận tín hiệu SIGTERM, đang tắt server...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Nhận tín hiệu SIGINT, đang tắt server...");
  process.exit(0);
});

// Khởi động server
startServer();
