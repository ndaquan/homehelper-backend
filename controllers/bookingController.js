const { executeQuery } = require("../config/database");
const Booking = require("../models/Booking");
const { updateReliabilityScore } = require("../services/reliabilityScore.service");
const { notifyBookingEvent, notifySosRequestToTaskers } = require("../services/notification.service");
const { getPool, sql } = require("../config/database");
const { cloudinary, certificateUpload } = require('../config/cloudinary');
const sharp = require("sharp");

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
        quantity,
        total_sessions,
        dates,
        task
      } = req.body;

      // Allow FE to specify booking type (e.g., 'SOS') else default
      const type = req.body.type || "Cơ bản";

      const safeQuantity = quantity !== undefined ? Number(quantity) : null;

      console.log("📩 [DEBUG] Body nhận từ FE:", req.body);
      console.log("🔢 [BE] Quantity FE gửi lên (raw):", quantity);
      console.log("🔢 [BE] Quantity sau khi ép Number():", safeQuantity);

      const query = `
        INSERT INTO Bookings (
          customer_id, tasker_id, service_id, variant_id,
          booking_time, start_time, end_time, location,
          status, expected_price, quantity, total_sessions, type, description
        )
        VALUES (
          @customer_id, @tasker_id, @service_id, @variant_id,
          GETDATE(), @start_time, @end_time, @location,
          N'Chờ xử lý', @expected_price, @quantity, @total_sessions, @type, @description
        );

        SELECT SCOPE_IDENTITY() AS booking_id;
      `;

      // Log param trước khi đẩy xuống SQL
      console.log("🧪 [BE] Params gửi xuống SQL:", {
        customer_id,
        tasker_id,
        service_id,
        variant_id,
        start_time,
        end_time,
        location,
        expected_price,
        description: req.body.description || null,
        quantity: safeQuantity,
        type,
      });

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
        description: req.body.description || null,
        quantity: safeQuantity,
        total_sessions: total_sessions || 1,
        type,
      });

      console.log("📥 [BE] SQL Insert result:", result);

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
        // Nếu có total_sessions > 1 thì tạo nhiều Task, ngược lại tạo 1 Task
        const sessionsCount = Number(total_sessions) || 1;
        const sessionDates = (Array.isArray(dates) && dates.length > 0) ? dates : [start_time];

        for (let i = 0; i < sessionsCount; i++) {
          const currentSessionDate = sessionDates[i] || null; // N.u thiếu date thì để null hoặc logic khác tuỳ business

          const taskQuery = `
            INSERT INTO Tasks (
              booking_id, description, checklist, photos, completed, 
              session_number, session_date, status
            )
            VALUES (
              @booking_id, @description, @checklist, @photos, 0, 
              @session_number, @session_date, N'Chờ thực hiện'
            );
          `;

          await executeQuery(taskQuery, {
            booking_id: bookingId,
            description: task.description || "",
            checklist: task.checklist || "",
            photos: JSON.stringify(task.photos || []),
            session_number: i + 1,
            session_date: currentSessionDate ? new Date(currentSessionDate) : null,
          });
        }

        console.log(`🧾 [Task] Đã tạo ${sessionsCount} Task(s) cho booking_id:`, bookingId);
      }

      // Push notifications depending on type
      try {
        const io = req.app.get('io');
        if (type === 'SOS') {
          // Send SOS notifications to customer + all eligible taskers
          await notifySosRequestToTaskers(io, {
            booking_id: bookingId,
            customer_id,
            variant_id,
            service_id,
            location,
          });
        } else {
          // Standard booking flow notifications
          await notifyBookingEvent(io, {
            action: 'created',
            booking_id: bookingId,
            customer_id,
            tasker_id,
            service_name: undefined,
          });
          // If booking is assigned to a specific tasker, notify them too
          if (tasker_id) {
            await notifyBookingEvent(io, {
              action: 'created_tasker',
              booking_id: bookingId,
              customer_id,
              tasker_id,
            });
          }
        }
      } catch (e) {
        console.warn('[Booking][notify created] skipped:', e?.message || e);
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
    console.log("📥 [API] getBookingById CALLED");
    console.log("📥 [API] params.id =", req.params.id);

    const bookingId = req.params.id;

    try {
      const pool = await getPool();

      // 1) Booking + Service + Variant + Task
      const bookingResult = await pool.request()
        .input("bookingId", sql.Int, bookingId)
        .query(`
        SELECT 
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
          b.type,
          b.shared,
          b.base_price,
          b.surcharge,
          b.final_price,
          b.expected_price,
          b.paid_amount,
          b.used_voucher_id,


          b.quantity,
          b.total_sessions,
          b.description,

          /* SERVICE */
          COALESCE(s.name, '') AS service_name,
          COALESCE(s.description, '') AS service_description,

          /* VARIANT */
          COALESCE(v.variant_name, '') AS variant_name,
          COALESCE(v.pricing_type, '') AS pricing_type,
          v.price_min,
          v.price_max,
          COALESCE(v.unit, '') AS unit,

          /* TASK */
          ts.task_id, /* ADDED task_id */
          COALESCE(ts.description, '') AS task_description,
          COALESCE(ts.checklist, '') AS task_checklist,
          COALESCE(ts.completed, 0) AS task_completed,
          ts.checklist_timers AS checklist_timers,

          /* CUSTOMER INFO */
          u.name AS customer_name,
          u.phone AS customer_phone,
          u.email AS customer_email

        FROM Bookings b
        LEFT JOIN Users u ON b.customer_id = u.user_id
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants v ON b.variant_id = v.variant_id
        LEFT JOIN Tasks ts ON b.booking_id = ts.booking_id
        WHERE b.booking_id = @bookingId
      `);

      const booking = bookingResult.recordset[0];
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      console.log("🟩 [API] booking row:", JSON.stringify(booking, null, 2));

      /* 🟦 THÊM NGAY TẠI ĐÂY — SAU KHI LẤY BOOKING TỪ DB */
      if (booking.checklist_timers) {
        try {
          booking.checklist_timers = JSON.parse(booking.checklist_timers);
        } catch (err) {
          console.error("JSON parse failed:", err);
          booking.checklist_timers = {};
        }
      } else {
        booking.checklist_timers = {};
      }

      // 2) Photos (before/after)
      const photos = await pool.request()
        .input("bookingId", sql.Int, bookingId)
        .query(`
        SELECT photo_url, photo_type
        FROM TaskPhotos
        WHERE booking_id = @bookingId
      `);

      console.log("🟨 [API] photos raw:", photos.recordset);

      const before_photos = photos.recordset
        .filter(p => p.photo_type === "before")
        .map(p => p.photo_url);

      const after_photos = photos.recordset
        .filter(p => p.photo_type === "after")
        .map(p => p.photo_url);

      console.log("🟨 [API] before_photos:", before_photos);
      console.log("🟨 [API] after_photos:", after_photos);

      const responsePayload = {
        ...booking,
        before_photos,
        after_photos,
      };
      console.log("🟦 [API] response payload keys:", Object.keys(responsePayload));
      console.log("🟦 [API] response payload:", JSON.stringify(responsePayload, null, 2));

      return res.json(responsePayload);


    } catch (error) {
      console.error("❌ Lỗi getBookingById:", error);
      return res.status(500).json({ message: "Internal server error", error });
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

          b.quantity,
          b.total_sessions,
          b.description,
          t.status AS tasker_status,
          t.rating AS tasker_rating,
          s.name AS service_name,
          v.variant_name, v.pricing_type, v.unit, v.price_min, v.price_max,
          uc.name AS customer_name, uc.email AS customer_email, uc.phone AS customer_phone,
          ut.name AS tasker_name, ut.email AS tasker_email, ut.phone AS tasker_phone,
          tk.task_id,
          tk.description AS task_description,
          tk.checklist AS task_checklist,
          tk.photos AS task_photos
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

      const booking = result.recordset[0];
      const userId = req.user.userId;

      // 🛡️ SECURITY CHECK 🛡️
      const isOwner = booking.tasker_id === userId || booking.customer_id === userId;
      // SOS jobs in "Chờ xử lý" with no tasker assigned are public to taskers
      const isAvailableSOS = booking.type === 'SOS' && booking.status === 'Chờ xử lý' && booking.tasker_id === null;

      if (!isOwner && !isAvailableSOS) {
        if (booking.type === 'SOS' && booking.tasker_id && booking.tasker_id !== userId) {
          return res.status(403).json({
            success: false,
            message: "Rất tiếc, đơn SOS này đã được người khác nhận.",
            code: "SOS_TAKEN"
          });
        }
        return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập booking này" });
      }

      res.json({
        success: true,
        booking: booking,
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

  static async updateStatusSOS(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // If a tasker accepts a booking (Đã chấp nhận) and booking.tasker_id is NULL,
      // set the tasker_id to the current authenticated user.
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      console.log(`[BOOKING] updateStatusSOS called - booking_id: ${id}, status: ${status}, tasker_id: ${userId}`);

      if (status === 'Hủy') {
        // Check if it's an SOS pending job
        const checkRes = await executeQuery(`SELECT type, status, tasker_id FROM Bookings WHERE booking_id = @id`, { id });
        const b = checkRes.recordset[0];
        if (b && b.type === 'SOS' && b.status === 'Chờ xử lý' && !b.tasker_id) {
          // Tasker từ chối nhận đơn SOS -> Không làm gì cả vào DB, chỉ trả về success để FE quay về
          return res.json({ success: true, message: "Đã từ chối đơn SOS (ẩn khỏi danh sách)" });
        }
      }

      const query = `
        BEGIN TRAN;
        DECLARE @updated TABLE (booking_id INT);

        IF @status = N'Đã chấp nhận'
        BEGIN
          UPDATE Bookings
          SET tasker_id = CASE WHEN tasker_id IS NULL THEN @userId ELSE tasker_id END,
              status = @status
          OUTPUT INSERTED.booking_id INTO @updated
          WHERE booking_id = @id 
            AND type = N'SOS'
            AND tasker_id IS NULL 
            AND status = N'Chờ xử lý';
        END
        ELSE
        BEGIN
          UPDATE Bookings 
          SET status = @status 
          OUTPUT INSERTED.booking_id INTO @updated
          WHERE booking_id = @id AND tasker_id = @userId;
        END

        SELECT COUNT(*) as count FROM @updated;
        COMMIT;
      `;

      const result = await executeQuery(query, { id, status, userId });

      if (result.recordset[0].count === 0) {
        return res.status(400).json({
          success: false,
          message: status === 'Đã chấp nhận'
            ? "Rất tiếc, đơn này đã được người khác nhận hoặc không còn khả dụng."
            : "Bạn không có quyền cập nhật đơn này."
        });
      }
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

      res.json({ success: true, message: `Cập nhật trạng thái: ${status}` });
    } catch (error) {
      console.error("❌ Lỗi updateStatusSOS:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const userId = req.user.userId;

      const result = await executeQuery(
        `UPDATE Bookings SET status = @status WHERE booking_id = @id AND tasker_id = @userId`,
        { id, status, userId }
      );

      if (result.rowsAffected[0] === 0) {
        return res.status(403).json({ success: false, message: "Bạn không có quyền cập nhật booking này." });
      }

      const bookingRes = await executeQuery(
        `SELECT tasker_id, customer_id, expected_price, final_price 
          FROM Bookings 
          WHERE booking_id = @param1`,
        [id]
      );

      const booking = bookingRes.recordset?.[0];

      if (booking) {
        if (status === "Hoàn thành" || status === "Completed") {

          console.log(`🎉 Cộng +5 điểm cho tasker ${booking.tasker_id}`);
          await updateReliabilityScore(booking.tasker_id, +5);

          // ⭐ Lấy giá để trả cho tasker
          const priceRes = await executeQuery(
            `SELECT expected_price, final_price 
            FROM Bookings 
            WHERE booking_id = @param1`,
            [id]
          );

          const { expected_price, final_price } = priceRes.recordset[0];

          // Giá gốc tasker lẽ ra nhận
          const rawAmount = final_price && final_price > 0
            ? final_price
            : expected_price;

          // ❗ Trừ phí hệ thống 10%
          const payoutAmount = rawAmount * 0.9;

          console.log(`💰 Tasker ${booking.tasker_id} được nhận:`, payoutAmount);

          // ⭐ Ghi transaction credit cho tasker
          await executeQuery(
            `INSERT INTO WalletTransactions 
              (user_id, amount, type, purpose, related_id, note, created_at)
            VALUES 
              (@user_id, @amount, 'credit', 'tasker_payout', @booking_id, 
              N'Thanh toán cho tasker sau khi hoàn thành', SYSUTCDATETIME())`,
            {
              user_id: booking.tasker_id,
              amount: payoutAmount,
              booking_id: id,
            }
          );

          console.log("💸 Đã ghi credit vào WalletTransactions!");

          try {
            const customerRes = await executeQuery(
              `SELECT user_id, role, points 
                FROM Users 
                WHERE user_id = @customer_id`,
              { customer_id: booking.customer_id }
            );

            const customer = customerRes.recordset?.[0];

            const role = (customer?.role || "").trim().toLowerCase();

            if (role === "customer") {
              await executeQuery(
                `UPDATE Users SET points = points + 10 WHERE user_id = @customer_id`,
                { customer_id: customer.user_id }
              );
              console.log(`🎉 +10 points cho khách ${customer.user_id}`);
            } else {
              console.log(`⛔ Không cộng điểm vì role = '${customer.role}'`);
            }
          } catch (e) {
            console.error("❌ Lỗi cộng điểm:", e);
          }
        }
      }

      res.json({ success: true, message: `Cập nhật trạng thái: ${status}` });

      // Fire notifications based on status transitions (non-blocking)
      try {
        const io = req.app.get('io');
        const map = {
          'Đã chấp nhận': 'accepted',
          'Đang tiến hành': 'started',
          'Hoàn thành': 'completed',
        };
        const action = map[status];
        if (action && booking) {
          await notifyBookingEvent(io, {
            action,
            booking_id: Number(id),
            customer_id: booking.customer_id,
            tasker_id: booking.tasker_id,
          });
        }
      } catch (e) {
        console.warn('[Booking][notify status] skipped:', e?.message || e);
      }
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
          b.booking_time,
          b.final_price,
          b.quantity,
          b.paid_amount,
          b.description,
          sv.unit AS pricing_type
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
          "Pending Confirmation": "Chờ xác nhận",
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

      query += " ORDER BY b.booking_id DESC";

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
      const id = parseInt(req.params.id, 10);  // FE dùng :id
      if (!id) {
        return res.status(400).json({ success: false, message: "bookingId không hợp lệ" });
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
            b.expected_price,
            b.quantity,
            b.total_sessions,
            b.description,
            sv.unit,
            sv.price_min,
            sv.price_max,
            s.name AS service_name,
            sv.variant_name,
            uc.name AS customer_name,
            ut.name AS tasker_name,
            tk.description AS task_description,
            tk.checklist AS task_checklist,
            tk.photos AS task_photos
          FROM Bookings b
          LEFT JOIN Services s ON b.service_id = s.service_id
          LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
          LEFT JOIN Users uc ON uc.user_id = b.customer_id
          LEFT JOIN Users ut ON ut.user_id = b.tasker_id
          LEFT JOIN Tasks tk ON tk.booking_id = b.booking_id
          WHERE b.booking_id = @param1
        `,
        [id]
      );

      const booking = detailsRes.recordset?.[0];

      console.log("🔍 [getBookingDetails] DB Result:", booking);

      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      const userId = req.user.userId;

      if (
        String(booking.customer_id) !== String(userId) &&
        String(booking.tasker_id) !== String(userId)
      ) {
        return res.status(403).json({ success: false, message: "Không có quyền xem booking này" });
      }

      // FE yêu cầu phải trả "booking"
      return res.json({ success: true, booking });

    } catch (error) {
      console.error("❌ Error:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
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
          b.quantity,
          b.total_sessions,
          b.paid_amount,
          b.description,
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
        OUTER APPLY (
            SELECT TOP 1 description, checklist 
            FROM Tasks 
            WHERE booking_id = b.booking_id
        ) t
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
          "Pending Confirmation": "Chờ xác nhận",
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

      query += " ORDER BY b.booking_id DESC";

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
          b.total_sessions,
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
        OUTER APPLY (
            SELECT TOP 1 description, checklist 
            FROM Tasks 
            WHERE booking_id = b.booking_id
        ) t
        WHERE b.type = N'SOS'
          AND b.status = N'Chờ xử lý'
          AND b.sos_expires_at > GETDATE()
          AND EXISTS (
            SELECT 1 FROM TaskerServiceVariants tsv 
            JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
            WHERE tsv.tasker_id = @taskerId 
            AND sv.service_id = b.service_id
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

  // ============================================
  // 7️⃣ Tasker overview stats (bookings + earnings)
  // ============================================
  static async getTaskerStats(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      // Booking counts by status for this tasker
      const statusRes = await executeQuery(
        `SELECT status, COUNT(*) AS count
         FROM Bookings
         WHERE tasker_id = @taskerId
         GROUP BY status`,
        { taskerId }
      );

      const statusCountsRaw = statusRes.recordset || [];
      const statusMap = {
        pending: ['Pending', 'Chờ xử lý'],
        accepted: ['Accepted', 'Đã chấp nhận'],
        in_progress: ['In Progress', 'Đang tiến hành'],
        completed: ['Completed', 'Hoàn thành'],
        cancelled: ['Cancelled', 'Hủy'],
        complaint_processing: ['Xử lí khiếu nại của khách'],
      };

      const by_status = Object.fromEntries(
        Object.keys(statusMap).map(k => [k, 0])
      );

      for (const row of statusCountsRaw) {
        const s = (row.status || '').trim();
        for (const [key, values] of Object.entries(statusMap)) {
          if (values.includes(s)) {
            by_status[key] += row.count;
            break;
          }
        }
      }

      const totalsRes = await executeQuery(
        `SELECT COUNT(*) AS total
         FROM Bookings
         WHERE tasker_id = @taskerId`,
        { taskerId }
      );
      const total_bookings = totalsRes.recordset?.[0]?.total || 0;

      // Completed this month (based on end_time or booking_time if end_time null)
      const completedMonthRes = await executeQuery(
        `SELECT COUNT(*) AS count
         FROM Bookings
         WHERE tasker_id = @taskerId
           AND (status = N'Hoàn thành' OR status = 'Completed')
           AND YEAR(ISNULL(end_time, booking_time)) = YEAR(GETDATE())
           AND MONTH(ISNULL(end_time, booking_time)) = MONTH(GETDATE())`,
        { taskerId }
      );
      const completed_this_month = completedMonthRes.recordset?.[0]?.count || 0;

      // Earnings: sum WalletTransactions where user_id = tasker and type in ('credit','payout')
    const earningsTotalRes = await executeQuery(
      `
      SELECT
        ISNULL(SUM(b.expected_price * 0.9), 0) AS total
      FROM Bookings b
      WHERE b.tasker_id = @taskerId
        AND b.status IN (N'Hoàn thành','Completed')
      `,
      { taskerId }
    );

    const earnings_total = earningsTotalRes.recordset?.[0]?.total || 0;

    const earningsMonthRes = await executeQuery(
      `
      SELECT
        ISNULL(SUM(expected_price * 0.9), 0) AS total
      FROM Bookings
      WHERE tasker_id = @taskerId
        AND status IN (N'Hoàn thành','Completed')
        AND YEAR(end_time) = YEAR(GETDATE())
        AND MONTH(end_time) = MONTH(GETDATE())
      `,
      { taskerId }
    );

    const earnings_this_month = earningsMonthRes.recordset?.[0]?.total || 0;

      // Average rating for tasker (if Ratings table exists)
      let rating_avg = null;
      try {
        const ratingRes = await executeQuery(
          `SELECT AVG(CAST(rating AS FLOAT)) AS avg_rating
           FROM Ratings
           WHERE reviewee_id = @taskerId`,
          { taskerId }
        );
        rating_avg = ratingRes.recordset?.[0]?.avg_rating ?? null;
      } catch (_) { /* ratings table may not exist */ }

      // Recent bookings for quick glance
      const recentRes = await executeQuery(
        `SELECT TOP 5 booking_id, status, service_id, variant_id,
                ISNULL(start_time, booking_time) AS time,
                expected_price, final_price
         FROM Bookings
         WHERE tasker_id = @taskerId
         ORDER BY ISNULL(start_time, booking_time) DESC`,
        { taskerId }
      );

      return res.json({
        success: true,
        data: {
          total_bookings,
          by_status,
          completed_this_month,
          earnings_total,
          earnings_this_month,
          rating_avg,
          recent_bookings: recentRes.recordset || []
        }
      });
    } catch (error) {
      console.error("❌ Error getTaskerStats:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }

static async getTaskerEarningsSeries(req, res) {
  try {
    const taskerId = req.user?.userId;
    if (!taskerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const granularity = (req.query.granularity || 'month').toLowerCase();
    const periods = Math.max(1, Math.min(24, parseInt(req.query.periods || '6', 10)));

    // Time column to use
    const timeCol = 'ISNULL(end_time, start_time)';

    let dateFilter = `${timeCol} >= DATEADD(month, -@periods, GETDATE())`;
    if (granularity === 'week') {
      dateFilter = `${timeCol} >= DATEADD(week, -@periods, GETDATE())`;
    }
    if (granularity === 'quarter') {
      dateFilter = `${timeCol} >= DATEADD(quarter, -@periods, GETDATE())`;
    }

    let sql = '';

    if (granularity === 'week') {
      sql = `
        WITH G AS (
          SELECT
            YEAR(${timeCol}) AS y,
            DATEPART(ISO_WEEK, ${timeCol}) AS x,
            SUM(expected_price * 0.9) AS total
          FROM Bookings
          WHERE tasker_id = @taskerId
            AND status IN (N'Hoàn thành','Completed')
            AND ${dateFilter}
          GROUP BY
            YEAR(${timeCol}),
            DATEPART(ISO_WEEK, ${timeCol})
        )
        SELECT
          CONCAT(y, '-W', RIGHT('0'+CAST(x AS varchar(2)),2)) AS label,
          total
        FROM G
        ORDER BY y ASC, x ASC
      `;
    } else if (granularity === 'quarter') {
      sql = `
        WITH G AS (
          SELECT
            YEAR(${timeCol}) AS y,
            DATEPART(QUARTER, ${timeCol}) AS x,
            SUM(expected_price * 0.9) AS total
          FROM Bookings
          WHERE tasker_id = @taskerId
            AND status IN (N'Hoàn thành','Completed')
            AND ${dateFilter}
          GROUP BY
            YEAR(${timeCol}),
            DATEPART(QUARTER, ${timeCol})
        )
        SELECT
          CONCAT(y, '-Q', x) AS label,
          total
        FROM G
        ORDER BY y ASC, x ASC
      `;
    } else {
      // month (default)
      sql = `
        WITH G AS (
          SELECT
            YEAR(${timeCol}) AS y,
            MONTH(${timeCol}) AS x,
            SUM(expected_price * 0.9) AS total
          FROM Bookings
          WHERE tasker_id = @taskerId
            AND status IN (N'Hoàn thành','Completed')
            AND ${dateFilter}
          GROUP BY
            YEAR(${timeCol}),
            MONTH(${timeCol})
        )
        SELECT
          CONCAT(y, '-', RIGHT('0'+CAST(x AS varchar(2)),2)) AS label,
          total
        FROM G
        ORDER BY y ASC, x ASC
      `;
    }

    const result = await executeQuery(sql, { taskerId, periods });
    return res.json({ success: true, data: result.recordset || [] });
  } catch (err) {
    console.error('❌ getTaskerEarningsSeries:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

  // Bookings by month: completed vs pending-like
  static async getTaskerBookingsMonthly(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const months = Math.max(1, Math.min(24, parseInt(req.query.months || '6', 10)));

      const sql = `
        WITH filtered AS (
          SELECT YEAR(ISNULL(start_time, booking_time)) AS y,
                 MONTH(ISNULL(start_time, booking_time)) AS m,
                 status
          FROM Bookings
          WHERE tasker_id = @taskerId
            AND ISNULL(start_time, booking_time) >= DATEADD(month, -@months, GETDATE())
        )
        SELECT CONCAT(y,'-',RIGHT('0'+CAST(m as varchar(2)),2)) AS label,
               SUM(CASE WHEN status IN (N'Hoàn thành','Completed') THEN 1 ELSE 0 END) AS completed,
               SUM(
                  CASE WHEN status IN (
                    N'Chờ xử lý','Pending',
                    N'Đã chấp nhận','Accepted',
                    N'Đang tiến hành','In Progress',
                    N'Hủy','Cancelled','Canceled'
                  )
        THEN 1 ELSE 0 END) AS pending
        FROM filtered
        GROUP BY y, m
        ORDER BY y ASC, m ASC
      `;

      const result = await executeQuery(sql, { taskerId, months });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (err) {
      console.error('❌ getTaskerBookingsMonthly:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Success vs cancel ratio
  static async getTaskerSuccessCancel(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const months = Math.max(1, Math.min(24, parseInt(req.query.months || '6', 10)));

      const sql = `
        SELECT 
          SUM(CASE WHEN status IN (N'Hoàn thành','Completed') THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status IN (N'Hủy','Cancelled') THEN 1 ELSE 0 END) AS cancelled
        FROM Bookings
        WHERE tasker_id = @taskerId
          AND ISNULL(start_time, booking_time) >= DATEADD(month, -@months, GETDATE())
      `;

      const r = await executeQuery(sql, { taskerId, months });
      const row = r.recordset?.[0] || { completed: 0, cancelled: 0 };
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('❌ getTaskerSuccessCancel:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Upcoming within next N days and in-progress today
  static async getTaskerUpcoming(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const days = Math.max(1, Math.min(30, parseInt(req.query.days || '7', 10)));

      const sql = `
        SELECT TOP 20 b.booking_id, b.status, b.start_time, b.end_time, b.location,
               s.name AS service_name, sv.variant_name
        FROM Bookings b
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        WHERE b.tasker_id = @taskerId
          AND (
            (b.status IN (N'Đã chấp nhận','Accepted') AND b.start_time BETWEEN GETDATE() AND DATEADD(day, @days, GETDATE()))
            OR (b.status IN (N'Đang tiến hành','In Progress'))
          )
        ORDER BY ISNULL(b.start_time, b.booking_time) ASC
      `;

      const result = await executeQuery(sql, { taskerId, days });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (err) {
      console.error('❌ getTaskerUpcoming:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Overdue: end_time has passed and not completed/cancelled
  static async getTaskerOverdue(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const sql = `
        SELECT TOP 20 b.booking_id, b.status, b.start_time, b.end_time, b.location,
               s.name AS service_name, sv.variant_name
        FROM Bookings b
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        WHERE b.tasker_id = @taskerId
          AND b.end_time IS NOT NULL
          AND b.end_time < GETDATE()
          AND b.status NOT IN (N'Hoàn thành','Completed', N'Hủy','Cancelled')
        ORDER BY b.end_time DESC
      `;
      const result = await executeQuery(sql, { taskerId });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (err) {
      console.error('❌ getTaskerOverdue:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Recent reviews for the tasker
  static async getTaskerRecentReviews(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const limit = Math.max(1, Math.min(20, parseInt(req.query.limit || '5', 10)));

      const sql = `
        SELECT TOP (@limit) r.rating_id, r.booking_id, r.rating, r.comment, r.created_at,
               u.user_id AS customer_id, u.name AS customer_name
        FROM Ratings r
        LEFT JOIN Users u ON u.user_id = r.reviewer_id
        WHERE r.reviewee_id = @taskerId
        ORDER BY r.created_at DESC
      `;
      const result = await executeQuery(sql, { taskerId, limit });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (err) {
      console.error('❌ getTaskerRecentReviews:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // By service/variant: bookings and earnings
  static async getTaskerByService(req, res) {
    try {
      const taskerId = req.user?.userId;
      if (!taskerId) return res.status(401).json({ success: false, message: 'Unauthorized' });
      const months = Math.max(1, Math.min(24, parseInt(req.query.months || '6', 10)));

      const sql = `
        WITH B AS (
          SELECT b.booking_id, b.service_id, b.variant_id,
                 b.booking_time
          FROM Bookings b
          WHERE b.tasker_id = @taskerId
            AND b.booking_time >= DATEADD(month, -@months, GETDATE())
        ),
        W AS (
          SELECT related_id AS booking_id, SUM(amount) AS earnings
          FROM WalletTransactions
          WHERE user_id = @taskerId
            AND (type = 'credit' OR type = 'payout')
            AND created_at >= DATEADD(month, -@months, GETDATE())
          GROUP BY related_id
        )
        SELECT s.service_id, s.name AS service_name,
               sv.variant_id, sv.variant_name,
               COUNT(B.booking_id) AS bookings,
               ISNULL(SUM(W.earnings), 0) AS earnings
        FROM B
        LEFT JOIN W ON W.booking_id = B.booking_id
        LEFT JOIN Services s ON s.service_id = B.service_id
        LEFT JOIN ServiceVariants sv ON sv.variant_id = B.variant_id
        GROUP BY s.service_id, s.name, sv.variant_id, sv.variant_name
        ORDER BY earnings DESC
      `;

      const result = await executeQuery(sql, { taskerId, months });
      return res.json({ success: true, data: result.recordset || [] });
    } catch (err) {
      console.error('❌ getTaskerByService:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async updateNotes(req, res) {
    try {
      const id = req.params.id;
      const { notes } = req.body || {};

      if (typeof notes === "undefined") {
        return res.status(400).json({ success: false, message: "Missing notes" });
      }

      // Bookings table does not have 'notes' column, so we update Tasks.
      // Note: this updates notes for ALL tasks of the booking if invoked this way.
      await executeQuery(
        `UPDATE Tasks SET notes = @param1 WHERE booking_id = @param2`,
        [notes, id]
      );

      return res.json({ success: true, message: "Notes updated" });
    } catch (error) {
      console.error("❌ Error updateNotes:", error);
      return res.status(500).json({ success: false, message: "Failed to update notes" });
    }
  }

  static async submitComplaint(req, res) {
    console.log("==============================================");
    console.log("[Complaint][submit] START");

    const bookingId = parseInt(req.params.id, 10);
    const customerId = req.user?.userId;

    const type = (req.body?.type || "").trim();
    const description = (req.body?.description || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];

    console.log("[Complaint][submit] bookingId:", bookingId);
    console.log("[Complaint][submit] customerId:", customerId);
    console.log("[Complaint][submit] type:", type);
    console.log("[Complaint][submit] description:", description);
    console.log("[Complaint][submit] filesCount:", files.length);

    try {
      // Validate input
      if (!bookingId || !customerId) {
        console.log("[Complaint][submit] ERROR: Missing IDs");
        return res.status(400).json({ success: false, message: "Thiếu bookingId hoặc customerId" });
      }

      if (!type || !description) {
        console.log("[Complaint][submit] ERROR: Missing type/description");
        return res.status(400).json({ success: false, message: "Thiếu type hoặc description" });
      }

      // Validate theo rule loại khiếu nại
      if (type === "not_quality" && files.length === 0) {
        console.log("[Complaint][submit] ERROR: not_quality requires images");
        return res.status(400).json({
          success: false,
          message: "Loại 'Công việc không đạt yêu cầu' bắt buộc phải có ảnh"
        });
      }

      // Check booking thuộc về customer
      const owns = await executeQuery(
        "SELECT booking_id, customer_id FROM Bookings WHERE booking_id = @param1",
        [bookingId]
      );

      if (!owns.recordset.length) {
        console.log("[Complaint][submit] ERROR: Booking not found");
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      const owner = owns.recordset[0];

      if (String(owner.customer_id) !== String(customerId)) {
        console.log("[Complaint][submit] ERROR: User not owner");
        return res.status(403).json({ success: false, message: "Không có quyền khiếu nại booking này" });
      }

      // --------------------------------------------
      // UPLOAD ẢNH QUA SHARP + CLOUDINARY
      // --------------------------------------------
      let imageUrls = [];

      if (files.length > 0) {
        console.log("[Complaint][submit] Processing images with Sharp...");

        const folderBase = process.env.CLOUDINARY_FOLDER_BASE || "homehelper";
        const folder = `${folderBase}/complaints/${bookingId}`;

        for (const file of files) {
          try {
            console.log("[Complaint][submit] -> Resizing:", file.originalname);

            const resizedBuffer = await sharp(file.buffer)
              .resize({ width: 1600 })
              .jpeg({ quality: 80 })
              .toBuffer();

            console.log("[Complaint][submit] -> Uploading:", file.originalname);

            const uploadResult = await new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                { folder, resource_type: "image" },
                (err, result) => {
                  if (err) {
                    console.log("[Complaint][submit] Upload ERROR:", err);
                    return reject(err);
                  }
                  resolve(result);
                }
              );
              stream.end(resizedBuffer);
            });

            imageUrls.push(uploadResult.secure_url);
          } catch (err) {
            console.log("[Complaint][submit] Image process ERROR:", err);
            return res.status(400).json({
              success: false,
              message: "Lỗi xử lý ảnh",
              error: err.message
            });
          }
        }

        console.log("[Complaint][submit] Uploaded URLs:", imageUrls);
      }

      // --------------------------------------------
      // INSERT COMPLAINT
      // --------------------------------------------
      console.log("[Complaint][submit] Inserting complaint into database...");

      const insertSql = `
      INSERT INTO CustomerComplaint (booking_id, customer_id, type, description, image_urls, status)
      OUTPUT inserted.complaint_id, inserted.created_at
      VALUES (@param1, @param2, @param3, @param4, @param5, @param6)
    `;

      const insertRes = await executeQuery(insertSql, [
        bookingId,
        customerId,
        type,
        description,
        imageUrls.length ? JSON.stringify(imageUrls) : null,
        "pending"
      ]);

      const complaintId = insertRes.recordset[0].complaint_id;

      console.log("[Complaint][submit] Insert OK complaint_id:", complaintId);

      // --------------------------------------------
      // UPDATE BOOKING STATUS
      // --------------------------------------------
      console.log("[Complaint][submit] Updating booking status...");

      await executeQuery(
        "UPDATE Bookings SET status = N'Xử lí khiếu nại của khách' WHERE booking_id = @param1",
        [bookingId]
      );

      console.log("[Complaint][submit] Status updated → Xử lí khiếu nại của khách");
      console.log("[Complaint][submit] DONE");
      console.log("==============================================");

      return res.json({
        success: true,
        message: "Gửi khiếu nại thành công",
        data: {
          complaint_id: complaintId,
          booking_id: bookingId,
          type,
          description,
          image_urls: imageUrls,
          complaint_status: "pending",
          booking_status: "Xử lí khiếu nại của khách"
        }
      });
    } catch (error) {
      console.log("[Complaint][submit] ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Gửi khiếu nại thất bại",
        error: error.message
      });
    }
  }

  static async getAdminReview(req, res) {
    console.log("==============================================");
    console.log("[AdminReview][get] START");

    const bookingId = parseInt(req.params.id, 10);
    console.log("[AdminReview][get] bookingId:", bookingId);

    try {
      if (!bookingId) {
        console.log("[AdminReview][get] ERROR: Missing bookingId");
        return res.status(400).json({ success: false, message: "Thiếu bookingId" });
      }

      // Lấy booking + job done info
      const bookingRes = await executeQuery(
        `SELECT 
          b.booking_id,
          b.customer_id,
          b.tasker_id,
          b.status,
          b.booking_time,
          b.start_time,
          b.end_time,
          b.location,
          b.type,
          b.expected_price,
          b.base_price,
          b.final_price,
          b.paid_amount,
          b.quantity,
          b.description,
          b.total_sessions,
          s.name AS service_name,
          v.variant_name,
          v.unit
        FROM Bookings b
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants v ON b.variant_id = v.variant_id
        WHERE b.booking_id = @param1`,
        [bookingId]
      );

      if (!bookingRes.recordset.length) {
        console.log("[AdminReview][get] ERROR: Booking not found");
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      const booking = bookingRes.recordset[0];
      console.log("[AdminReview][get] Booking found");

      const photoRes = await executeQuery(
        `SELECT photo_url, photo_type 
        FROM TaskPhotos 
        WHERE booking_id = @param1`,
        [bookingId]
      );

      // 1. Fetch sessions from Tasks table
      const tasksQuery = `
        SELECT 
          task_id, booking_id, description, checklist, photos, completed, 
          created_at, checklist_timers, session_number, session_date, 
          checkin_time, checkout_time, status, notes
        FROM Tasks
        WHERE booking_id = @param1
        ORDER BY session_number ASC, session_date ASC
      `;
      const tasksResult = await executeQuery(tasksQuery, [bookingId]);
      const sessionRows = tasksResult.recordset || [];

      // 2. Fetch photos from TaskPhotos table
      const photosQuery = `
        SELECT photo_id, booking_id, photo_url, photo_type, 
               uploaded_by, uploaded_at, session_id
        FROM TaskPhotos
        WHERE booking_id = @param1
      `;
      const photosResult = await executeQuery(photosQuery, [bookingId]);
      const allPhotos = photosResult.recordset || [];

      // 3. Map photos to sessions
      const tasks = sessionRows.map(session => {
        // Parse checklist if needed
        let checklistMapped = [];
        try {
          if (typeof session.checklist === 'string' && session.checklist.trim()) {
            if (session.checklist.startsWith('[') || session.checklist.startsWith('{')) {
              const parsed = JSON.parse(session.checklist);
              checklistMapped = Array.isArray(parsed) ? parsed : [];
            } else {
              checklistMapped = session.checklist.split('\n').map(l => l.trim()).filter(Boolean);
            }
          } else if (Array.isArray(session.checklist)) {
            checklistMapped = session.checklist;
          }
        } catch (e) {
          console.warn("Parse checklist error in getAdminReview", e);
        }

        // Parse checklist_timers if needed
        let timersParsed = {};
        try {
          if (typeof session.checklist_timers === 'string') {
            timersParsed = JSON.parse(session.checklist_timers);
          } else if (session.checklist_timers) {
            timersParsed = session.checklist_timers;
          }
        } catch (e) { }

        // Find photos for this session
        const sessionPhotos = allPhotos.filter(p => p.session_id === session.task_id);
        const before = sessionPhotos.filter(p => p.photo_type === 'before').map(p => p.photo_url);
        const after = sessionPhotos.filter(p => p.photo_type === 'after').map(p => p.photo_url);

        return {
          ...session,
          checklist: checklistMapped,
          timers: timersParsed,
          photos: {
            before,
            after
          }
        };
      });

      // Lấy complaint tương ứng
      const complaintRes = await executeQuery(
        `SELECT complaint_id, booking_id, customer_id, type, description, image_urls, status, created_at
       FROM CustomerComplaint
       WHERE booking_id = @param1`,
        [bookingId]
      );

      const complaint = complaintRes.recordset[0] || null;
      console.log("[AdminReview][get] hasComplaint:", !!complaint);

      // Parse JSON ảnh
      if (complaint?.image_urls) {
        try {
          complaint.image_urls = JSON.parse(complaint.image_urls);
        } catch (_) { }
      }

      console.log("[AdminReview][get] DONE, total sessions:", tasks.length);
      console.log("==============================================");

      return res.json({
        success: true,
        booking,
        complaint,
        tasks
      });
    } catch (err) {
      console.log("[AdminReview][get] ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Lỗi server",
        error: err.message
      });
    }
  }

  static async getAdminList(req, res) {
    try {
      const pool = await getPool();

      const sqlQuery = `
      SELECT 
        b.booking_id,
        b.customer_id,
        c.name AS customer_name,
        b.tasker_id,
        t.name AS tasker_name,
        s.name AS service_name,
        b.booking_time,
        b.status,
        b.description
      FROM Bookings b
      LEFT JOIN Users c ON b.customer_id = c.user_id
      LEFT JOIN Users t ON b.tasker_id = t.user_id
      LEFT JOIN Services s ON b.service_id = s.service_id
      ORDER BY b.booking_id DESC
    `;

      const result = await pool.request().query(sqlQuery);

      return res.json({
        success: true,
        data: result.recordset
      });
    } catch (error) {
      console.log("[AdminList] ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi tải danh sách",
        error: error.message
      });
    }
  }

  static async adminResolveComplaint(req, res) {
    console.log("==============================================");
    console.log("[AdminReview][resolve] START");

    const bookingId = parseInt(req.params.id, 10);
    const { decision } = req.body; // "approved" | "rejected"
    const adminId = req.user?.userId;

    console.log("[AdminReview][resolve] bookingId:", bookingId);
    console.log("[AdminReview][resolve] decision:", decision);

    try {
      if (!bookingId || !decision) {
        console.log("[AdminReview][resolve] Missing inputs");
        return res.status(400).json({ success: false, message: "Thiếu bookingId hoặc decision" });
      }

      // Lấy booking + complaint
      const bookingRes = await executeQuery(
        "SELECT * FROM Bookings WHERE booking_id = @param1",
        [bookingId]
      );
      const booking = bookingRes.recordset[0];

      if (!booking) {
        console.log("[AdminReview][resolve] Booking not found");
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      const complaintRes = await executeQuery(
        "SELECT * FROM CustomerComplaint WHERE booking_id = @param1",
        [bookingId]
      );
      const complaint = complaintRes.recordset[0];

      if (!complaint) {
        console.log("[AdminReview][resolve] Complaint not found");
        return res.status(404).json({ success: false, message: "Không có khiếu nại cho booking này" });
      }

      // Rule tính tiền (đơn đã thanh toán)
      const totalPrice =
        booking.final_price && booking.final_price > 0
          ? booking.final_price
          : booking.expected_price || 0;

      // ==========================================
      // ✔ CASE 1 — APPROVED
      // ==========================================
      if (decision === "approved") {
        console.log("[AdminReview][resolve] CASE: APPROVED");

        // Trừ uy tín tasker (-30)
        await updateReliabilityScore(booking.tasker_id, -30);

        // Refund FULL cho khách (nếu đã thanh toán)
        if (totalPrice > 0) {
          await executeQuery(
            `INSERT INTO WalletTransactions 
           (user_id, amount, type, purpose, related_id, note, created_at)
           VALUES (@param1, @param2, N'refund', N'complaint_approved', @param3, N'Khiếu nại được duyệt, hoàn tiền cho khách', GETDATE())`,
            [booking.customer_id, totalPrice, bookingId]
          );
        }

        // Tặng voucher 10%
        await executeQuery(
          `INSERT INTO Vouchers 
        (user_id, type, discount, used, created_at, source_booking_id)
        VALUES (@uid, 'compensation', 0.1, 0, GETDATE(), @bid)`,
          { uid: booking.customer_id, bid: bookingId }
        );

        // Update trạng thái complaint + booking
        await executeQuery(
          "UPDATE CustomerComplaint SET status = 'approved' WHERE complaint_id = @param1",
          [complaint.complaint_id]
        );

        await executeQuery(
          "UPDATE Bookings SET status = N'Khiếu nại được duyệt' WHERE booking_id = @param1",
          [bookingId]
        );

        console.log("[AdminReview][resolve] APPROVED DONE");

        return res.json({
          success: true,
          message: "Đã duyệt khiếu nại",
          result: {
            refund: totalPrice,
            voucher: "10%",
            scoreChange: -30
          }
        });
      }

      // ==========================================
      // ✔ CASE 2 — REJECTED
      // ==========================================
      if (decision === "rejected") {
        console.log("[AdminReview][resolve] CASE: REJECTED");

        const payout = Math.round(totalPrice * 0.9); // 90% cho tasker

        // Cộng tiền cho tasker
        if (payout > 0) {
          await executeQuery(
            `INSERT INTO WalletTransactions 
          (user_id, amount, type, purpose, related_id, note, created_at)
          VALUES (@param1, @param2, N'credit', N'complaint_rejected', @param3, N'Khiếu nại bị từ chối, tasker nhận tiền', GETDATE())`,
            [booking.tasker_id, payout, bookingId]
          );
        }

        // Cộng uy tín (+5)
        await updateReliabilityScore(booking.tasker_id, +5);

        // Update complaint + booking
        await executeQuery(
          "UPDATE CustomerComplaint SET status = 'rejected' WHERE complaint_id = @param1",
          [complaint.complaint_id]
        );

        await executeQuery(
          "UPDATE Bookings SET status = N'Khiếu nại bị từ chối' WHERE booking_id = @param1",
          [bookingId]
        );

        console.log("[AdminReview][resolve] REJECTED DONE");

        return res.json({
          success: true,
          message: "Đã từ chối khiếu nại",
          result: {
            payout,
            scoreChange: +5
          }
        });
      }

      return res.status(400).json({ success: false, message: "decision không hợp lệ" });

    } catch (error) {
      console.log("[AdminReview][resolve] ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Lỗi server",
        error: error.message
      });
    }
  }

  static async completeJob(req, res) {
    console.log("====== [COMPLETE JOB] START ======");

    try {
      const bookingId = req.params.bookingId;
      const { checklist_timers, session_date, before_photos, after_photos, notes } = req.body;
      // Note: before_photos and after_photos are arrays of URLs

      console.log("📥 Incoming bookingId:", bookingId);
      console.log("📥 Incoming session_date:", session_date);
      console.log("📥 Incoming timers:", checklist_timers);

      if (!bookingId) {
        console.log("❌ Missing bookingId");
        return res.status(400).json({ message: "Missing bookingId" });
      }

      // 1. Identify the Task (Session) ID based on bookingId + session_date
      let specificTaskId = null;
      if (session_date) {

        // --- DEBUG START ---
        try {
          const allTasks = await executeQuery(
            "SELECT task_id, session_date, session_number FROM Tasks WHERE booking_id = @bid",
            { bid: bookingId }
          );
          console.log("🐛 [DEBUG] ALL TASKS for booking:", JSON.stringify(allTasks.recordset, null, 2));
          console.log("🐛 [DEBUG] Looking for session_date:", session_date);
        } catch (dbgErr) { console.warn("Debug query failed", dbgErr); }
        // --- DEBUG END ---

        const taskRes = await executeQuery(
          "SELECT task_id FROM Tasks WHERE booking_id = @bid AND CAST(session_date AS DATE) = CAST(@sDate AS DATE)",
          { bid: bookingId, sDate: session_date }
        );
        specificTaskId = taskRes.recordset?.[0]?.task_id;

        if (!specificTaskId) {
          console.warn(`⚠️ Session not found for date ${session_date} (Booking ${bookingId}). Aborting update to avoid overwriting all sessions.`);
          return res.status(404).json({ success: false, message: `Không tìm thấy phiên làm việc ngày ${session_date}` });
        }
      } else {
        // Fallback for single session or legacy: get the first task
        const taskRes = await executeQuery(
          "SELECT TOP 1 task_id FROM Tasks WHERE booking_id = @bid",
          { bid: bookingId }
        );
        specificTaskId = taskRes.recordset?.[0]?.task_id;
      }

      console.log("🆔 Resolved Task ID:", specificTaskId);

      // 2. Insert Photos into TaskPhotos table
      // TaskPhotos: [photo_id], [booking_id], [photo_url], [photo_type], [uploaded_by], [uploaded_at], [session_id] (which is task_id here?)
      // Assuming session_id in TaskPhotos refers to Tasks.task_id or Tasks.session_number? 
      // Based on usual design, let's assume it links to the Task record (task_id).

      const userId = req.user?.userId; // Tasker ID from auth token

      const insertPhoto = async (url, type) => {
        // Check if photo exists first to avoid duplicates
        const checkRes = await executeQuery(
          `SELECT photo_id FROM TaskPhotos WHERE photo_url = @url AND booking_id = @bid`,
          { url, bid: bookingId }
        );

        if (checkRes.recordset && checkRes.recordset.length > 0) {
          // Update existing record with session_id
          await executeQuery(
            `UPDATE TaskPhotos 
           SET session_id = @tid, photo_type = @type, uploaded_at = GETUTCDATE()
           WHERE photo_url = @url AND booking_id = @bid`,
            {
              tid: specificTaskId,
              type: type,
              url: url,
              bid: bookingId
            }
          );
        } else {
          // Insert new record
          await executeQuery(
            `INSERT INTO TaskPhotos (booking_id, photo_url, photo_type, uploaded_by, uploaded_at, session_id)
            VALUES (@bid, @url, @type, @uid, GETUTCDATE(), @tid)`,
            {
              bid: bookingId,
              url: url,
              type: type,
              uid: userId,
              tid: specificTaskId
            }
          );
        }
      };

      if (before_photos && Array.isArray(before_photos)) {
        for (const url of before_photos) {
          await insertPhoto(url, 'before');
        }
      }
      if (after_photos && Array.isArray(after_photos)) {
        for (const url of after_photos) {
          await insertPhoto(url, 'after');
        }
      }

      console.log("� Photos inserted into TaskPhotos table.");
      console.log(" Photos inserted into TaskPhotos table.");

      // 3. Update Tasks table (Timers, Status, Checkout Time)
      // We do NOT update 'photos' column in Tasks as per user instruction.

      if (specificTaskId) {
        await executeQuery(
          `UPDATE Tasks
           SET 
             checklist_timers = @timers,
             status = N'Hoàn thành',
             completed = 1,
             checkin_time = COALESCE(@checkIn, checkin_time),
             checkout_time = COALESCE(@checkOut, GETUTCDATE())
           WHERE task_id = @tid`,
          {
            timers: JSON.stringify(checklist_timers || {}),
            tid: specificTaskId,
            checkIn: req.body.check_in_time ? new Date(req.body.check_in_time) : null,
            checkOut: req.body.check_out_time ? new Date(req.body.check_out_time) : null
          }
        );
      } else {
        // Fallback update all if no specific task found (shouldn't happen for multi-session)
        await executeQuery(
          `UPDATE Tasks
           SET 
             checklist_timers = @timers,
             status = N'Hoàn thành',
             completed = 1,
             checkin_time = COALESCE(@checkIn, checkin_time),
             checkout_time = COALESCE(@checkOut, GETUTCDATE())
           WHERE booking_id = @bid`,
          {
            timers: JSON.stringify(checklist_timers || {}),
            bid: bookingId,
            checkIn: req.body.check_in_time ? new Date(req.body.check_in_time) : null,
            checkOut: req.body.check_out_time ? new Date(req.body.check_out_time) : null
          }
        );
      }

      // 4. Update Notes (stored in Tasks table now, as Bookings table does not have notes column)
      if (notes) {
        if (specificTaskId) {
          await executeQuery("UPDATE Tasks SET notes = @note WHERE task_id = @tid", { note: notes, tid: specificTaskId });
        } else {
          // Fallback: update all tasks for this booking if no specific task identified
          await executeQuery("UPDATE Tasks SET notes = @note WHERE booking_id = @bid", { note: notes, bid: bookingId });
        }
      }

      // 5. Check Overall Job Completion
      const checkRes = await executeQuery(
        `SELECT COUNT(*) as total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as done FROM Tasks WHERE booking_id = @bid`,
        { bid: bookingId }
      );

      const { total, done } = checkRes.recordset[0];
      console.log(`📊 Session Progress: ${done}/${total}`);

      let allDone = total > 0 && done >= total;

      if (allDone) {
        // Update Booking Status to "Chờ xác nhận"
        await executeQuery(
          "UPDATE Bookings SET status = N'Chờ xác nhận', end_time = GETUTCDATE() WHERE booking_id = @bid",
          { bid: bookingId }
        );
        console.log("🎉 All sessions done! Booking status -> Chờ xác nhận");
      }

      return res.status(200).json({
        success: true,
        message: "Session completed & Photos saved",
        allDone,
        booking_id: bookingId
      });

    } catch (err) {
      console.error("❌ COMPLETE JOB ERROR:", err);
      return res.status(500).json({
        message: "Internal server error (completeJob)",
        error: err.message
      });
    }
  };
  static async customerConfirmComplete(req, res) {
    console.log("==============================================");
    console.log("[Booking][customerConfirmComplete] START");

    const bookingId = parseInt(req.params.id, 10);
    const customerId = req.user?.userId;

    console.log("[customerConfirmComplete] bookingId:", bookingId);
    console.log("[customerConfirmComplete] customerId:", customerId);

    try {
      // Kiểm tra input
      if (!bookingId || !customerId) {
        return res.status(400).json({ success: false, message: "Thiếu bookingId hoặc customerId" });
      }

      // Lấy booking
      const bookingRes = await executeQuery(
        `SELECT booking_id, customer_id, tasker_id, expected_price, final_price 
       FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );
      const booking = bookingRes.recordset?.[0];

      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      // Kiểm tra booking có phải của customer không
      if (String(booking.customer_id) !== String(customerId)) {
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền xác nhận đơn này"
        });
      }

      // Kiểm tra đã hoàn thành chưa
      const statusRes = await executeQuery(
        `SELECT status FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );

      const currentStatus = statusRes.recordset?.[0]?.status;

      if (currentStatus === "Hoàn thành") {
        return res.json({ success: true, message: "Đơn đã ở trạng thái hoàn thành" });
      }

      // -----------------------------
      // 1️⃣ Cập nhật trạng thái booking
      // -----------------------------
      console.log("[customerConfirmComplete] Updating status to Hoàn thành");
      await executeQuery(
        `UPDATE Bookings SET status = N'Hoàn thành' WHERE booking_id = @param1`,
        [bookingId]
      );

      // -----------------------------
      // 2️⃣ Cộng +5 uy tín cho tasker
      // -----------------------------
      console.log(`🎉 +5 uy tín cho tasker ${booking.tasker_id}`);
      await updateReliabilityScore(booking.tasker_id, +5);

      // -----------------------------
      // 3️⃣ Thanh toán cho tasker (90%)
      // -----------------------------
      const rawAmount = booking.final_price && booking.final_price > 0
        ? booking.final_price
        : booking.expected_price;

      const payoutAmount = Math.round(rawAmount * 0.9);

      console.log(`💰 Tasker ${booking.tasker_id} nhận: ${payoutAmount}`);

      await executeQuery(
        `INSERT INTO WalletTransactions 
        (user_id, amount, type, purpose, related_id, note, created_at)
      VALUES 
        (@user_id, @amount, 'credit', 'tasker_payout', @booking_id, 
        N'Thanh toán cho tasker sau khi khách xác nhận', SYSUTCDATETIME())`,
        {
          user_id: booking.tasker_id,
          amount: payoutAmount,
          booking_id: bookingId
        }
      );

      // -----------------------------
      // 4️⃣ +10 loyalty points cho customer
      // -----------------------------
      console.log(`🎁 +10 điểm thưởng cho customer ${customerId}`);
      await executeQuery(
        `UPDATE Users SET points = points + 10 WHERE user_id = @param1`,
        [customerId]
      );

      // -----------------------------
      // 5️⃣ Gửi notification
      // -----------------------------
      try {
        const io = req.app.get("io");
        console.log("[customerConfirmComplete] Sending socket event completed");

        await notifyBookingEvent(io, {
          action: "completed",
          booking_id: bookingId,
          customer_id: booking.customer_id,
          tasker_id: booking.tasker_id
        });
      } catch (e) {
        console.warn("[customerConfirmComplete] Socket warn:", e?.message);
      }

      console.log("[customerConfirmComplete] DONE");
      console.log("==============================================");

      return res.json({
        success: true,
        message: "Bạn đã xác nhận hoàn thành công việc",
        payout: payoutAmount,
        score: "+5 tasker",
        customerPoints: "+10 points"
      });

    } catch (err) {
      console.error("[customerConfirmComplete] ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi xác nhận hoàn thành",
        error: err.message
      });
    }
  }


  static async customerConfirmComplete(req, res) {
    console.log("==============================================");
    console.log("[Booking][customerConfirmComplete] START");

    const bookingId = parseInt(req.params.id, 10);
    const customerId = req.user?.userId;

    console.log("[customerConfirmComplete] bookingId:", bookingId);
    console.log("[customerConfirmComplete] customerId:", customerId);

    try {
      // Kiểm tra input
      if (!bookingId || !customerId) {
        return res.status(400).json({ success: false, message: "Thiếu bookingId hoặc customerId" });
      }

      // Lấy booking
      const bookingRes = await executeQuery(
        `SELECT booking_id, customer_id, tasker_id, expected_price, final_price 
       FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );
      const booking = bookingRes.recordset?.[0];

      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      // Kiểm tra booking có phải của customer không
      if (String(booking.customer_id) !== String(customerId)) {
        return res.status(403).json({
          success: false,
          message: "Bạn không có quyền xác nhận đơn này"
        });
      }

      // Kiểm tra đã hoàn thành chưa
      const statusRes = await executeQuery(
        `SELECT status FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );

      const currentStatus = statusRes.recordset?.[0]?.status;

      if (currentStatus === "Hoàn thành") {
        return res.json({ success: true, message: "Đơn đã ở trạng thái hoàn thành" });
      }

      // -----------------------------
      // 1️⃣ Cập nhật trạng thái booking
      // -----------------------------
      console.log("[customerConfirmComplete] Updating status to Hoàn thành");
      await executeQuery(
        `UPDATE Bookings SET status = N'Hoàn thành' WHERE booking_id = @param1`,
        [bookingId]
      );

      // -----------------------------
      // 2️⃣ Cộng +5 uy tín cho tasker
      // -----------------------------
      console.log(`🎉 +5 uy tín cho tasker ${booking.tasker_id}`);
      await updateReliabilityScore(booking.tasker_id, +5);

      // -----------------------------
      // 3️⃣ Thanh toán cho tasker (90%)
      // -----------------------------
      const rawAmount = booking.final_price && booking.final_price > 0
        ? booking.final_price
        : booking.expected_price;

      const payoutAmount = Math.round(rawAmount * 0.9);

      console.log(`💰 Tasker ${booking.tasker_id} nhận: ${payoutAmount}`);

      await executeQuery(
        `INSERT INTO WalletTransactions 
        (user_id, amount, type, purpose, related_id, note, created_at)
      VALUES 
        (@user_id, @amount, 'credit', 'tasker_payout', @booking_id, 
        N'Thanh toán cho tasker sau khi khách xác nhận', SYSUTCDATETIME())`,
        {
          user_id: booking.tasker_id,
          amount: payoutAmount,
          booking_id: bookingId
        }
      );

      // -----------------------------
      // 4️⃣ +10 loyalty points cho customer
      // -----------------------------
      console.log(`🎁 +10 điểm thưởng cho customer ${customerId}`);
      await executeQuery(
        `UPDATE Users SET points = points + 10 WHERE user_id = @param1`,
        [customerId]
      );

      // -----------------------------
      // 5️⃣ Gửi notification
      // -----------------------------
      try {
        const io = req.app.get("io");
        console.log("[customerConfirmComplete] Sending socket event completed");

        await notifyBookingEvent(io, {
          action: "completed",
          booking_id: bookingId,
          customer_id: booking.customer_id,
          tasker_id: booking.tasker_id
        });
      } catch (e) {
        console.warn("[customerConfirmComplete] Socket warn:", e?.message);
      }

      console.log("[customerConfirmComplete] DONE");
      console.log("==============================================");

      return res.json({
        success: true,
        message: "Bạn đã xác nhận hoàn thành công việc",
        payout: payoutAmount,
        score: "+5 tasker",
        customerPoints: "+10 points"
      });

    } catch (err) {
      console.error("[customerConfirmComplete] ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Lỗi server khi xác nhận hoàn thành",
        error: err.message
      });
    }
  }

  // ============================================
  // 📝 Ký hợp đồng điện tử
  // ============================================
  static async signContract(req, res) {
    try {
      const bookingId = parseInt(req.params.id || req.params.bookingId, 10);
      const userId = req.user.userId;
      const { signatureUrl } = req.body;

      if (!bookingId) {
        return res.status(400).json({ success: false, message: "bookingId không hợp lệ" });
      }

      // 1. Check booking exist
      const checkRes = await executeQuery(
        `SELECT booking_id, customer_id, tasker_id, status, start_time, end_time 
         FROM Bookings WHERE booking_id = @param1`,
        [bookingId]
      );
      const booking = checkRes.recordset?.[0];

      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking không tồn tại" });
      }

      console.log(`📝 [signContract] Request for BookingID: ${bookingId}, UserID: ${userId}`);
      console.log(`   Found Booking: Status='${booking.status}', CustomerID=${booking.customer_id}`);

      if (String(booking.customer_id) !== String(userId)) {
        return res.status(403).json({ success: false, message: "Không có quyền ký hợp đồng này" });
      }

      // 2. Update status
      // Chỉ cho phép ký khi status là "Đã chấp nhận", "Accepted" hoặc "Đã ký hợp đồng" (cho phép update lại chữ ký nếu cần)
      if (booking.status !== "Đã chấp nhận" && booking.status !== "Accepted" && booking.status !== "Đã ký hợp đồng") {
        console.warn(`❌ [signContract] Invalid status: ${booking.status}`);
        return res.status(400).json({ success: false, message: `Trạng thái đơn (${booking.status}) không hợp lệ để ký hợp đồng.` });
      }

      // Update booking status
      await executeQuery(
        "UPDATE Bookings SET status = N'Đã ký hợp đồng' WHERE booking_id = @param1",
        [bookingId]
      );

      // Update Contracts table if it exists
      // We assume there's a Contracts record linked to this booking, or we find it by booking_id
      if (signatureUrl) {
        // Log để debug
        console.log(`📝 [signContract] Updating signatureUrl: ${signatureUrl}`);

        const updateRes = await executeQuery(
          `UPDATE Contracts 
             SET customer_signature_url = @url, signed_at = GETDATE(), status = N'Đã ký'
             WHERE booking_id = @id`,
          { url: signatureUrl, id: bookingId }
        );

        // Nếu không có dòng nào được update (chưa có hợp đồng), tạo mới
        if (updateRes.rowsAffected[0] === 0) {
          console.log("⚠️ No existing contract found for this booking. Creating new contract...");

          const sDate = booking.start_time || new Date();
          const eDate = booking.end_time || new Date();

          await executeQuery(
            `
              DECLARE @NewID INT;
              SELECT @NewID = ISNULL(MAX(contract_id), 0) + 1 FROM Contracts;
              
              INSERT INTO Contracts (
                  contract_id, booking_id, customer_id, tasker_id, 
                  terms, customer_signature_url, start_date, end_date, 
                  status, created_at, signed_at
              )
              VALUES (
                  @NewID, @bookingId, @customerId, @taskerId,
                  N'Điều khoản dịch vụ tiêu chuẩn (Tự động tạo)', @signatureUrl, @startDate, @endDate,
                  N'Đã ký', GETDATE(), GETDATE()
              );
            `,
            {
              bookingId,
              customerId: booking.customer_id,
              taskerId: booking.tasker_id, // Có thể null
              signatureUrl,
              startDate: sDate,
              endDate: eDate,
            }
          );
          console.log("✅ New contract created successfully.");
        }
      }

      return res.json({ success: true, message: "Đã ký hợp đồng thành công" });

    } catch (err) {
      console.error("❌ Error signing contract:", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }


  // ============================================
  // Get sessions for a booking (Customer view)
  // ============================================
  static async getBookingSessions(req, res) {
    try {
      const { id } = req.params; // bookingId
      if (!id) {
        return res.status(400).json({ success: false, message: 'Missing bookingId' });
      }

      // Optional: Check if user is allowed to view this booking (Customer of the booking or Admin)
      // For now, assuming authenticateToken is sufficient filter or frontend passes correct ID.

      // 1. Fetch sessions from Tasks table
      const tasksQuery = `
        SELECT 
          task_id, booking_id, description, checklist, photos, completed, 
          created_at, checklist_timers, session_number, session_date, 
          checkin_time, checkout_time, status, notes
        FROM Tasks
        WHERE booking_id = @param1
        ORDER BY session_number ASC, session_date ASC
      `;
      const tasksResult = await executeQuery(tasksQuery, [id]);
      const sessions = tasksResult.recordset || [];

      // 2. Fetch photos from TaskPhotos table
      const photosQuery = `
        SELECT photo_id, booking_id, photo_url, photo_type, 
               uploaded_by, uploaded_at, session_id
        FROM TaskPhotos
        WHERE booking_id = @param1
      `;
      const photosResult = await executeQuery(photosQuery, [id]);
      const photos = photosResult.recordset || [];

      // 3. Map photos to sessions
      const sessionsWithData = sessions.map(session => {
        // Parse checklist if needed
        let checklistParsed = session.checklist;
        try {
          if (typeof session.checklist === 'string') {
            checklistParsed = JSON.parse(session.checklist);
          }
        } catch (e) { }

        // Parse checklist_timers if needed
        let timersParsed = session.checklist_timers;
        try {
          if (typeof session.checklist_timers === 'string') {
            timersParsed = JSON.parse(session.checklist_timers);
          }
        } catch (e) { }

        // Find photos for this session
        const sessionPhotos = photos.filter(p => p.session_id === session.task_id);
        const before = sessionPhotos.filter(p => p.photo_type === 'before').map(p => p.photo_url);
        const after = sessionPhotos.filter(p => p.photo_type === 'after').map(p => p.photo_url);

        return {
          ...session,
          checklist: checklistParsed,
          checklist_timers: timersParsed,
          photos: {
            before,
            after
          }
        };
      });

      res.status(200).json({ success: true, data: sessionsWithData });

    } catch (error) {
      console.error("❌ Error fetching booking sessions:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
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
  updateNotes: BookingController.updateNotes,
  submitComplaint: BookingController.submitComplaint,
  getAdminReview: BookingController.getAdminReview,
  getAdminList: BookingController.getAdminList,
  adminResolveComplaint: BookingController.adminResolveComplaint,
  completeJob: BookingController.completeJob,
  customerConfirmComplete: BookingController.customerConfirmComplete,
  updateStatusSOS: BookingController.updateStatusSOS,
  getTaskerStats: BookingController.getTaskerStats
  ,getTaskerEarningsSeries: BookingController.getTaskerEarningsSeries
  ,getTaskerBookingsMonthly: BookingController.getTaskerBookingsMonthly
  ,getTaskerSuccessCancel: BookingController.getTaskerSuccessCancel
  ,getTaskerUpcoming: BookingController.getTaskerUpcoming
  ,getTaskerOverdue: BookingController.getTaskerOverdue
  ,getTaskerRecentReviews: BookingController.getTaskerRecentReviews
  ,getTaskerByService: BookingController.getTaskerByService,
  signContract: BookingController.signContract,
  getBookingSessions: BookingController.getBookingSessions, // Export the new function
};
