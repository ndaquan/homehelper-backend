
const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authenticateToken } = require('../middleware/auth');
const requireStaff = require('../middleware/requireStaff');

// Public routes - Get all services
router.get('/', serviceController.getAllServices);
router.get("/servicebasic", serviceController.getAll);

// Public route - Get service by ID
router.get('/:id', serviceController.getServiceById);

// Protected routes - CRUD operations (Staff/Admin only)
// Create service
router.post('/', authenticateToken, requireStaff, serviceController.createService);

// Update service
router.put('/:id', authenticateToken, requireStaff, serviceController.updateService);

// Delete service
router.delete('/:id', authenticateToken, requireStaff, serviceController.deleteService);

// ===== ServiceVariants routes =====
// List variants of a service (public)
router.get('/:id/variants', serviceController.getVariantsByService);

// Get single variant by id (public)
router.get('/variants/:variantId', serviceController.getVariantById);

// Create variant (Staff/Admin)
router.post('/:id/variants', authenticateToken, requireStaff, serviceController.createVariant);

// Update variant (Staff/Admin)
router.put('/variants/:variantId', authenticateToken, requireStaff, serviceController.updateVariant);

// Delete variant (Staff/Admin)
router.delete('/variants/:variantId', authenticateToken, requireStaff, serviceController.deleteVariant);

module.exports = router;
