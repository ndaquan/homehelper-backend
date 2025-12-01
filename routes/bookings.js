const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  requireCustomer,
  requireTasker,
} = require("../middleware/auth");
const bookingController = require("../controllers/bookingController");
const { canRateTasker, listMyBookings, getBookingDetails, updateFinalPrice, getTaskerBookings, getActiveSosJobs, checkSosAvailability } = require("../controllers/bookingController");

const sessionController = require("../controllers/sessionController");
const { taskPhotosUpload, memoryUpload } = require("../config/cloudinary");
const { cancelBooking } = require("../controllers/bookingCancelController");

// 1️⃣ Tạo Booking từ JobDescription (Customer gửi mô tả)
router.post(
  "/",
  authenticateToken,
  requireCustomer,
  bookingController.createFromJobDescription
);

// 3️⃣ Tasker cập nhật trạng thái (Start / Reject / Complete)
// PATCH status must be authenticated and be a Tasker (so req.user is available)
router.patch("/:id/status", authenticateToken, requireTasker, bookingController.updateStatus);

// Check if SOS booking is still available (not taken by someone else)
router.get("/:id/sos-check", authenticateToken, requireTasker, checkSosAvailability);

// 5️⃣ Khách hàng xem danh sách Booking của mình
router.get("/mybookings", authenticateToken, bookingController.listMyBookings);

// Get active SOS booking for customer (to show on page load)
router.get("/customer/active-sos", authenticateToken, bookingController.getActiveSOSBooking);

// Get active SOS jobs for tasker (only those not expired and matching their service variants)
router.get("/tasker/active-sos", authenticateToken, requireTasker, getActiveSosJobs);

// Adding authenticateToken to the booking detail route
router.get("/:id", authenticateToken, bookingController.getBookingDetail);

// 4️⃣ Khách hàng kiểm tra quyền đánh giá Tasker
router.get(
  "/:taskerId/can-rate",
  authenticateToken,
  bookingController.canRateTasker
);

// // GET /api/bookings/:bookingId - chi tiết booking
// router.get('/:bookingId', authenticateToken, getBookingDetails);

// PATCH /api/bookings/:bookingId/final-price
router.patch("/:bookingId/final-price", authenticateToken, updateFinalPrice);

// 6️⃣ Tasker xem danh sách bookings của mình
router.get("/tasker/my", authenticateToken, requireTasker, getTaskerBookings);

// Session-level endpoints for multi-day bookings
// POST photos: multipart/form-data field 'photos' and body.type='before'|'after'
router.post(
  "/:bookingId/sessions/:dayKey/photos",
  authenticateToken,
  requireTasker,
  (taskPhotosUpload || memoryUpload).array("photos", 10),
  sessionController.uploadSessionPhotos
);

router.get(
  "/:bookingId/sessions/:dayKey",
  authenticateToken,
  sessionController.getSession
);

router.patch(
  "/:bookingId/sessions/:dayKey",
  authenticateToken,
  requireTasker,
  sessionController.updateSession
);

router.post("/:id/cancel", cancelBooking);

module.exports = router;
