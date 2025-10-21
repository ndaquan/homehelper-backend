const express = require("express");
const router = express.Router();
const { authenticateToken, requireCustomer, requireTasker } = require("../middleware/auth");
const bookingController = require("../controllers/bookingController");
const { canRateTasker, listMyBookings, getBookingDetails, updateFinalPrice } = require("../controllers/bookingController");

// 1️⃣ Tạo Booking từ JobDescription (Customer gửi mô tả)
router.post("/", authenticateToken, requireCustomer, bookingController.createFromJobDescription);

// 3️⃣ Tasker cập nhật trạng thái (Start / Reject / Complete)
router.patch("/:id/status", authenticateToken, requireTasker, bookingController.updateStatus);

router.get("/:id", authenticateToken, bookingController.getBookingDetail); 

// 4️⃣ Khách hàng kiểm tra quyền đánh giá Tasker
router.get("/:taskerId/can-rate", authenticateToken, bookingController.canRateTasker);

// 5️⃣ Khách hàng xem danh sách Booking của mình
router.get("/my", authenticateToken, bookingController.listMyBookings);

// GET /api/bookings/:bookingId - chi tiết booking
router.get('/:bookingId', authenticateToken, getBookingDetails);

// PATCH /api/bookings/:bookingId/final-price
router.patch('/:bookingId/final-price', authenticateToken, updateFinalPrice);

module.exports = router;
