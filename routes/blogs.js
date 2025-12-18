const express = require("express");
const router = express.Router();
const blogController = require("../controllers/blogController");
const { authenticateToken, authorizeRole } = require("../middleware/auth");

// Public routes
router.get("/", blogController.getPosts);
router.get("/recent", blogController.getRecentPosts);
router.get("/popular", blogController.getPopularPosts);
router.get(
  "/all",
  authenticateToken,
  authorizeRole("Staff"),
  blogController.getAllPostsForStaff
);
router.get("/search", blogController.searchPosts);
router.get("/stats", blogController.getStats);
router.get("/:id", blogController.getPostById);
router.get("/:id/comments", blogController.getPostComments);
router.get("/:id/services", blogController.getPostServices);
router.get("/:id/related", blogController.getRelatedPosts);
router.get("/:id/likes", blogController.checkLikeStatus);
router.post("/:id/like", blogController.toggleLikePost);

// Protected routes (require authentication)
router.post("/", authenticateToken, blogController.createPost);
router.put("/:id", authenticateToken, blogController.updatePost);
router.delete("/:id", authenticateToken, blogController.deletePost);
router.put(
  "/:id/approve",
  authenticateToken,
  authorizeRole("Staff"),
  blogController.approvePost
);

router.put(
  "/:id/reject",
  authenticateToken,
  authorizeRole("Staff"),
  blogController.rejectPost
);
// Comment routes
router.post("/comments", authenticateToken, blogController.createComment);
router.put("/comments/:id", authenticateToken, blogController.updateComment);
router.delete("/comments/:id", authenticateToken, blogController.deleteComment);

module.exports = router;
