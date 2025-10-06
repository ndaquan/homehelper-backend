const express = require('express');
const router = express.Router();
const taskerController = require('../controllers/taskerController');
const { authenticateToken, requireAuth } = require('../middleware/auth');
const { certificateUpload, memoryUpload } = require('../config/cloudinary');

const certUploadMiddleware = certificateUpload || memoryUpload;

// Core Tasker CRUD / retrieval
router.post('/search-nearby', taskerController.searchNearbyUsers);
router.post('/address', authenticateToken, requireAuth, taskerController.createAddress);
router.get('/address', authenticateToken, requireAuth, taskerController.getAddressesByUserId);
router.put('/address/:address_id', authenticateToken, requireAuth, taskerController.updateAddress);
router.delete('/address/:address_id', authenticateToken, requireAuth, taskerController.deleteAddress);
router.get('/by-variant/:variantId', taskerController.getByVariant);
router.get('/', taskerController.getAll);
router.get('/:id', taskerController.getById);

// Certifications & Upgrade
router.get('/certifications/ping', taskerController.pingCertifications);
router.post('/certifications/_debug_upload_noauth', certUploadMiddleware.array('cert_files', 2), taskerController.debugUploadCertifications);
router.post('/certifications/upload', authenticateToken, requireAuth, certUploadMiddleware.array('cert_files', 5), taskerController.uploadCertifications);
router.post('/certifications/:cert_id/extract-ai', authenticateToken, requireAuth, taskerController.extractAICertification);
router.post('/certifications', authenticateToken, requireAuth, taskerController.createCertification);
router.post('/upgrade', authenticateToken, requireAuth, certUploadMiddleware.array('cert_files', 5), taskerController.upgradeToTasker);

module.exports = router;