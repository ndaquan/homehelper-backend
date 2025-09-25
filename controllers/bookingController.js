const { executeQuery } = require("../config/database");
const Booking = require("../models/Booking");

class BookingController {
  static async canRateTasker(req, res) {
    try {
      const taskerId = req.params.taskerId;
      const customerId = req.user.userId; // Đúng với middleware của bạn       console.log("customerId:", customerId, "taskerId:", taskerId);
      console.log("customerId:", customerId, "taskerId:", taskerId);

      const bookings = await Booking.getCompletedBookings(customerId, taskerId);
      console.log("Completed bookings:", bookings);

      // Tìm booking "Hoàn Thành" nào chưa được đánh giá
      let canRate = false;
      let bookingId = null;
      let alreadyRated = false;

      for (const booking of bookings) {
        const ratingResult = await executeQuery(
          `SELECT 1 FROM Ratings WHERE booking_id = @param1 AND reviewer_id = @param2`,
          [booking.booking_id, customerId]
        );
        if (ratingResult.recordset.length === 0) {
          canRate = true;
          bookingId = booking.booking_id;
          alreadyRated = false;
          break;
        }
      }

      // Nếu tất cả booking đều đã được đánh giá
      if (!canRate) {
        return res.json({
          canRate: false,
          bookingId: null,
          alreadyRated: false,
        });
      }

      return res.json({
        canRate,
        bookingId,
        alreadyRated,
      });
    } catch (error) {
      console.error("❌ Error in canRate:", error);
      res.status(500).json({ error: error.message });
    }
  }
  
    // Danh sách booking của user (khách hàng)
    static async listMyBookings(req, res) {
    try {
      const userId = req.user.userId;
      const { status = null, limit = 50 } = req.query;

      let query = `
        SELECT TOP ${parseInt(limit)}
          b.booking_id,
          b.customer_id,
          b.tasker_id,
          b.service_id,
          b.variant_id,
          b.start_time,
          b.end_time,
          b.location,
          b.status,
          s.name AS service_name,
          sv.variant_name
        FROM Bookings b
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        WHERE b.customer_id = @param1
      `;
      const params = [userId];

      if (status) {
        // Accept English or Vietnamese. Simple map for common values
        const vnMap = {
          'Pending': 'Chờ xử lý',
          'Accepted': 'Đã chấp nhận',
          'In Progress': 'Đang tiến hành',
          'Completed': 'Hoàn thành',
          'Cancelled': 'Hủy'
        };
        const vn = vnMap[status] || null;
        if (vn) {
          query += ` AND (b.status = @param${params.length + 1} OR b.status = @param${params.length + 2})`;
          params.push(status, vn);
        } else {
          query += ` AND b.status = @param${params.length + 1}`;
          params.push(status);
        }
      }

      query += ' ORDER BY ISNULL(b.start_time, b.booking_time) DESC';

      const result = await executeQuery(query, params);
      return res.json({ success: true, data: result.recordset || [] });
    } catch (error) {
      console.error('❌ Error listing my bookings:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = {
  canRateTasker: BookingController.canRateTasker,
  listMyBookings: BookingController.listMyBookings,
};
