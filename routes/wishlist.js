const express = require("express");
const router = express.Router();
const WishlistController = require("../controllers/wishlistController");

// Lấy wishlist của customer
router.get("/:customerId", WishlistController.getWishlist);

// Thêm / cập nhật wishlist
router.post("/", WishlistController.upsertWishlist);

// Xóa tasker khỏi wishlist
router.post("/remove", WishlistController.removeTasker);

module.exports = router;
