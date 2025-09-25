const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const controller = require('../controllers/idCardController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'cccd');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg');
    cb(null, `${Date.now()}_${file.fieldname}${ext}`);
  }
});

const upload = multer({ storage });

router.post('/submit', upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]), controller.submit);
router.get('/user/:userId', controller.getByUser);
router.post('/test-ocr', upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]), controller.testOCR);

module.exports = router;






