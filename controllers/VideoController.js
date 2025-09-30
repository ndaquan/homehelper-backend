const { executeQuery, sql } = require('../config/database');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const { deleteFile } = require('../config/cloudinary');
const { moderateContent } = require('../config/gemini.service');

class VideoController {
  static async uploadVideo(req, res) {
    try {
      const { title, description } = req.body;
      const userId = req.user.user_id;

      if (!req.file) {
        return res.status(400).json({ error: 'Please provide a video file' });
      }

      if (!title) {
        return res.status(400).json({ error: 'Please provide a video title' });
      }

      const videoUrl = req.file.path;
      const publicId = req.file.filename;

      const video = await Video.createVideo(userId, title, description, videoUrl, publicId);

      res.status(201).json({
        message: 'Video uploaded successfully',
        video: {
          video_id: video.video_id,
          title: video.title,
          description: video.description,
          video_url: video.video_url,
          public_id: video.public_id,
          uploaded_at: video.uploaded_at,
        },
      });
    } catch (error) {
      console.error('❌ Error uploading video:', error);
      res.status(500).json({ error: 'Server error while uploading video' });
    }
  }

  static async deleteVideo(req, res) {
    try {
      const { videoId } = req.params;
      const userId = req.user.user_id;

      const video = await Video.checkVideoOwnership(videoId, userId);
      if (!video) {
        return res.status(403).json({ error: 'You do not have permission to delete this video or it does not exist' });
      }

      await deleteFile(video.public_id, 'video');

      const deleted = await Video.deleteVideo(videoId, userId);
      if (!deleted) {
        return res.status(404).json({ error: 'Video not found' });
      }

      res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error) {
      console.error('❌ Error deleting video:', error);
      res.status(500).json({ error: 'Server error while deleting video' });
    }
  }

  static async getAllVideos(req, res) {
    try {
      const videos = await Video.getAllVideos();
      res.status(200).json({
        message: 'All videos retrieved successfully',
        videos,
      });
    } catch (error) {
      console.error('❌ Error fetching all videos:', error);
      res.status(500).json({ error: 'Server error while fetching all videos' });
    }
  }

  static async getVideoById(req, res) {
    try {
      const { videoId } = req.params;

      const video = await Video.getVideoById(videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video không tồn tại' });
      }

      res.status(200).json({
        message: 'Lấy video thành công',
        video,
      });
    } catch (error) {
      console.error('❌ Lỗi khi lấy video:', error);
      res.status(500).json({ error: 'Lỗi server khi lấy video' });
    }
  }

  static async getUserVideos(req, res) {
    try {
      const userId = req.user.user_id;
      const videos = await Video.getVideosByUser(userId);

      res.status(200).json({
        message: 'Videos retrieved successfully',
        videos,
      });
    } catch (error) {
      console.error('❌ Error fetching videos:', error);
      res.status(500).json({ error: 'Server error while fetching videos' });
    }
  }

  static async createVideoComment(req, res) {
    try {
      const { video_id, parent_comment_id, content } = req.body;
      const user_id = req.user.user_id;

      if (!video_id || !content) {
        return res.status(400).json({ error: 'Vui lòng cung cấp video_id và nội dung comment' });
      }

      // Kiểm tra video tồn tại
      const video = await Video.getVideoById(video_id);
      if (!video) {
        return res.status(404).json({ error: 'Video không tồn tại' });
      }

      // Kiểm duyệt nội dung comment
      const isContentValid = await moderateContent(content);
      if (!isContentValid) {
        return res.status(400).json({ error: 'Nội dung comment không phù hợp, chứa từ ngữ không được phép' });
      }

      const commentData = {
        video_id,
        user_id,
        parent_comment_id: parent_comment_id || null,
        content
      };

      const comment = await Comment.create(commentData);
      res.status(201).json({
        message: 'Comment tạo thành công',
        comment
      });
    } catch (error) {
      console.error('❌ Lỗi khi tạo comment:', error);
      res.status(500).json({ error: `Lỗi khi tạo comment: ${error.message}` });
    }
  }

  static async updateVideoComment(req, res) {
    try {
      const { comment_id } = req.params;
      const { content } = req.body;
      const user_id = req.user.user_id;

      if (!content) {
        return res.status(400).json({ error: 'Vui lòng cung cấp nội dung bình luận để cập nhật' });
      }

      const comment = await Comment.findById(comment_id);
      if (!comment) {
        return res.status(404).json({ error: 'Bình luận không tồn tại' });
      }

      if (comment.user_id !== user_id) {
        return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa bình luận này' });
      }

      const isContentValid = await moderateContent(content);
      if (!isContentValid) {
        return res.status(400).json({ error: 'Nội dung bình luận không phù hợp, chứa từ ngữ không được phép' });
      }

      const updatedComment = await comment.update({ content }); // Sử dụng phương thức instance
      res.status(200).json({
        message: 'Cập nhật bình luận thành công',
        comment: updatedComment
      });
    } catch (error) {
      console.error('❌ Lỗi khi cập nhật bình luận:', error);
      res.status(500).json({ error: `Lỗi khi cập nhật bình luận: ${error.message}` });
    }
  }
static async deleteVideoComment(req, res) {
  try {
    const { comment_id } = req.params;
    const user_id = req.user.user_id;

    // Tìm bình luận theo ID
    const comment = await Comment.findById(comment_id);
    if (!comment) {
      return res.status(404).json({ error: 'Bình luận không tồn tại' });
    }

    // Kiểm tra quyền sở hữu bình luận
    if (comment.user_id !== user_id) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa bình luận này' });
    }

    // Gọi phương thức delete của instance Comment
    await comment.delete();

    res.status(200).json({ message: 'Bình luận xóa thành công' });
  } catch (error) {
    console.error('❌ Lỗi khi xóa bình luận:', error);
    res.status(500).json({ error: `Lỗi khi xóa bình luận: ${error.message}` });
  }
}

  static async getVideoComments(req, res) {
    try {
      const { videoId } = req.params;
      const { page, limit, includeReplies } = req.query;

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        includeReplies: includeReplies !== 'false'
      };

      const result = await Comment.findByVideoId(videoId, options);
      res.status(200).json({
        message: 'Lấy danh sách comment thành công',
        ...result
      });
    } catch (error) {
      console.error('❌ Lỗi khi lấy comment:', error);
      res.status(500).json({ error: `Lỗi khi lấy comment: ${error.message}` });
    }
  }
static async getVideoCommentTree(req, res) {
  try {
    const { videoId } = req.params;
    const { limit } = req.query;

    const options = {
      limit: parseInt(limit) || 50
    };

    const commentTree = await Comment.getCommentTree(videoId, options);
    res.status(200).json({
      message: 'Lấy comment tree thành công',
      comments: commentTree || [] // Đảm bảo luôn trả về mảng, ngay cả khi rỗng
    });
  } catch (error) {
    console.error('❌ Lỗi khi lấy comment tree:', error);
    res.status(500).json({ error: `Lỗi khi lấy comment tree: ${error.message}` });
  }
}
}

module.exports = VideoController;