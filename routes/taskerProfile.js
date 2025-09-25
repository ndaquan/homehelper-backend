const express = require("express");
const router = express.Router();
const TaskerProfileController = require("../controllers/taskerProfileController");

// GET /api/tasker-profile/:id
router.get("/:id", TaskerProfileController.getById);

module.exports = router;
