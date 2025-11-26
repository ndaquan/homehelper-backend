const express = require('express');
const router = express.Router();
const { authenticateToken, requireStaff } = require('../middleware/auth');
const { memoryUpload } = require('../config/cloudinary');
const badgeController = require('../controllers/badgeController');
const { runBadgeScanOnce } = require('../services/badge.nightly');

router.get('/', authenticateToken, badgeController.listBadges);
// Create badge (multipart; staff only)
router.post(
	'/',
	authenticateToken,
	requireStaff,
	memoryUpload.single('icon'),
	badgeController.createBadge
);

// Update badge (supports changing meta and optionally reuploading icon)
router.put(
	'/:id',
	authenticateToken,
	requireStaff,
	memoryUpload.single('icon'),
	badgeController.updateBadge
);

// Delete badge
router.delete(
	'/:id',
	authenticateToken,
	requireStaff,
	badgeController.deleteBadge
);

module.exports = router;

// Manual scan endpoint (staff/admin only)
router.post('/scan', authenticateToken, requireStaff, async (req, res) => {
	try {
		const result = await runBadgeScanOnce();
		res.json({ message: 'Đã chạy quét huy hiệu', result });
	} catch (e) {
		console.error('[badges.scan] error:', e);
		res.status(500).json({ error: 'Không thể chạy quét huy hiệu', detail: e.message });
	}
});