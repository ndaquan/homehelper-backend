const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminUsersController');
const taskersCtrl = require('../controllers/adminTaskersController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const requireAdmin = authorizeRole('Admin');

// All routes require admin
router.use(authenticateToken, requireAdmin);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.put('/users/:id', ctrl.updateUser);
router.post('/users/:id/ban', ctrl.banUser);
router.post('/users/:id/unban', ctrl.unbanUser);
router.delete('/users/:id', ctrl.deleteUser);

// Taskers summary
router.get('/taskers/summary', taskersCtrl.summary);

// Dashboard stats
const AdminStatsController = require('../controllers/adminStatsController');
router.get('/stats', AdminStatsController.getDashboardStats);
router.get('/financial-details', AdminStatsController.getFinancialDetails);

module.exports = router;
