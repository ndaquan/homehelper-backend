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
// 3) Certificate upload (dynamic folder per user: <base>/certificates/<userId>)
let certificateUpload = null;

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

  const certificateStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
      return {
        folder: `${CLOUDINARY_FOLDER_BASE}/certificates/${userId}`,
        // Accept common image formats plus pdf (auto handles)
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
        resource_type: 'auto',
        // Switch to authenticated delivery so direct URLs require signing
        type: 'authenticated',
      };
    },
  });
  certificateUpload = multer({ storage: certificateStorage });
}

// Fallback: memory storage for manual upload_stream usage in routes (if CloudinaryStorage not installed)
const memoryUpload = multer({ storage: multer.memoryStorage() });

const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const userId = (req.user && (req.user.userId || req.user.user_id)) || 'anonymous';
    return {
      folder: `${CLOUDINARY_FOLDER_BASE}/videos/${userId}`,
      allowed_formats: ['mp4', 'mov', 'avi', 'mkv'],
      resource_type: 'video',
    };
  },
});

const videoUpload = multer({
  storage: videoStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

const deleteFile = async (publicId, resourceType = 'image') => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return true;
  } catch (error) {
    throw new Error(`Failed to delete file from Cloudinary: ${error.message}`);
  }
};

// Helper: generate a short-lived signed URL for an authenticated asset
// ttlSeconds default 3600 (1h). Cloudinary signed URLs are created via sign_url util.
const generateSignedCertificateUrl = (publicId, { resource_type = 'image', ttlSeconds = 3600 } = {}) => {
  if (!publicId) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds; // epoch seconds
  // cloudinary.url with sign_url true will append token; for authenticated assets we also can use private_download_url for downloads
  const url = cloudinary.url(publicId, {
    resource_type,
    type: 'authenticated',
    sign_url: true,
    expires_at: expiresAt,
    secure: true,
    // Always provide an image preview, even for PDFs: first page as JPG with auto quality
    transformation: [{ page: 1, fetch_format: 'jpg', quality: 'auto' }],
  });
  return { url, expiresAt: expiresAt * 1000 };
};
module.exports = {
  cloudinary,
  // Prefer these if multer-storage-cloudinary is installed; otherwise use memoryUpload in routes
  avatarUpload,
  postImagesUpload,
  certificateUpload,
  memoryUpload,
  videoUpload,
  deleteFile,
  generateSignedCertificateUrl,
};