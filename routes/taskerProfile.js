const express = require("express");
const router = express.Router();
const TaskerProfileController = require("../controllers/taskerProfileController");
const { authenticateToken } = require("../middleware/auth");

// GET /api/tasker-profile/:id
router.get("/:id", TaskerProfileController.getById);

// PUT /api/tasker-profile/:id - Cập nhật profile (cần auth)
router.put("/:id", authenticateToken, TaskerProfileController.update);

module.exports = router;
