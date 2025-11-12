const express = require("express");
const router = express.Router();
const taskerController = require("../controllers/taskerController");
const {
  authenticateToken,
  requireAuth,
  authorizeRole,
} = require("../middleware/auth");
const requireStaff = authorizeRole("Staff");
const {
  certificateUpload,
  memoryUpload,
  videoUpload,
} = require("../config/cloudinary");

const certUploadMiddleware = certificateUpload || memoryUpload;

// Core Tasker CRUD / retrieval
router.post('/search-nearby', taskerController.searchNearbyUsers);
router.post('/address', authenticateToken, requireAuth, taskerController.createAddress);
router.get('/address', authenticateToken, requireAuth, taskerController.getAddressesByUserId);
router.put('/address/:address_id', authenticateToken, requireAuth, taskerController.updateAddress);
router.delete('/address/:address_id', authenticateToken, requireAuth, taskerController.deleteAddress);

router.get("/:id/services", taskerController.getWithServices);

// API endpoint: Lấy danh sách Tasker với khoảng cách
router.post('/taskers-with-distance', authenticateToken, taskerController.getTaskersWithDistance);
router.get('/by-variant/:variantId', taskerController.getByVariant);
router.get('/', taskerController.getAll);

// Certifications & Upgrade
// API endpoint: Lấy danh sách variant_id đã đăng ký của tasker
router.get('/:id/registered-variants', taskerController.getRegisteredVariantIds);
// API endpoint: Lấy danh sách chứng chỉ đang pending cho staff duyệt

router.post('/certifications/approve', authenticateToken, requireStaff, taskerController.approveCertificationAndRegisterService);
router.post('/certifications/reject', authenticateToken, requireStaff, taskerController.rejectCertifications);
router.post('/certifications/pending', authenticateToken, requireAuth, taskerController.createPendingCertification);
router.get('/certifications/pending', authenticateToken, requireStaff, taskerController.getPendingCertifications);
router.get('/certifications/ping', taskerController.pingCertifications);
router.post('/certifications/_debug_upload_noauth', certUploadMiddleware.array('cert_files', 2), taskerController.debugUploadCertifications);
router.post('/certifications/upload', authenticateToken, requireAuth, certUploadMiddleware.array('cert_files', 5), taskerController.uploadCertifications);
router.post('/certifications/:cert_id/extract-ai', authenticateToken, requireAuth, taskerController.extractAICertification);
router.get('/certifications/:cert_id/signed-url', authenticateToken, requireAuth, taskerController.getSignedCertificateUrl);
router.get('/certifications/signed-url', authenticateToken, requireAuth, taskerController.getSignedCertificateUrlByPublicId);
router.post('/certifications', authenticateToken, requireAuth, taskerController.createCertification);
router.post('/upgrade', authenticateToken, requireAuth, certUploadMiddleware.array('cert_files', 5), taskerController.upgradeToTasker);

// API endpoint: Check if certificate code exists anywhere in the system
router.get('/certifications/check-code', authenticateToken, taskerController.checkCertificateCodeExists);
// API endpoint: Get all approved certificate codes
router.get('/certifications/approved-codes', authenticateToken, taskerController.getApprovedCertificateCodes);

// Application video upload (customer preparing upgrade, so only auth required, not tasker)
router.post(
  "/application/video-upload",
  authenticateToken,
  requireAuth,
  videoUpload ? videoUpload.single("video") : memoryUpload.single("video"),
  taskerController.uploadApplicationVideo
);
// Staff application moderation
router.post(
  "/applications/:id/approve",
  authenticateToken,
  requireStaff,
  taskerController.approveTaskerApplication
);
router.post(
  "/applications/:id/reject",
  authenticateToken,
  requireStaff,
  taskerController.rejectTaskerApplication
);
// Stateless AI re-check certifications in application snapshot
router.post(
  "/applications/:id/recheck-certifications",
  authenticateToken,
  requireStaff,
  taskerController.recheckApplicationCertifications
);
// Staff endpoints
router.get(
  "/applications",
  authenticateToken,
  requireStaff,
  taskerController.listTaskerApplications
);
router.get(
  "/applications/:id",
  authenticateToken,
  requireStaff,
  taskerController.getTaskerApplicationDetail
);
// Current user's latest application status
router.get(
  "/application/my-status",
  authenticateToken,
  requireAuth,
  taskerController.getMyTaskerApplicationStatus
);

// Generic tasker by id (must be numeric) placed last
// router.get('/:id', (req, res, next) => {
// 	if (!/^\d+$/.test(req.params.id)) {
// 		return res.status(400).json({ error: 'Tasker ID không hợp lệ' });
// 	}
// 	return taskerController.getById(req, res, next);
// });
router.get("/:id", taskerController.getById);
// API endpoint: Lấy danh sách Tasker với khoảng cách
router.post('/taskers-with-distance', authenticateToken, taskerController.getTaskersWithDistance);
router.get('/:taskerId/certifications', taskerController.getAllCertificationsOfTasker);
module.exports = router;
