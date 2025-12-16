const express = require("express");
const router = express.Router();
const ChatbotController = require("../controllers/chatbotController");

// POST /api/chatbot/message - Send message to chatbot (public - no auth required)
router.post("/message", ChatbotController.sendMessage);

// GET /api/chatbot/status - Check chatbot availability
router.get("/status", ChatbotController.getStatus);

module.exports = router;

