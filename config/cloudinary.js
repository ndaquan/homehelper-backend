const dotenv = require('dotenv');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
let CloudinaryStorage;
try {
  // Optional dependency: only required if using storage-based uploads
  ({ CloudinaryStorage } = require('multer-storage-cloudinary'));
} catch (_) {
  // If not installed, routes can still use upload_stream fallback
}

dotenv.config();

// Configure Cloudinary via environment variables
// Required: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// Optional: CLOUDINARY_SECURE=true, CLOUDINARY_FOLDER_BASE
const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_SECURE,
  CLOUDINARY_FOLDER_BASE = 'homehelper',
} = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.warn('⚠️ Cloudinary env vars missing. File uploads will fail until configured.');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: String(CLOUDINARY_SECURE || 'true').toLowerCase() === 'true',
});

// Optional: CloudinaryStorage-based multer middlewares
// 1) Avatar upload (fixed folder with resizing)
let avatarUpload = null;
// 2) Post images upload (dynamic folder per user: <base>/posts/<userId>)
let postImagesUpload = null;

if (CloudinaryStorage) {
  const avatarStorage = new CloudinaryStorage({
    cloudinary,
    params: async () => ({
      folder: `${CLOUDINARY_FOLDER_BASE}/avatars`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 300, height: 300, crop: 'fill' }, { quality: 'auto' }],
    }),
  });
  avatarUpload = multer({ storage: avatarStorage });

  const postImagesStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
      return {
        folder: `${CLOUDINARY_FOLDER_BASE}/posts/${userId}`,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        resource_type: 'image',
        // Optionally: public_id: `${Date.now()}-${file.originalname.replace(/[^a-z0-9_.-]/gi, '_')}`
      };
    },
  });
  postImagesUpload = multer({ storage: postImagesStorage });
}

// Fallback: memory storage for manual upload_stream usage in routes (if CloudinaryStorage not installed)
const memoryUpload = multer({ storage: multer.memoryStorage() });

module.exports = {
  cloudinary,
  // Prefer these if multer-storage-cloudinary is installed; otherwise use memoryUpload in routes
  avatarUpload,
  postImagesUpload,
  memoryUpload,
};
