const express = require("express");
const router = express.Router();
const {
  getRatings,
  addRating,
  getRatingsByTasker,
  replyToRating,
  toggleHelpful,
} = require("../controllers/ratingController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

// GET /api/ratings - lấy danh sách ratings
router.get("/", authenticateToken, getRatings);
router.get("/:id", getRatingsByTasker);
// POST /api/ratings - thêm rating mới
router.post("/", authenticateToken, addRating);
router.post(
  "/:rating_id/reply",
  authenticateToken,
  authorizeRole("Tasker"), // chỉ Staff mới được phản hồi
  replyToRating
);
router.post("/:id/helpful", authenticateToken, toggleHelpful);

// router.put(
//   "/:id/approve",
//   authenticateToken,
//   authorizeRole("Staff"),
//   approveRating
// );
// router.put(
//   "/:id/reject",
//   authenticateToken,
//   authorizeRole("Staff"),
//   rejectRating
// );
module.exports = router;
