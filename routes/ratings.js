const express = require("express");
const router = express.Router();
const {
  getRatings,
  addRating,
  getRatingsByTasker,
} = require("../controllers/ratingController");
const { authenticateToken } = require("../middleware/auth");

// GET /api/ratings - lấy danh sách ratings
router.get("/", authenticateToken, getRatings);
router.get("/:id", getRatingsByTasker);
// POST /api/ratings - thêm rating mới
router.post("/", authenticateToken, addRating);

module.exports = router;
