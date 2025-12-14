const express = require('express');
const router = express.Router();
const AudioCallController = require('../controllers/audioCallController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);
router.get('/history', AudioCallController.getCallHistory);
router.get('/active', AudioCallController.getActiveCall);
router.get('/missed', AudioCallController.getMissedCalls);
router.get('/stats', AudioCallController.getCallStats);
router.get('/conversation/:conversationId', AudioCallController.getConversationCalls);
router.get('/conversation/:conversationId/messages', AudioCallController.getAudioCallMessages);
router.post('/initiate', AudioCallController.initiateCall);
router.post('/:callId/accept', AudioCallController.acceptCall);
router.post('/:callId/reject', AudioCallController.rejectCall);
router.post('/:callId/end', AudioCallController.endCall);
router.get('/:callId', AudioCallController.getCallDetail);
router.delete('/:callId', AudioCallController.deleteCall);
router.delete('/all', AudioCallController.deleteAllCalls);

module.exports = router;
