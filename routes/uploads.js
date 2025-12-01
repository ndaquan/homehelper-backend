const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const {
  cloudinary,
  avatarUpload,
  postImagesUpload,
  taskPhotosUpload,
  handleTaskPhotosUpload,
  memoryUpload,
} = require("../config/cloudinary");
const ImageEncryption = require("../utils/imageEncryption");

const router = express.Router();

// Prefer CloudinaryStorage if available; otherwise fall back to memory + upload_stream
const upload = postImagesUpload || taskPhotosUpload || memoryUpload;

// POST /api/uploads/post-images
router.post(
  "/post-images",
  authenticateToken,
  upload.array("images", 10),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "No files uploaded" });
      }

      // If using CloudinaryStorage, multer already uploaded and populated path on file
      if (postImagesUpload) {
        const urls = req.files.map((f) => f.path).filter(Boolean);
        const userId =
          (req.user && (req.user.userId || req.user.user_id)) || "anonymous";
        const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
        const folder = `${folderBase}/posts/${userId}`;
        return res.json({ success: true, data: { urls, folder } });
      }

      const userId =
        (req.user && (req.user.userId || req.user.user_id)) || "anonymous";
      const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
      const folder = `${folderBase}/posts/${userId}`;

      const uploads = await Promise.all(
        req.files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                { folder, resource_type: "image" },
                (error, result) => {
                  if (error) return reject(error);
                  resolve(result);
                }
              );
              stream.end(file.buffer);
            })
        )
      );

      const urls = uploads.map((u) => u.secure_url || u.url).filter(Boolean);
      res.json({ success: true, data: { urls, folder } });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error.message,
      });
    }
  }
);
router.post(
  "/task-photos/before/:taskId",
  authenticateToken,
  (taskPhotosUpload || memoryUpload).array("photos", 10),
  handleTaskPhotosUpload("before")
);
router.post(
  "/task-photos/after/:taskId",
  authenticateToken,
  (taskPhotosUpload || memoryUpload).array("photos", 10),
  handleTaskPhotosUpload("after")
);

// POST /api/uploads/avatar - Upload avatar với encryption
router.post(
  "/avatar",
  authenticateToken,
  (avatarUpload || memoryUpload).single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Không có file được upload",
        });
      }

      let avatarUrl = null;

      // Nếu dùng CloudinaryStorage, file đã được upload và có path
      if (avatarUpload && req.file.path) {
        avatarUrl = req.file.path;
      } else {
        // Fallback: upload manually via upload_stream
        const userId =
          (req.user && (req.user.userId || req.user.user_id)) || "anonymous";
        const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
        const folder = `${folderBase}/avatars/${userId}`;

        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: "image",
              transformation: [
                { width: 300, height: 300, crop: "fill" },
                { quality: "auto" },
              ],
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });

        avatarUrl = result.secure_url || result.url;
      }

      // Encrypt URL trước khi lưu vào database
      const encryptedUrl = ImageEncryption.encrypt(avatarUrl);

      res.json({
        success: true,
        data: {
          url: avatarUrl, // URL gốc để hiển thị
          encrypted_url: encryptedUrl, // URL đã encrypt để lưu vào DB
        },
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload avatar thất bại",
        error: error.message,
      });
    }
  }
);

module.exports = router;
