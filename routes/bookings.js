const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { canRateTasker, listMyBookings } = require("../controllers/bookingController");

// GET /api/bookings/:taskerId/can-rate
router.get("/:taskerId/can-rate", authenticateToken, canRateTasker);

// GET /api/bookings/my - danh sách booking của user (khách hàng)
router.get("/my", authenticateToken, listMyBookings);

module.exports = router;
