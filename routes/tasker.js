const express = require('express');
const router = express.Router();
const taskerController = require('../controllers/taskerController');
const { authenticateToken, requireAuth } = require('../middleware/auth');
router.post('/search-nearby', taskerController.searchNearbyUsers);


// Address management - requires auth
router.post('/address', authenticateToken, requireAuth, taskerController.createAddress);
router.get('/address', authenticateToken, requireAuth, taskerController.getAddressesByUserId);
router.put('/address/:address_id', authenticateToken, requireAuth, taskerController.updateAddress);
router.delete('/address/:address_id', authenticateToken, requireAuth, taskerController.deleteAddress);

router.get("/:id/services", taskerController.getWithServices);

// GET /api/taskers
router.get("/", taskerController.getAll);

// GET /api/taskers/by-variant/:variantId
router.get("/by-variant/:variantId", taskerController.getByVariant);

// GET /api/taskers/:id
router.get("/:id", taskerController.getById);

module.exports = router;