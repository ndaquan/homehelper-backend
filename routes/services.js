
const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');

// Get all services
router.get('/', serviceController.getAllServices);
router.get("/servicebasic", serviceController.getAll);


// Get service by ID
router.get('/:id', serviceController.getServiceById);

module.exports = router;
