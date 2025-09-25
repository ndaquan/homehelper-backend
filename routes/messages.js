const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/messageController');
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

// Routes cho messages
router.get('/:messageId', MessageController.getMessage);
router.put('/:messageId', MessageController.updateMessage);
router.delete('/:messageId', MessageController.deleteMessage);
router.delete('/:messageId/permanent', MessageController.permanentDeleteMessage);

// Routes cho unread messages
router.get('/conversations/:conversationId/unread/count', MessageController.countUnreadMessages);
router.get('/conversations/:conversationId/unread', MessageController.getUnreadMessages);
router.get('/conversations/:conversationId/latest', MessageController.getLatestMessage);

// Routes cho upload file
router.post('/conversations/:conversationId/upload', upload.single('file'), MessageController.uploadFile);

module.exports = router;
