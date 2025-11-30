const router = require("express").Router();
const ctrl = require("../controllers/evidenceController");
const adminCtrl = require("../controllers/evidenceController");
const { authenticateToken, requireTasker, requireAdmin } = require("../middleware/auth");
const { noShowUpload } = require("../config/cloudinary");

router.post(
  "/no-show",
  authenticateToken,
  requireTasker,
  noShowUpload.fields([
    { name: "house_number", maxCount: 1 },
    { name: "call_screenshot", maxCount: 1 },
    { name: "gps_screenshot", maxCount: 1 },
    { name: "house_front", maxCount: 1 },
  ]),
  ctrl.submitNoShowEvidence
);

// Admin
router.get("/pending", authenticateToken, requireAdmin, adminCtrl.getPendingEvidence);
router.post("/:id/approve", authenticateToken, requireAdmin, adminCtrl.approveEvidence);
router.post("/:id/reject", authenticateToken, requireAdmin, adminCtrl.rejectEvidence);

module.exports = router;