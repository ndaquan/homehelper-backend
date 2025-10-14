const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { canRateTasker, listMyBookings, getBookingDetails, updateFinalPrice } = require("../controllers/bookingController");

// GET /api/bookings/:taskerId/can-rate
router.get("/:taskerId/can-rate", authenticateToken, canRateTasker);

// GET /api/bookings/my - danh sách booking của user (khách hàng)
router.get("/my", authenticateToken, listMyBookings);

// GET /api/bookings/:bookingId - chi tiết booking
router.get('/:bookingId', authenticateToken, getBookingDetails);

// PATCH /api/bookings/:bookingId/final-price
router.patch('/:bookingId/final-price', authenticateToken, updateFinalPrice);

module.exports = router;
