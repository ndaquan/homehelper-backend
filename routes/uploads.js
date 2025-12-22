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
const { executeQuery } = require("../config/database");
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
  "/task-photos/:type/:bookingId",
  authenticateToken,
  (taskPhotosUpload || memoryUpload).array("photos", 10),
  async (req, res) => {
    try {
      const { type, bookingId } = req.params;
      const uploadedBy =
        req.user?.userId || req.user?.user_id || "anonymous";

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: "No files uploaded" });
      }

      console.log(`📸 Uploading ${req.files.length} photos for booking ${bookingId} (Type: ${type})`);

      const inserted = [];

      for (const file of req.files) {
        let photoUrl = file.path;

        // Fallback: If no path (MemoryStorage), upload manually
        if (!photoUrl && file.buffer) {
          console.log(`⚠️ No file path found, using manual buffer upload for ${file.originalname}`);
          // Use the helper from config/cloudinary with correct options
          // We need to require it if not already imported, but better to rely on imports.
          // Assuming uploadBufferToCloudinary is available in scope or imported.
          // Importing it inside this block is safer if not available globally in this file yet.
          const { uploadBufferToCloudinary } = require("../config/cloudinary");

          const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
          const result = await uploadBufferToCloudinary(file.buffer, {
            folder: `${folderBase}/task-photos/${uploadedBy}`,
            resource_type: "image",
          });
          photoUrl = result.secure_url || result.url;
        } else if (!photoUrl) {
          // Should not happen if memory or storage is working
          photoUrl = `/uploads/task-photos/${file.filename || Date.now()}`;
        }

        const query = `
          INSERT INTO TaskPhotos (booking_id, photo_url, photo_type, uploaded_by)
          OUTPUT inserted.*
          VALUES (@param1, @param2, @param3, @param4)
        `;

        const params = [
          bookingId,
          photoUrl,
          type,
          uploadedBy
        ];

        const result = await executeQuery(query, params);
        if (result.recordset && result.recordset[0]) {
          inserted.push(result.recordset[0]);
        }
      }

      console.log("✅ Photos uploaded successfully:", inserted.length);

      return res.json({
        success: true,
        message: "Photos uploaded successfully",
        data: inserted,
      });
    } catch (err) {
      console.error("❌ Task photos upload error:", err);
      return res.status(500).json({ success: false, message: "Upload failed", error: err.message });
    }
  }
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

// POST /api/uploads/signature - Upload chữ ký
router.post(
  "/signature",
  authenticateToken,
  memoryUpload.single("signature"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No signature file uploaded" });
      }

      const userId =
        (req.user && (req.user.userId || req.user.user_id)) || "anonymous";
      const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
      const folder = `${folderBase}/signatures/${userId}`;

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: "image",
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      const signatureUrl = result.secure_url || result.url;

      res.json({ success: true, data: { url: signatureUrl } });
    } catch (error) {
      console.error("Signature upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error.message,
      });
    }
  }
);

module.exports = router;
