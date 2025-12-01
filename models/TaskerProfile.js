const { executeQuery } = require("../config/database");
const Rating = require("./Rating");

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
             u.phone
      FROM Taskers t
      JOIN Users u ON t.tasker_id = u.user_id
      WHERE t.tasker_id = @param1
    `;
    const result = await executeQuery(query, [taskerId]);
    if (!result.recordset.length) return null;

    const tasker = result.recordset[0];
    tasker.name = tasker.user_name; // gán lại name từ Users

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
    if (!id || isNaN(parseInt(id, 10))) {
      throw new Error("Tasker ID không hợp lệ");
    }
    const taskerId = parseInt(id, 10);

    const { name, phone, Introduce } = data;

    // Cập nhật Users table (name, phone)
    if (name || phone) {
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

      if (userUpdates.length > 0) {
        userParams.push(taskerId);
        const userQuery = `UPDATE Users SET ${userUpdates.join(', ')} WHERE user_id = @param${paramIdx}`;
        await executeQuery(userQuery, userParams);
      }
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
