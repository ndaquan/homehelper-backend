const express = require('express');
const router = express.Router();
const VideoController = require('../controllers/VideoController');

const { authenticateToken, requireTasker, requireStaff } = require('../middleware/auth');
const { videoUpload } = require('../config/cloudinary');
router.get('/pending', authenticateToken, requireStaff, VideoController.getPendingVideos);
router.post(
  '/upload',
  authenticateToken,
  requireTasker,
  videoUpload.single('video'),
  VideoController.uploadVideo
);
router.put(
  '/:videoId',
  authenticateToken,
  requireTasker,
  videoUpload.single('video'),
  VideoController.updateVideo
);

router.delete('/:videoId', authenticateToken, requireTasker, VideoController.deleteVideo);
router.get('/my-videos', authenticateToken, requireTasker, VideoController.getUserVideos);
router.get('/user/:userId', VideoController.getPublicVideosByUser);
router.get('/all-videos', VideoController.getAllVideos);
router.get('/popular', VideoController.getPopularVideos);
router.get('/:videoId', VideoController.getVideoById);
router.post('/:videoId/comments', authenticateToken, VideoController.createVideoComment);
router.put('/comments/:comment_id', authenticateToken, VideoController.updateVideoComment);
router.delete('/comments/:comment_id', authenticateToken, VideoController.deleteVideoComment);
router.get('/:videoId/comments', VideoController.getVideoComments);
router.get('/:videoId/comments/tree', VideoController.getVideoCommentTree);
// Like routes
router.post('/:videoId/like', authenticateToken, VideoController.toggleLike);
router.get('/:videoId/like-status', authenticateToken, VideoController.checkLikeStatus);
// router.delete('/:videoId', authMiddleware(['Staff', 'Admin']), VideoController.deleteVideoByStaff);
router.put('/:videoId/status', authenticateToken, requireStaff, VideoController.updateVideoStatus);

module.exports = router;