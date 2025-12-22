const express = require('express');
const router = express.Router();
const AdminStatsController = require('../controllers/adminStatsController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/dashboard', authenticateToken, authorizeRole('Admin'), AdminStatsController.getDashboardStats);

module.exports = router;
