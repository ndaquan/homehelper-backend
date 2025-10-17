const express = require("express");
const router = express.Router();
const {
  getRatings,
  addRating,
  getRatingsByTasker,
  approveRating,
  rejectRating,
} = require("../controllers/ratingController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

// GET /api/ratings - lấy danh sách ratings
router.get("/", authenticateToken, getRatings);
router.get("/:id", getRatingsByTasker);
// POST /api/ratings - thêm rating mới
router.post("/", authenticateToken, addRating);

router.put(
  "/:id/approve",
  authenticateToken,
  authorizeRole("Staff"),
  approveRating
);
router.put(
  "/:id/reject",
  authenticateToken,
  authorizeRole("Staff"),
  rejectRating
);
module.exports = router;
