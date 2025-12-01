// routes/sos.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ dest: 'uploads/sos/' });

// Tạo SOS Job
router.post('/create', authenticateToken, upload.array('images', 3), async (req, res) => {
  try {
    const { description, lat, lng } = req.body;
    const images = req.files?.map(f => f.path) || [];

    // Tạo booking SOS ở đây (gọi controller hoặc query)
    // Sau đó phát qua Socket.IO: io.emit('new_sos_job', data)

    res.json({ success: true, message: 'SOS đã được gửi!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;