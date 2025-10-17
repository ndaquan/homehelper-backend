const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const bookingController = require("../controllers/bookingController");

// 1️⃣ Tạo Booking từ JobDescription (Customer gửi mô tả)
router.post("/", bookingController.createFromJobDescription);

// 3️⃣ Tasker cập nhật trạng thái (Start / Reject / Complete)
router.patch("/:id/status", bookingController.updateStatus);

router.get("/:id", bookingController.getBookingDetail); 

// 4️⃣ Khách hàng kiểm tra quyền đánh giá Tasker
router.get("/:taskerId/can-rate", authenticateToken, bookingController.canRateTasker);

// 5️⃣ Khách hàng xem danh sách Booking của mình
router.get("/my", authenticateToken, bookingController.listMyBookings);

module.exports = router;
