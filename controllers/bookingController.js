const { executeQuery } = require("../config/database");
const Booking = require("../models/Booking");

class BookingController {
  // ============================================
  // 1️⃣ Customer tạo Booking (từ JobDescription.js)
  // ============================================
  static async createFromJobDescription(req, res) {
    try {
      const {
        customer_id,
        tasker_id,
        service_id,
        variant_id,
        start_time,
        end_time,
        location,
        expected_price,
        job_description,
        photos,
      } = req.body;

      // ✅ Query chuẩn: status mặc định = 'Chờ xử lý'
      const query = `
        INSERT INTO Bookings (
          customer_id, tasker_id, service_id, variant_id,
          booking_time, start_time, end_time, location,
          status, expected_price, job_description, photos
        )
        VALUES (
          @customer_id, @tasker_id, @service_id, @variant_id,
          GETDATE(), @start_time, @end_time, @location,
          N'Chờ xử lý', @expected_price, @job_description, @photos
        );

        SELECT SCOPE_IDENTITY() AS booking_id;
      `;

      // 🧠 Thực thi query
      const result = await executeQuery(query, {
        customer_id,
        tasker_id,
        service_id,
        variant_id,
        start_time,
        end_time,
        location,
        expected_price,
        job_description,
        photos: JSON.stringify(photos || []),
      });

      // ✅ Lấy booking_id chính xác
      const bookingId = result?.recordset?.[0]?.booking_id;

      if (!bookingId) {
        console.error("⚠️ Không lấy được booking_id sau khi INSERT:", result);
        return res.status(500).json({
          success: false,
          message: "Không lấy được booking_id sau khi tạo booking",
        }); ``
      }

      res.status(201).json({
        success: true,
        booking_id: bookingId,
        message: "Tạo booking thành công!",
      });
    } catch (error) {
      console.error("❌ Lỗi createFromJobDescription:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  static async getBookingById(req, res) {
    try {
      const bookingId = req.params.id;

      const query = `
      SELECT 
        b.booking_id, b.customer_id, b.tasker_id, b.service_id, b.variant_id,
        b.booking_time, b.start_time, b.end_time, b.location, b.status,
        b.expected_price, b.job_description, b.photos,
        t.name AS tasker_name,
        s.service_name,
        v.variant_name
      FROM Bookings b
      LEFT JOIN Taskers t ON b.tasker_id = t.tasker_id
      LEFT JOIN Services s ON b.service_id = s.service_id
      LEFT JOIN ServiceVariants v ON b.variant_id = v.variant_id
      WHERE b.booking_id = @bookingId;
    `;

      const result = await executeQuery(query, { bookingId });

      if (!result.recordset.length) {
        return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
      }

      res.json({
        success: true,
        booking: result.recordset[0],
      });
    } catch (error) {
      console.error("❌ Lỗi getBookingById:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================
  // 2️⃣ Tasker xem chi tiết Booking
  // ============================================
  static async getBookingDetail(req, res) {
    try {
      const bookingId = req.params.id;
      console.log("📩 [DEBUG] GET booking by ID =", bookingId);

      const query = `
  SELECT 
    b.booking_id, b.customer_id, b.tasker_id, b.service_id, b.variant_id,
    b.booking_time, b.start_time, b.end_time, b.location, b.status,
    b.type, b.work_type, b.base_price, b.surcharge, b.final_price,
    t.status AS tasker_status,
    t.rating AS tasker_rating,
    s.name AS service_name,
    v.variant_name, v.pricing_type, v.unit, v.price_min, v.price_max
  FROM Bookings b
  LEFT JOIN Taskers t ON b.tasker_id = t.tasker_id
  LEFT JOIN Services s ON b.service_id = s.service_id
  LEFT JOIN ServiceVariants v ON b.variant_id = v.variant_id
  WHERE b.booking_id = @bookingId;
`;

      const result = await executeQuery(query, { bookingId });
      console.log("📊 [DEBUG] SQL result:", result.recordset);

      if (!result.recordset.length) {
        console.warn("⚠️ [WARN] Không tìm thấy booking trong DB!");
        return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
      }

      res.json({
        success: true,
        booking: result.recordset[0],
      });
    } catch (error) {
      console.error("❌ Lỗi getBookingDetail:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================
  // 3️⃣ Tasker cập nhật trạng thái (Start / Reject / Complete)
  // ============================================
  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      await executeQuery(
        `UPDATE Bookings SET status = @status WHERE booking_id = @id`,
        { id, status }
      );

      res.json({ success: true, message: `Cập nhật trạng thái: ${status}` });
    } catch (error) {
      console.error("❌ Lỗi updateStatus:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============================================
  // 4️⃣ (Cũ) Kiểm tra quyền đánh giá Tasker
  // ============================================
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

      if (!canRate) {
        return res.json({
          canRate: false,
          bookingId: null,
          alreadyRated: false,
        });
      }

      return res.json({ canRate, bookingId, alreadyRated });
    } catch (error) {
      console.error("❌ Error in canRate:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // ============================================
  // 5️⃣ (Cũ) Danh sách booking của user
  // ============================================
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
}

module.exports = {
  createFromJobDescription: BookingController.createFromJobDescription,
  getBookingDetail: BookingController.getBookingDetail,
  updateStatus: BookingController.updateStatus,
  canRateTasker: BookingController.canRateTasker,
  listMyBookings: BookingController.listMyBookings,
  getBookingById: BookingController.getBookingById,
};
