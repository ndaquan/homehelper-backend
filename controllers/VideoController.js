const { executeQuery, sql } = require('../config/database');
const Video = require('../models/Video');
const Comment = require('../models/Comment');
const { deleteFile } = require('../config/cloudinary');
const { moderateContent,moderateVideoText } = require('../config/gemini.service');
const { moderateAndUpdateVideo } = require('../services/moderation.service');
const axios = require('axios');

class VideoController {
 static async uploadVideo(req, res) {
  let videoId;
  try {
    const { title, description } = req.body;
    const userId = req.user.user_id;

    if (!req.file) return res.status(400).json({ error: 'Vui lòng cung cấp file video' });
    if (!title) return res.status(400).json({ error: 'Vui lòng cung cấp tiêu đề' });

    // 1. DUYỆT TEXT
    const textCheck = await moderateVideoText(title, description);
    const textStatus = textCheck.isSafe ? 'OK' : 'BAD';
    const textReason = textCheck.isSafe ? null : textCheck.reason.substring(0, 500);

    const videoUrl = req.file.path;
    const publicId = req.file.filename;
    const publicIdWithExt = publicId.endsWith('.mp4') ? publicId : `${publicId}.mp4`;

    // 2. TẠO VIDEO
    const video = await Video.createVideo(
      userId, title, description, videoUrl, publicIdWithExt,
      textStatus, textReason
    );
    videoId = video.video_id;

    // 3. TRẢ KẾT QUẢ CHO USER (LUÔN TRẢ TRƯỚC)
    if (!textCheck.isSafe) {
      res.status(200).json({
        message: 'Upload thành công nhưng tiêu đề/mô tả vi phạm. Vui lòng chỉnh sửa.',
        video: { ...video, status: 'Pending' },
        violation: textCheck.reason
      });
    } else {
      res.status(201).json({
        message: 'Upload thành công! Video đang chờ duyệt...',
        video: { ...video, status: 'Pending' }
      });
    }

    // 4. CHẠY DUYỆT VIDEO NỀN
    moderateAndUpdateVideo(videoId, publicIdWithExt).catch(console.error);

  } catch (error) {
    console.error('Upload error:', error);
    if (videoId) {
      await Video.updateVideoStatus(videoId, 'Pending').catch(() => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Lỗi upload' });
    }
  }
}
  static async updateVideo(req, res) {
    try {
      const { videoId } = req.params;
      const { title, description } = req.body;
      const userId = req.user.user_id;

      if (!title) {
        return res.status(400).json({ error: 'Vui lòng cung cấp tiêu đề video' });
      }

      const video = await Video.checkVideoOwnership(videoId, userId);
      if (!video) {
        return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa video này hoặc video không tồn tại' });
      }

      if (video.status !== 'Pending') {
        return res.status(403).json({ error: 'Chỉ có thể chỉnh sửa video ở trạng thái Pending' });
      }

      let videoUrl = video.video_url;
      let publicId = video.public_id;

      if (!videoUrl) {
        return res.status(400).json({ error: 'Video URL hiện tại không hợp lệ. Vui lòng cung cấp file video mới.' });
      }

      try {
        const response = await axios.head(videoUrl);
        if (response.status !== 200) {
          return res.status(400).json({ error: 'File video hiện tại không tồn tại trên Cloudinary. Vui lòng cung cấp file video mới.' });
        }
      } catch (error) {
        console.warn('⚠️ Lỗi khi kiểm tra file video trên Cloudinary:', error.message);
        return res.status(400).json({ error: 'File video hiện tại không tồn tại hoặc không truy cập được. Vui lòng cung cấp file video mới.' });
      }

      if (req.file) {
        try {
          await deleteFile(video.public_id, 'video');
          videoUrl = req.file.path;
          publicId = req.file.filename;
        } catch (deleteError) {
          console.warn('⚠️ Không thể xóa file cũ trên Cloudinary:', deleteError.message);
        }
      }

      const updatedVideo = await Video.updateVideo(videoId, userId, title, description, videoUrl, publicId);

      res.status(200).json({
        message: 'Cập nhật video thành công',
        video: {
          video_id: updatedVideo.video_id,
          title: updatedVideo.title,
          description: updatedVideo.description,
          video_url: updatedVideo.video_url,
          public_id: updatedVideo.public_id,
          uploaded_at: updatedVideo.uploaded_at,
          status: updatedVideo.status,
        },
      });
    } catch (error) {
      console.error('❌ Lỗi khi cập nhật video:', error);
      res.status(500).json({ error: `Lỗi server khi cập nhật video: ${error.message}` });
    }
  }

  static async deleteVideo(req, res) {
    try {
      const { videoId } = req.params;
      const userId = req.user.user_id;

      const video = await Video.checkVideoOwnership(videoId, userId);
      if (!video) {
        return res.status(403).json({ error: 'Bạn không có quyền xóa video này hoặc video không tồn tại' });
      }

      try {
        await deleteFile(video.public_id, 'video');
      } catch (deleteError) {
        console.warn('⚠️ Không thể xóa file video trên Cloudinary:', deleteError.message);
      }

      const deleted = await Video.deleteVideo(videoId, userId);
      if (!deleted) {
        return res.status(404).json({ error: 'Video không tồn tại' });
      }

      res.status(200).json({ message: 'Xóa video thành công' });
    } catch (error) {
      console.error('❌ Lỗi khi xóa video:', error);
      res.status(500).json({ error: 'Lỗi server khi xóa video' });
    }
  }

  static async deleteVideoByStaff(req, res) {
    try {
      const { videoId } = req.params;

      const video = await Video.getVideoById(videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video không tồn tại' });
      }

      try {
        await deleteFile(video.public_id, 'video');
      } catch (deleteError) {
        console.warn('⚠️ Không thể xóa file video trên Cloudinary:', deleteError.message);
      }

      await Video.deleteVideoByStaff(videoId);

      res.status(200).json({ message: 'Xóa video thành công bởi Staff' });
    } catch (error) {
      console.error('❌ Lỗi khi xóa video bởi Staff:', error);
      res.status(500).json({ error: `Lỗi server khi xóa video: ${error.message}` });
    }
  }

  static async getAllVideos(req, res) {
    try {
      const videos = await Video.getAllVideos();
      res.status(200).json({
        message: 'Lấy tất cả video thành công',
        videos,
      });
    } catch (error) {
      console.error('❌ Lỗi khi lấy tất cả video:', error);
      res.status(500).json({ error: 'Lỗi server khi lấy tất cả video' });
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
      message: 'Lấy video của người dùng thành công',
      videos,
    });
  } catch (error) {
    console.error('Lỗi khi lấy video của người dùng:', error);
    res.status(500).json({ error: 'Lỗi server khi lấy video của người dùng' });
  }
}

  static async createVideoComment(req, res) {
    try {
      const { video_id, parent_comment_id, content } = req.body;
      const user_id = req.user.user_id;

      if (!video_id || !content) {
        return res.status(400).json({ error: 'Vui lòng cung cấp video_id và nội dung comment' });
      }

      const video = await Video.getVideoById(video_id);
      if (!video) {
        return res.status(404).json({ error: 'Video không tồn tại' });
      }

      const isContentValid = await moderateContent(content);
      if (!isContentValid) {
        return res.status(400).json({ error: 'Nội dung comment không phù hợp, chứa từ ngữ không được phép' });
      }

      const commentData = {
        video_id,
        user_id,
        parent_comment_id: parent_comment_id || null,
        content,
      };

      const comment = await Comment.create(commentData);
      res.status(201).json({
        message: 'Tạo comment thành công',
        comment,
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

      const updatedComment = await comment.update({ content });
      res.status(200).json({
        message: 'Cập nhật bình luận thành công',
        comment: updatedComment,
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

      const comment = await Comment.findById(comment_id);
      if (!comment) {
        return res.status(404).json({ error: 'Bình luận không tồn tại' });
      }

      if (comment.user_id !== user_id) {
        return res.status(403).json({ error: 'Bạn không có quyền xóa bình luận này' });
      }

      await comment.delete();

      res.status(200).json({ message: 'Xóa bình luận thành công' });
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
        includeReplies: includeReplies !== 'false',
      };

      const result = await Comment.findByVideoId(videoId, options);
      res.status(200).json({
        message: 'Lấy danh sách comment thành công',
        ...result,
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
        limit: parseInt(limit) || 50,
      };

      const commentTree = await Comment.getCommentTree(videoId, options);
      res.status(200).json({
        message: 'Lấy comment tree thành công',
        comments: commentTree || [],
      });
    } catch (error) {
      console.error('❌ Lỗi khi lấy comment tree:', error);
      res.status(500).json({ error: `Lỗi khi lấy comment tree: ${error.message}` });
    }
  }

  static async getPendingVideos(req, res) {
    try {
      const { page = 1, limit = 5 } = req.query;
      const videos = await Video.getAllVideosForStaff(page, limit);
      res.status(200).json({
        message: 'Lấy danh sách video thành công',
        videos,
      });
    } catch (error) {
      console.error('❌ Lỗi khi lấy danh sách video:', error);
      res.status(500).json({ error: 'Lỗi server khi lấy danh sách video' });
    }
  }

  static async updateVideoStatus(req, res) {
    try {
      const { videoId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Vui lòng cung cấp trạng thái video (Approved hoặc Rejected)' });
      }

      const updatedVideo = await Video.updateVideoStatus(videoId, status);

      res.status(200).json({
        message: 'Cập nhật trạng thái video thành công',
        video: {
          video_id: updatedVideo.video_id,
          title: updatedVideo.title,
          description: updatedVideo.description,
          video_url: updatedVideo.video_url,
          public_id: updatedVideo.public_id,
          uploaded_at: updatedVideo.uploaded_at,
          status: updatedVideo.status,
        },
      });
    } catch (error) {
      console.error('❌ Lỗi khi cập nhật trạng thái video:', error);
      res.status(500).json({ error: `Lỗi server khi cập nhật trạng thái video: ${error.message}` });
    }
  }
}

module.exports = VideoController;