const express = require("express");
const router = express.Router();
const { authenticateToken, requireCustomer, requireTasker } = require("../middleware/auth");
const bookingController = require("../controllers/bookingController");
const { canRateTasker, listMyBookings, getBookingDetails, updateFinalPrice, getTaskerBookings } = require("../controllers/bookingController");

// 1️⃣ Tạo Booking từ JobDescription (Customer gửi mô tả)
router.post("/", authenticateToken, requireCustomer, bookingController.createFromJobDescription);

// 3️⃣ Tasker cập nhật trạng thái (Start / Reject / Complete)
router.patch("/:id/status", bookingController.updateStatus);
// 5️⃣ Khách hàng xem danh sách Booking của mình
router.get("/mybookings", authenticateToken, bookingController.listMyBookings);

// Adding authenticateToken to the booking detail route
router.get("/:id", authenticateToken, bookingController.getBookingDetail); 

// 4️⃣ Khách hàng kiểm tra quyền đánh giá Tasker
router.get("/:taskerId/can-rate", authenticateToken, bookingController.canRateTasker);

// GET /api/bookings/:bookingId - chi tiết booking
router.get('/:bookingId', authenticateToken, getBookingDetails);

// PATCH /api/bookings/:bookingId/final-price
router.patch('/:bookingId/final-price', authenticateToken, updateFinalPrice);

// 6️⃣ Tasker xem danh sách bookings của mình
router.get('/tasker/my', authenticateToken, requireTasker, getTaskerBookings);

module.exports = router;
