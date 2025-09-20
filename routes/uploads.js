const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { cloudinary, postImagesUpload, memoryUpload } = require('../config/cloudinary');

const router = express.Router();

// Prefer CloudinaryStorage if available; otherwise fall back to memory + upload_stream
const upload = postImagesUpload || memoryUpload;

// POST /api/uploads/post-images
router.post('/post-images', authenticateToken, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    // If using CloudinaryStorage, multer already uploaded and populated path on file
    if (postImagesUpload) {
      const urls = req.files.map(f => f.path).filter(Boolean);
      const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
      const folderBase = process.env.CLOUDINARY_FOLDER_BASE || 'homehelper';
      const folder = `${folderBase}/posts/${userId}`;
      return res.json({ success: true, data: { urls, folder } });
    }

    const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
    const folderBase = process.env.CLOUDINARY_FOLDER_BASE || 'homehelper';
    const folder = `${folderBase}/posts/${userId}`;

    const uploads = await Promise.all(
      req.files.map((file) => new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        stream.end(file.buffer);
      }))
    );

    const urls = uploads.map(u => u.secure_url || u.url).filter(Boolean);
    res.json({ success: true, data: { urls, folder } });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
  }
});

module.exports = router;
