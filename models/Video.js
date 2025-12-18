const { executeQuery, sql, getPool } = require('../config/database');

class Video {
    static async logModeration(videoId, moderation) {
        const raw = moderation.raw;
        const frames = raw.data?.frames || [];

        let nudityScore = raw.nudity?.raw || 0;
        let weaponScore = raw.weapon || 0;
        let violenceScore = raw.violence || 0;
        let offensiveScore = raw.offensive?.prob || 0;

        if (frames.length > 0) {
            frames.forEach(f => {
                nudityScore = Math.max(nudityScore,
                    f.nudity?.sexual_activity || 0,
                    f.nudity?.sexual_commerce || 0,
                    f.nudity?.erotica || 0,
                    f.nudity?.sextoy || 0,
                    f.nudity?.suggestive || 0
                );
                weaponScore = Math.max(weaponScore, f.weapon?.classes?.firearm || 0);
                violenceScore = Math.max(violenceScore, f.violence?.prob || 0);
                offensiveScore = Math.max(offensiveScore, f.offensive?.prob || 0);
            });
        }

        const reasons = [];
        if (nudityScore >= 0.7) reasons.push('Video chứa nội dung khiêu dâm, khỏa thân vi phạm chính sách');
        if (weaponScore >= 0.7) reasons.push('Video có hình ảnh vũ khí nguy hiểm');
        if (violenceScore >= 0.7) reasons.push('Video có nội dung bạo lực vi phạm chính sách');
        if (offensiveScore >= 0.7) reasons.push('Video có nội dung xúc phạm, thù địch');
        const rejectionReason = reasons.length > 0 ? reasons.join('. ') : null;

        const query = `
    INSERT INTO VideoModerations 
    (video_id, is_safe, nudity_score, weapon_score, violence_score, offensive_score, raw_response, rejection_reason, moderated_at)
    VALUES (@video_id, @is_safe, @nudity_score, @weapon_score, @violence_score, @offensive_score, @raw_response, @rejection_reason, GETDATE())
  `;

        try {
            const pool = await getPool(); // DÙNG getPool() từ database.js
            const request = pool.request(); // ĐÚNG: pool.request()

            request.input('video_id', sql.Int, videoId);
            request.input('is_safe', sql.Bit, moderation.isSafe);
            request.input('nudity_score', sql.Decimal(5, 4), parseFloat(nudityScore.toFixed(4)));
            request.input('weapon_score', sql.Decimal(5, 4), parseFloat(weaponScore.toFixed(4)));
            request.input('violence_score', sql.Decimal(5, 4), parseFloat(violenceScore.toFixed(4)));
            request.input('offensive_score', sql.Decimal(5, 4), parseFloat(offensiveScore.toFixed(4)));
            request.input('raw_response', sql.NVarChar(sql.MAX), JSON.stringify(raw));
            request.input('rejection_reason', sql.NVarChar(500), rejectionReason);

            await request.query(query);
        } catch (error) {
            console.error('Lỗi logModeration:', error);
            throw error;
        }
    }
    static async getVideosByUser(userId) {
        const query = `
    SELECT 
      v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, 
      v.likes, v.uploaded_at, v.status,
      v.text_moderation_status, v.text_moderation_reason,
      vm.rejection_reason
    FROM Videos v
    LEFT JOIN VideoModerations vm ON v.video_id = vm.video_id AND vm.is_safe = 0
    WHERE v.user_id = @param1 AND v.is_deleted = 0
    ORDER BY v.uploaded_at DESC
  `;
        try {
            const result = await executeQuery(query, [userId]);
            return result.recordset;
        } catch (error) {
            throw new Error(`Lỗi khi lấy video của người dùng: ${error.message}`);
        }
    }

    static async getPublicVideosByUser(userId) {
        const query = `
    SELECT 
      v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, 
      v.likes, v.uploaded_at, v.status
    FROM Videos v
    WHERE v.user_id = @param1 AND v.is_deleted = 0 AND v.status = 'Approved'
    ORDER BY v.uploaded_at DESC
  `;
        try {
            const result = await executeQuery(query, [userId]);
            return result.recordset;
        } catch (error) {
            throw new Error(`Lỗi khi lấy video công khai của người dùng: ${error.message}`);
        }
    }

    static async getAllVideos() {
        const query = `
      SELECT v.video_id, v.user_id, v.title, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status, 
             u.name AS expert, u.avatar_url, t.rating
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
      SELECT v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status, 
             u.name AS expert, u.avatar_url, t.rating
      FROM Videos v
      JOIN Users u ON v.user_id = u.user_id
      LEFT JOIN Taskers t ON v.user_id = t.tasker_id
      WHERE v.is_deleted = 0
      ORDER BY v.uploaded_at DESC
      OFFSET @param1 ROWS FETCH NEXT @param2 ROWS ONLY
    `;
        try {
            const result = await executeQuery(query, [(page - 1) * limit, limit]);
            return result.recordset;
        } catch (error) {
            throw new Error(`Lỗi khi lấy tất cả video cho Staff: ${error.message}`);
        }
    }
    static async createVideo(userId, title, description, videoUrl, publicId, textStatus = 'PENDING', textReason = null) {
        const query = `
    INSERT INTO Videos 
    (user_id, title, description, video_url, public_id, status, text_moderation_status, text_moderation_reason, uploaded_at)
    OUTPUT INSERTED.*
    VALUES (@param1, @param2, @param3, @param4, @param5, 'Pending', @param6, @param7, GETDATE())
  `;
        try {
            const result = await executeQuery(query, [
                userId, title, description || null, videoUrl, publicId, textStatus, textReason
            ]);
            return result.recordset[0];
        } catch (error) {
            throw new Error(`Lỗi khi tạo video: ${error.message}`);
        }
    }

    static async getVideoById(videoId) {
        const query = `
      SELECT v.video_id, v.user_id, v.title, v.description, v.video_url, v.public_id, v.likes, v.uploaded_at, v.status,
                  v.text_moderation_status, v.text_moderation_reason,
                  u.name AS expert, u.avatar_url, t.rating
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
        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            throw new Error('Trạng thái không hợp lệ');
        }

        const query = `
    UPDATE Videos
    SET status = @param2
    OUTPUT INSERTED.*
    WHERE video_id = @param1 AND is_deleted = 0
  `;
        try {
            const result = await executeQuery(query, [videoId, status]);
            if (result.recordset.length === 0) {
                throw new Error('Không thể cập nhật trạng thái: Video không tồn tại');
            }
            return result.recordset[0];
        } catch (error) {
            throw new Error(`Lỗi khi cập nhật trạng thái video: ${error.message}`);
        }
    }

    static async toggleLike(videoId, userId) {
        try {
            // Lấy video hiện tại
            const getQuery = `
        SELECT liked_by_users, likes 
        FROM Videos 
        WHERE video_id = @param1 AND is_deleted = 0
      `;
            const videoResult = await executeQuery(getQuery, [videoId]);

            if (videoResult.recordset.length === 0) {
                throw new Error('Video không tồn tại');
            }

            const video = videoResult.recordset[0];
            let likedUsers = [];

            // Parse JSON array of user IDs
            if (video.liked_by_users) {
                try {
                    likedUsers = JSON.parse(video.liked_by_users);
                } catch (e) {
                    likedUsers = [];
                }
            }

            let liked = false;
            const userIdNum = parseInt(userId);

            // Toggle like
            if (likedUsers.includes(userIdNum)) {
                // Unlike: remove user from array
                likedUsers = likedUsers.filter(id => id !== userIdNum);
                liked = false;
            } else {
                // Like: add user to array
                likedUsers.push(userIdNum);
                liked = true;
            }

            const newLikes = likedUsers.length;
            const likedUsersJson = JSON.stringify(likedUsers);

            // Update database
            const updateQuery = `
        UPDATE Videos
        SET liked_by_users = @param2, likes = @param3
        WHERE video_id = @param1
      `;

            await executeQuery(updateQuery, [videoId, likedUsersJson, newLikes]);

            return { liked, likes: newLikes };
        } catch (error) {
            throw new Error(`Lỗi khi toggle like: ${error.message}`);
        }
    }

    static async checkUserLiked(videoId, userId) {
        try {
            const query = `
        SELECT liked_by_users 
        FROM Videos 
        WHERE video_id = @param1 AND is_deleted = 0
      `;
            const result = await executeQuery(query, [videoId]);

            if (result.recordset.length === 0) {
                return false;
            }

            const video = result.recordset[0];
            if (!video.liked_by_users) {
                return false;
            }

            try {
                const likedUsers = JSON.parse(video.liked_by_users);
                return likedUsers.includes(parseInt(userId));
            } catch (e) {
                return false;
            }
        } catch (error) {
            throw new Error(`Lỗi khi kiểm tra like status: ${error.message}`);
        }
    }
}

module.exports = Video;