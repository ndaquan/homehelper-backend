const { executeQuery } = require("../config/database");
const Booking = require("../models/Booking");

class BookingController {
  static async canRateTasker(req, res) {
    try {
      const taskerId = req.params.taskerId;
      const customerId = req.user.userId; // Đúng với middleware của bạn       console.log("customerId:", customerId, "taskerId:", taskerId);
      // console.log("customerId:", customerId, "taskerId:", taskerId);

      const bookings = await Booking.getCompletedBookings(customerId, taskerId);
      // console.log("Completed bookings:", bookings);

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
    // console.log("💬 canRate result:", { canRate, bookingId, alreadyRated });

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
          Pending: "Chờ xử lý",
          Accepted: "Đã chấp nhận",
          "In Progress": "Đang tiến hành",
          Completed: "Hoàn thành",
          Cancelled: "Hủy",
        };
        const vn = vnMap[status] || null;
        if (vn) {
          query += ` AND (b.status = @param${
            params.length + 1
          } OR b.status = @param${params.length + 2})`;
          params.push(status, vn);
        } else {
          query += ` AND b.status = @param${params.length + 1}`;
          params.push(status);
        }
      }

      query += " ORDER BY ISNULL(b.start_time, b.booking_time) DESC";

      const result = await executeQuery(query, params);
      return res.json({ success: true, data: result.recordset || [] });
    } catch (error) {
      console.error("❌ Error listing my bookings:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  }

  // Get booking details by ID
  static async getBookingDetails(req, res) {
    try {
      const bookingId = parseInt(req.params.bookingId, 10);
      if (!bookingId) {
        return res.status(400).json({ success: false, message: 'bookingId không hợp lệ' });
      }
      // Allow either participant (customer or tasker) to fetch details; otherwise 403
      const detailsRes = await executeQuery(
        `
          SELECT 
            b.booking_id,
            b.customer_id,
            b.tasker_id,
            b.service_id,
            b.variant_id,
            b.start_time,
            b.end_time,
            b.location,
            b.status,
            b.final_price,
            s.name AS service_name,
            sv.variant_name,
            sv.unit,
            sv.price_min,
            sv.price_max,
            sv.specific_price,
            uc.name AS customer_name,
            ut.name AS tasker_name
          FROM Bookings b
          LEFT JOIN Services s ON b.service_id = s.service_id
          LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
          LEFT JOIN Users uc ON uc.user_id = b.customer_id
          LEFT JOIN Users ut ON ut.user_id = b.tasker_id
          WHERE b.booking_id = @param1
        `,
        [bookingId]
      );
      const data = detailsRes.recordset?.[0];
      if (!data) {
        return res.status(404).json({ success: false, message: 'Booking không tồn tại' });
      }
      const userId = req.user.userId;
      if (String(data.customer_id) !== String(userId) && String(data.tasker_id) !== String(userId)) {
        return res.status(403).json({ success: false, message: 'Không có quyền xem booking này' });
      }
      return res.json({ success: true, data });
    } catch (error) {
      console.error('❌ Error getting booking details:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Update final price for a booking (tasker approval of negotiation)
  static async updateFinalPrice(req, res) {
    try {
      const bookingId = parseInt(req.params.bookingId, 10);
      const { price } = req.body || {};
      if (!bookingId || !Number.isFinite(Number(price))) {
        return res.status(400).json({ success: false, message: 'bookingId hoặc price không hợp lệ' });
      }
      // Basic authorization: either customer or tasker of this booking
      const bookingRes = await executeQuery(
        `SELECT booking_id, customer_id, tasker_id FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );
      const booking = bookingRes.recordset?.[0];
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking không tồn tại' });
      }
      const userId = req.user.userId;
      if (String(booking.customer_id) !== String(userId) && String(booking.tasker_id) !== String(userId)) {
        return res.status(403).json({ success: false, message: 'Không có quyền cập nhật booking này' });
      }

      await executeQuery(
        `UPDATE Bookings SET base_price = @param1 WHERE booking_id = @param2`,
        [Number(price), bookingId]
      );
      return res.json({ success: true, bookingId, final_price: Number(price) });
    } catch (error) {
      console.error('❌ Error updating booking final price:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = {
  canRateTasker: BookingController.canRateTasker,
  listMyBookings: BookingController.listMyBookings,
  getBookingDetails: BookingController.getBookingDetails,
  updateFinalPrice: BookingController.updateFinalPrice,
};
