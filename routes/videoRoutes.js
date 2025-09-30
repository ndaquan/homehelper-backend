const express = require('express');
const router = express.Router();
const VideoController = require('../controllers/VideoController');
const { authenticateToken, requireTasker } = require('../middleware/auth');
const { videoUpload } = require('../config/cloudinary');

// Route để tải lên video (yêu cầu đăng nhập và quyền tasker)
router.post(
  '/upload',
  authenticateToken,
  requireTasker,
  videoUpload.single('video'),
  VideoController.uploadVideo
);

// Route để xóa video (yêu cầu đăng nhập và quyền tasker)
router.delete('/:videoId', authenticateToken, requireTasker, VideoController.deleteVideo);

// Route để lấy danh sách video của người dùng (yêu cầu đăng nhập và quyền tasker)
router.get('/my-videos', authenticateToken, requireTasker, VideoController.getUserVideos);

// Route để lấy tất cả video (không yêu cầu đăng nhập)
router.get('/all-videos', VideoController.getAllVideos);

// Route để lấy chi tiết một video theo ID (không yêu cầu đăng nhập)
router.get('/:videoId', VideoController.getVideoById);

// Route để tạo bình luận cho video (yêu cầu đăng nhập)
router.post('/:videoId/comments', authenticateToken, VideoController.createVideoComment);

// Route để cập nhật bình luận (yêu cầu đăng nhập và quyền sở hữu bình luận)
router.put('/comments/:comment_id', authenticateToken, VideoController.updateVideoComment);

// Route để xóa bình luận (yêu cầu đăng nhập và quyền sở hữu bình luận)
router.delete('/comments/:comment_id', authenticateToken, VideoController.deleteVideoComment);

// Route để lấy danh sách bình luận của video (không yêu cầu đăng nhập)
router.get('/:videoId/comments', VideoController.getVideoComments);

// Route để lấy cây bình luận của video (không yêu cầu đăng nhập)
router.get('/:videoId/comments/tree', VideoController.getVideoCommentTree);

module.exports = router;