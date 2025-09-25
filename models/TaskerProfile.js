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

    // Lấy reviews (đã bao gồm reviews + average + total + breakdown)
    const { reviews, average, total, breakdown } = await Rating.getByTaskerId(
      taskerId
    );

    tasker.reviews = reviews;
    tasker.rating = average;
    tasker.reviewCount = total;
    tasker.ratingBreakdown = breakdown;

    return tasker;
  }
}

module.exports = TaskerProfile;
