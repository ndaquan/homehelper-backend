const express = require('express');
const router = express.Router();
const ComplaintController = require('../controllers/complaintController');

router.get('/', ComplaintController.getAllComplaints);
router.put('/:id/status', ComplaintController.updateStatus);

module.exports = router;
