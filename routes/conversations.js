const express = require('express');
const router = express.Router();
const { ConversationController } = require('../controllers/conversationController');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');

// Cấu hình multer cho upload file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: function (req, file, cb) {
    // Chấp nhận tất cả các loại file
    cb(null, true);
  }
});

// Tất cả routes đều cần authentication
router.use(authenticateToken);

// Routes cho conversations
router.post('/', ConversationController.createConversation);
router.get('/', ConversationController.getConversations);
router.get('/:conversationId', ConversationController.getConversation);
router.put('/:conversationId', ConversationController.updateConversation);
router.delete('/:conversationId', ConversationController.deleteConversation);

// Routes cho participants
router.post('/:conversationId/participants', ConversationController.addParticipant);
router.delete('/:conversationId/participants/:participantId', ConversationController.removeParticipant);

// Routes cho messages
router.get('/:conversationId/messages', ConversationController.getMessages);
router.post('/:conversationId/messages', upload.single('file'), ConversationController.sendMessage);
router.get('/:conversationId/messages/search', ConversationController.searchMessages);

// Routes cho read status
router.post('/:conversationId/read', ConversationController.markAsRead);

module.exports = router;
