const { executeQuery } = require("../config/database");
const Rating = require("./Rating");
const ImageEncryption = require("../utils/imageEncryption");

class TaskerProfile {
  static async findById(id) {
    if (!id || isNaN(parseInt(id, 10))) {
      throw new Error("Tasker ID không hợp lệ");
    }
    const taskerId = parseInt(id, 10);

    // Lấy tasker + user info
    const query = `
      SELECT t.*, 
             u.name AS user_name, 
             u.email,  
             u.phone,
             u.avatar_url,
             u.date_of_birth,
             u.bio,
             u.created_at AS user_created_at
      FROM Taskers t
      JOIN Users u ON t.tasker_id = u.user_id
      WHERE t.tasker_id = @param1
    `;
    const result = await executeQuery(query, [taskerId]);
    if (!result.recordset.length) return null;

    const tasker = result.recordset[0];
    console.log('🔍 Raw tasker from DB:', { ...tasker, avatar_url: tasker.avatar_url ? `[${tasker.avatar_url.length} chars]` : 'NULL' });
    tasker.name = tasker.user_name; // gán lại name từ Users

    // Decrypt avatar_url if encrypted
    if (tasker.avatar_url) {
      console.log('🔓 Attempting to decrypt avatar_url...');
      try {
        const decrypted = ImageEncryption.decrypt(tasker.avatar_url);
        // If decryption returns something different, use it
        if (decrypted !== tasker.avatar_url || tasker.avatar_url.startsWith('http')) {
          tasker.avatar_url = decrypted;
        }
      } catch (e) {
        // If decryption fails, keep original (might be plain URL)
        console.warn('Failed to decrypt avatar_url:', e.message);
      }
    }

    // Lấy reviews - bọc trong try-catch để handle lỗi
    try {
      const { reviews, average, total, ratingsCount } = await Rating.getByTaskerId(taskerId);
      tasker.reviews = reviews;
      tasker.rating = average || tasker.rating;
      tasker.reviewCount = total;
      tasker.ratingsCount = ratingsCount;
    } catch (err) {
      console.error("Error loading reviews:", err.message);
      tasker.reviews = [];
      tasker.reviewCount = 0;
      tasker.ratingsCount = {};
    }

    return tasker;
  }

  // Cập nhật thông tin tasker profile
  static async update(id, data) {
    console.log('🔧 TaskerProfile.update called with:', { id, data: { ...data, avatar_url: data.avatar_url ? `[${data.avatar_url.length} chars]` : undefined } });

    if (!id || isNaN(parseInt(id, 10))) {
      throw new Error("Tasker ID không hợp lệ");
    }
    const taskerId = parseInt(id, 10);

    const { name, phone, Introduce, avatar_url } = data;
    console.log('🔧 Extracted from data:', { name, phone, Introduce, avatar_url: avatar_url ? 'has value' : 'undefined' });

    // Cập nhật Users table (name, phone, avatar_url)
    if (name || phone || avatar_url) {
      const userUpdates = [];
      const userParams = [];
      let paramIdx = 1;

      if (name) {
        userUpdates.push(`name = @param${paramIdx}`);
        userParams.push(name);
        paramIdx++;
      }
      if (phone) {
        userUpdates.push(`phone = @param${paramIdx}`);
        userParams.push(phone);
        paramIdx++;
      }
      if (avatar_url) {
        userUpdates.push(`avatar_url = @param${paramIdx}`);
        userParams.push(avatar_url);
        paramIdx++;
      }

      if (userUpdates.length > 0) {
        userParams.push(taskerId);
        const userQuery = `UPDATE Users SET ${userUpdates.join(', ')}, updated_at = SYSUTCDATETIME() WHERE user_id = @param${paramIdx}`;
        console.log('🔵 SQL Update Users:', userQuery);
        console.log('🔵 SQL Params:', userParams.map((p, i) => typeof p === 'string' && p.length > 50 ? `[${p.length} chars]` : p));
        const updateResult = await executeQuery(userQuery, userParams);
        console.log('✅ SQL Update result:', updateResult.rowsAffected);
      } else {
        console.log('⚠️ No user fields to update');
      }
    } else {
      console.log('⚠️ Skipped Users update - no name, phone, or avatar_url');
    }

    // Cập nhật Taskers table (Introduce)
    if (Introduce !== undefined) {
      await executeQuery(
        `UPDATE Taskers SET Introduce = @param1 WHERE tasker_id = @param2`,
        [Introduce, taskerId]
      );
    }

    // Trả về profile đã cập nhật
    return await this.findById(taskerId);
  }
}

module.exports = TaskerProfile;
