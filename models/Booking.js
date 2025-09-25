const { executeQuery } = require("../config/database");

class Booking {
  // Lấy booking hoàn thành của user với tasker
  static async getCompletedBookings(userId, taskerId) {
    const query = `
    SELECT * 
    FROM Bookings
    WHERE customer_id = @param1
      AND tasker_id = @param2
      AND LOWER(LTRIM(RTRIM(status))) LIKE N'%hoàn thành%'
  `;
    const result = await executeQuery(query, [userId, taskerId]);
    return result.recordset || [];
  }
}

module.exports = Booking;
