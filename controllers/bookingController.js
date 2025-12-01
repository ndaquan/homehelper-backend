const { executeQuery } = require("../config/database");
const Booking = require("../models/Booking");
const { updateReliabilityScore } = require("../services/reliabilityScore.service");

class BookingController {
  // ============================================
  // 1️⃣ Customer tạo Booking (từ JobDescription.js)
  // ============================================
  static async createFromJobDescription(req, res) {
    console.log("📩 [DEBUG] Body nhận được từ FE:", req.body);

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
        task
      } = req.body;

      // ✅ Query chuẩn: status mặc định = 'Chờ xử lý'
      const query = `
        INSERT INTO Bookings (
          customer_id, tasker_id, service_id, variant_id,
          booking_time, start_time, end_time, location,
          status, expected_price
        )
        VALUES (
          @customer_id, @tasker_id, @service_id, @variant_id,
          GETDATE(), @start_time, @end_time, @location,
          N'Chờ xử lý', @expected_price
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
      });

      // ✅ Lấy booking_id chính xác
      const bookingId = result?.recordset?.[0]?.booking_id;

      if (!bookingId) {
        console.error("⚠️ Không lấy được booking_id sau khi INSERT:", result);
        return res.status(500).json({
          success: false,
          message: "Không lấy được booking_id sau khi tạo booking",
        });
      }

      console.log("✅ [Booking] booking_id =", bookingId);

      if (task) {
        const taskQuery = `
          INSERT INTO Tasks (booking_id, description, checklist, photos, completed)
          VALUES (@booking_id, @description, @checklist, @photos, 0);
        `;

        await executeQuery(taskQuery, {
          booking_id: bookingId,
          description: task.description || "",
          checklist: task.checklist || "",
          photos: JSON.stringify(task.photos || []),
        });

        console.log("🧾 [Task] Đã tạo Task cho booking_id:", bookingId);
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
          b.type, b.base_price, b.surcharge, b.final_price, b.expected_price,
          t.status AS tasker_status,
          t.rating AS tasker_rating,
          s.name AS service_name,
          v.variant_name, v.pricing_type, v.unit, v.price_min, v.price_max,
          uc.name AS customer_name, uc.email AS customer_email, uc.phone AS customer_phone,
          ut.name AS tasker_name, ut.email AS tasker_email, ut.phone AS tasker_phone,
          tk.task_id,
          tk.description AS task_description,
          tk.checklist AS task_checklist
        FROM Bookings b
        LEFT JOIN Taskers t ON b.tasker_id = t.tasker_id
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants v ON b.variant_id = v.variant_id
        LEFT JOIN Users uc ON b.customer_id = uc.user_id
        LEFT JOIN Users ut ON b.tasker_id = ut.user_id
        LEFT JOIN Tasks tk ON b.booking_id = tk.booking_id 
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
  // ============================================
  // Check if SOS booking is still available (tasker_id is NULL)
  // ============================================
  static async checkSosAvailability(req, res) {
    try {
      const { id } = req.params;

      const query = `
        SELECT booking_id, tasker_id, status, type
        FROM Bookings
        WHERE booking_id = @id AND type = N'SOS'
      `;

      const result = await executeQuery(query, { id });

      if (result.recordset.length === 0) {
        return res.json({ 
          available: false, 
          message: 'Không tìm thấy đơn SOS này' 
        });
      }

      const booking = result.recordset[0];

      // Check if tasker_id is NULL (available) and status is still "Chờ xử lý"
      const isAvailable = booking.tasker_id === null && booking.status === 'Chờ xử lý';

      if (isAvailable) {
        res.json({ 
          available: true, 
          message: 'Đơn SOS còn khả dụng, bạn có thể nhận' 
        });
      } else {
        res.json({ 
          available: false, 
          message: 'Đơn SOS này đã được người khác nhận rồi!',
          takenBy: booking.tasker_id || 'unknown'
        });
      }
    } catch (error) {
      console.error("❌ Lỗi checkSosAvailability:", error);
      res.status(500).json({ 
        available: false, 
        message: 'Có lỗi khi kiểm tra tính khả dụng của SOS' 
      });
    }
  }

  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // If a tasker accepts a booking (Đã chấp nhận) and booking.tasker_id is NULL,
      // set the tasker_id to the current authenticated user.
      const userId = req.user?.userId || null;
      console.log(`[BOOKING] updateStatus called - booking_id: ${id}, status: ${status}, tasker_id: ${userId}`);

      const query = `
        BEGIN TRAN;
        IF @status = N'Đã chấp nhận'
        BEGIN
          UPDATE Bookings
          SET tasker_id = CASE WHEN tasker_id IS NULL THEN @userId ELSE tasker_id END,
              status = @status
          WHERE booking_id = @id;
        END
        ELSE
        BEGIN
          UPDATE Bookings SET status = @status WHERE booking_id = @id;
        END
        COMMIT;
      `;

      await executeQuery(query, { id, status, userId });
      console.log(`[BOOKING] Status updated successfully for booking ${id}`);

      // If status is "Đã chấp nhận" for an SOS booking, notify customer via socket
      if (status === 'Đã chấp nhận') {
        try {
          console.log(`[BOOKING] Checking if booking ${id} is SOS type...`);
          const bookingRes = await executeQuery(
            `SELECT booking_id, customer_id, type, tasker_id FROM Bookings WHERE booking_id = @id`,
            { id }
          );

          if (bookingRes.recordset && bookingRes.recordset.length > 0) {
            const booking = bookingRes.recordset[0];
            const isSOS = booking.type === 'SOS';
            console.log(`[BOOKING] Booking type: ${booking.type}, isSOS: ${isSOS}`);

            if (isSOS) {
              const io = req.app.get('io');
              if (io) {
                console.log(`[BOOKING] Emitting sos_job_accepted to customer ${booking.customer_id}`);
                
                // Get tasker info
                const taskerRes = await executeQuery(
                  `SELECT user_id, name FROM Users WHERE user_id = @userId`,
                  { userId }
                );

                const taskerName = taskerRes.recordset?.[0]?.name || 'Tasker';
                const acceptedPayload = {
                  booking_id: id,
                  taken_by_tasker_id: userId,
                  taken_by_name: taskerName,
                  message: 'Tasker đã nhận công việc của bạn từ API'
                };

                // Broadcast to all users as fallback (customer might be on any page)
                io.emit('sos_job_accepted', acceptedPayload);
                console.log(`[BOOKING] Broadcasted sos_job_accepted:`, acceptedPayload);
              } else {
                console.warn(`[BOOKING] ❌ io instance not found in req.app`);
              }
            }
          }
        } catch (socketErr) {
          console.error(`[BOOKING] ❌ Error emitting socket event:`, socketErr);
          // Don't fail the API response due to socket error
        }
      }

      const bookingRes = await executeQuery(
        `SELECT tasker_id FROM Bookings WHERE booking_id = @param1`,
        [id]
      );

      const booking = bookingRes.recordset?.[0];

      if (booking) {
        if (status === "Hoàn thành" || status === "Completed") {
          console.log(`🎉 Cộng +5 điểm cho tasker ${booking.tasker_id}`);
          await updateReliabilityScore(booking.tasker_id, +5);
        }
      }

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
          sv.variant_name,
          b.expected_price,
          b.final_price
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
          Paid: "Đã thanh toán",
        };
        const vn = vnMap[status] || null;
        if (vn) {
          query += ` AND (b.status = @param${params.length + 1
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

  // ============================================
  // 6️⃣ Tasker xem danh sách bookings của mình
  // ============================================
  static async getTaskerBookings(req, res) {
    try {
      const taskerId = req.user.userId;
      const { status = null, limit = 50 } = req.query;

      let query = `
        SELECT TOP ${parseInt(limit)}
          b.booking_id,
          b.customer_id,
          b.tasker_id,
          b.service_id,
          b.variant_id,
          b.booking_time,
          b.start_time,
          b.end_time,
          b.location,
          b.status,
          b.expected_price,
          b.base_price,
          b.final_price,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          s.name AS service_name,
          sv.variant_name,
          t.description AS task_description,
          t.checklist AS task_checklist
        FROM Bookings b
        LEFT JOIN Users u ON b.customer_id = u.user_id
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        LEFT JOIN Tasks t ON b.booking_id = t.booking_id
        WHERE b.tasker_id = @param1
      `;

      const params = [taskerId];
      if (status) {
        const vnMap = {
          Pending: "Chờ xử lý",
          Accepted: "Đã chấp nhận",
          "In Progress": "Đang tiến hành",
          Completed: "Hoàn thành",
          Cancelled: "Hủy",
          Paid: "Đã thanh toán",
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

      query += " ORDER BY ISNULL(b.start_time, b.booking_time) DESC";

      const result = await executeQuery(query, params);
      return res.json({ success: true, data: result.recordset || [] });
    } catch (error) {
      console.error("❌ Error getting tasker bookings:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

  // Get active SOS booking for customer (to show on page load)
  static async getActiveSOSBooking(req, res) {
    try {
      const customerId = req.user.userId;

      const query = `
        SELECT TOP 1
          b.booking_id,
          b.customer_id,
          b.tasker_id,
          b.service_id,
          b.variant_id,
          b.start_time,
          b.end_time,
          b.location,
          b.status,
          b.type,
          s.name AS service_name,
          sv.variant_name,
          b.expected_price,
          b.final_price
        FROM Bookings b
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        WHERE b.customer_id = @customerId
          AND b.type = N'SOS'
          AND (b.status = N'Chờ xử lý' OR b.status = N'Đã chấp nhận')
        ORDER BY b.booking_time DESC
      `;

      const result = await executeQuery(query, { customerId });
      const booking = result.recordset?.[0];

      if (booking) {
        return res.json({ success: true, data: booking });
      } else {
        return res.json({ success: true, data: null });
      }
    } catch (error) {
      console.error("❌ Error getting active SOS booking:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  }
  // Get active SOS jobs for tasker (only those not expired)
  static async getActiveSosJobs(req, res) {
    try {
      const taskerId = req.user.userId;

      const query = `
        SELECT 
          b.booking_id,
          b.customer_id,
          b.service_id,
          b.variant_id,
          b.booking_time,
          b.start_time,
          b.end_time,
          b.location,
          b.status,
          b.base_price,
          b.final_price,
          b.expected_price,
          b.type,
          b.sos_expires_at,
          u.name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone,
          s.name AS service_name,
          sv.variant_name,
          t.description AS task_description,
          t.checklist AS task_checklist
        FROM Bookings b
        LEFT JOIN Users u ON b.customer_id = u.user_id
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        LEFT JOIN Tasks t ON b.booking_id = t.booking_id
        WHERE b.type = N'SOS'
          AND b.status = N'Chờ xử lý'
          AND b.sos_expires_at > GETDATE()
          AND EXISTS (
            SELECT 1 FROM TaskerServiceVariants tsv 
            WHERE tsv.tasker_id = @taskerId 
            AND tsv.variant_id = b.variant_id
          )
        ORDER BY b.sos_expires_at ASC
      `;

      const result = await executeQuery(query, { taskerId });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (error) {
      console.error('❌ Error getting active SOS jobs:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = {
  createFromJobDescription: BookingController.createFromJobDescription,
  getBookingDetail: BookingController.getBookingDetail,
  updateStatus: BookingController.updateStatus,
  checkSosAvailability: BookingController.checkSosAvailability,
  canRateTasker: BookingController.canRateTasker,
  listMyBookings: BookingController.listMyBookings,
  getBookingById: BookingController.getBookingById,
  getBookingDetails: BookingController.getBookingDetails,
  updateFinalPrice: BookingController.updateFinalPrice,
  getTaskerBookings: BookingController.getTaskerBookings,
  getActiveSOSBooking: BookingController.getActiveSOSBooking,
  getActiveSosJobs: BookingController.getActiveSosJobs,
};
