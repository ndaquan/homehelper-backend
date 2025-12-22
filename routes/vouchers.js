// routes/vouchers.js
const express = require("express");
const router = express.Router();

const voucherController = require("../controllers/voucherController");
const { authenticateToken } = require('../middleware/auth');

router.get("/my", authenticateToken, voucherController.getMyVouchers);
router.get("/available-for-booking", authenticateToken, voucherController.getAvailableForBooking);
router.post("/redeem", authenticateToken, voucherController.redeemVoucher);

module.exports = router;
