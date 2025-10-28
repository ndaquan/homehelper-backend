const { executeQuery, sql } = require('../config/database');

class Video {
  static async getVideosByUser(userId) {
    const query = `
      SELECT video_id, user_id, title, description, video_url, public_id, likes, uploaded_at, status
      FROM Videos
      WHERE user_id = @param1 AND is_deleted = 0
      ORDER BY uploaded_at DESC
    `;
    try {
      const result = await executeQuery(query, [userId]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Lỗi khi lấy video của người dùng: ${error.message}`);
    }
  }

  static async getAllVideos() {
    const query = `
      SELECT v.video_id, v.user_id, v.title, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status, u.name AS expert, t.rating
      FROM Videos v
      JOIN Users u ON v.user_id = u.user_id
      LEFT JOIN Taskers t ON v.user_id = t.tasker_id
      WHERE v.is_deleted = 0 AND v.status = 'Approved'
      ORDER BY v.uploaded_at DESC
    `;
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Lỗi khi lấy tất cả video: ${error.message}`);
    }
  }

static async getAllVideosForStaff(page = 1, limit = 5) {
    // Ép kiểu về số nguyên
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 5;
    const query = `
      SELECT v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status, u.name AS expert, t.rating
      FROM Videos v
      JOIN Users u ON v.user_id = u.user_id
      LEFT JOIN Taskers t ON v.user_id = t.tasker_id
      WHERE v.is_deleted = 0
      ORDER BY v.uploaded_at DESC
      OFFSET @param1 ROWS FETCH NEXT @param2 ROWS ONLY
    `;
    try {
      const result = await executeQuery(query, [ (page - 1) * limit, limit ]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Lỗi khi lấy tất cả video cho Staff: ${error.message}`);
    }
  }

  static async createVideo(userId, title, description, videoUrl, publicId) {
    const query = `
      INSERT INTO Videos (user_id, title, description, video_url, public_id, uploaded_at, status)
      OUTPUT INSERTED.video_id, INSERTED.user_id, INSERTED.title, INSERTED.description, INSERTED.video_url, INSERTED.public_id, INSERTED.uploaded_at, INSERTED.status
      VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE(), 'Pending')
    `;
    try {
      const result = await executeQuery(query, [userId, title, description || null, videoUrl, publicId]);
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi khi tạo video: ${error.message}`);
    }
  }

  static async getVideoById(videoId) {
    const query = `
      SELECT v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status, u.name AS expert, t.rating
      FROM Videos v
      JOIN Users u ON v.user_id = u.user_id
      LEFT JOIN Taskers t ON v.user_id = t.tasker_id
      WHERE v.video_id = @param1 AND v.is_deleted = 0
    `;
    try {
      const result = await executeQuery(query, [videoId]);
      return result.recordset[0] || null;
    } catch (error) {
      throw new Error(`Lỗi khi lấy video theo ID: ${error.message}`);
    }
  }

  static async updateVideo(videoId, userId, title, description, videoUrl, publicId) {
    if (!videoUrl) {
      throw new Error('Video URL không được để trống');
    }

    const query = `
      UPDATE Videos
      SET title = @param2, 
          description = @param3, 
          video_url = @param4, 
          public_id = @param5,
          uploaded_at = GETDATE()
      OUTPUT INSERTED.video_id, INSERTED.user_id, INSERTED.title, INSERTED.description, INSERTED.video_url, INSERTED.public_id, INSERTED.uploaded_at, INSERTED.status
      WHERE video_id = @param1 AND user_id = @param6 AND status = 'Pending' AND is_deleted = 0
    `;
    try {
      const result = await executeQuery(query, [videoId, title, description || null, videoUrl, publicId, userId]);
      if (result.recordset.length === 0) {
        throw new Error('Không thể cập nhật video: Video không tồn tại, không ở trạng thái Pending hoặc bạn không có quyền');
      }
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật video: ${error.message}`);
    }
  }

  static async deleteVideo(videoId, userId) {
    const query = `
      UPDATE Videos
      SET is_deleted = 1
      WHERE video_id = @param1 AND user_id = @param2
    `;
    try {
      const result = await executeQuery(query, [videoId, userId]);
      return result.rowsAffected[0] > 0;
    } catch (error) {
      throw new Error(`Lỗi khi xóa video: ${error.message}`);
    }
  }

  static async deleteVideoByStaff(videoId) {
    const query = `
      UPDATE Videos
      SET is_deleted = 1
      WHERE video_id = @param1
    `;
    try {
      const result = await executeQuery(query, [videoId]);
      if (result.rowsAffected[0] === 0) {
        throw new Error('Không thể xóa video: Video không tồn tại');
      }
      return true;
    } catch (error) {
      throw new Error(`Lỗi khi xóa video bởi Staff: ${error.message}`);
    }
  }

  static async checkVideoOwnership(videoId, userId) {
    const query = `
      SELECT video_id, public_id, status, video_url
      FROM Videos
      WHERE video_id = @param1 AND user_id = @param2 AND is_deleted = 0
    `;
    try {
      const result = await executeQuery(query, [videoId, userId]);
      return result.recordset[0] || null;
    } catch (error) {
      throw new Error(`Lỗi khi kiểm tra quyền sở hữu video: ${error.message}`);
    }
  }

  static async updateVideoStatus(videoId, status) {
    if (!['Approved', 'Rejected'].includes(status)) {
      throw new Error('Trạng thái không hợp lệ. Chỉ được phép là Approved hoặc Rejected.');
    }

    const query = `
      UPDATE Videos
      SET status = @param2
      OUTPUT INSERTED.video_id, INSERTED.user_id, INSERTED.title, INSERTED.description, 
             INSERTED.video_url, INSERTED.public_id, INSERTED.uploaded_at, INSERTED.status
      WHERE video_id = @param1 AND status = 'Pending' AND is_deleted = 0
    `;
    try {
      const result = await executeQuery(query, [videoId, status]);
      if (result.recordset.length === 0) {
        throw new Error('Không thể cập nhật trạng thái: Video không tồn tại hoặc không ở trạng thái Pending');
      }
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật trạng thái video: ${error.message}`);
    }
  }
}

module.exports = Video;