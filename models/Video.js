const { executeQuery, sql } = require('../config/database');

class Video {
  static async getVideosByUser(userId) {
    const query = `
      SELECT video_id, user_id, title, description, video_url, public_id, likes, uploaded_at
      FROM Videos
      WHERE user_id = @param1 AND is_deleted = 0
      ORDER BY uploaded_at DESC
    `;
    try {
      const result = await executeQuery(query, [userId]);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error fetching videos: ${error.message}`);
    }
  }
  static async getAllVideos() {
    const query = `
      SELECT v.video_id, v.user_id, v.title, v.video_url, v.public_id, v.likes, v.uploaded_at, u.name AS expert, t.rating
      FROM Videos v
      JOIN Users u ON v.user_id = u.user_id
      LEFT JOIN Taskers t ON v.user_id = t.tasker_id
      WHERE v.is_deleted = 0
      ORDER BY v.uploaded_at DESC
    `;
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error fetching all videos: ${error.message}`);
    }
  }

  static async createVideo(userId, title, description, videoUrl, publicId) {
    const query = `
      INSERT INTO Videos (user_id, title, description, video_url, public_id, uploaded_at)
      OUTPUT INSERTED.video_id, INSERTED.user_id, INSERTED.title, INSERTED.description, INSERTED.video_url, INSERTED.public_id, INSERTED.uploaded_at
      VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE())
    `;
    try {
      const result = await executeQuery(query, [userId, title, description || null, videoUrl, publicId]);
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Error creating video: ${error.message}`);
    }
  }
  static async getVideoById(videoId) {
  const query = `
    SELECT v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, v.likes, v.uploaded_at, u.name AS expert, t.rating
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
      throw new Error(`Error deleting video: ${error.message}`);
    }
  }

  static async checkVideoOwnership(videoId, userId) {
    const query = `
      SELECT video_id, public_id
      FROM Videos
      WHERE video_id = @param1 AND user_id = @param2 AND is_deleted = 0
    `;
    try {
      const result = await executeQuery(query, [videoId, userId]);
      return result.recordset[0] || null;
    } catch (error) {
      throw new Error(`Error checking video ownership: ${error.message}`);
    }
  }
}

module.exports = Video;