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
          status, expected_price, quantity, type
        )
        VALUES (
          @customer_id, @tasker_id, @service_id, @variant_id,
          GETDATE(), @start_time, @end_time, @location,
          N'Chờ xử lý', @expected_price, @quantity, @type
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
        quantity: safeQuantity,
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
          b.notes,

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

  static async updateStatusSOS(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // If a tasker accepts a booking (Đã chấp nhận) and booking.tasker_id is NULL,
      // set the tasker_id to the current authenticated user.
      const userId = req.user?.userId || null;
      console.log(`[BOOKING] updateStatusSOS called - booking_id: ${id}, status: ${status}, tasker_id: ${userId}`);

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

      await executeQuery(
        `UPDATE Bookings SET status = @status WHERE booking_id = @id`,
        { id, status }
      );

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

  static async updateNotes(req, res) {
    try {
      const id = req.params.id;
      const { notes } = req.body || {};

      if (typeof notes === "undefined") {
        return res.status(400).json({ success: false, message: "Missing notes" });
      }

      await executeQuery(
        `UPDATE Bookings SET notes = @param1 WHERE booking_id = @param2`,
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
          booking_id,
          customer_id,
          tasker_id,
          notes,
          status
        FROM Bookings
        WHERE booking_id = @param1`,
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

      const taskRes = await executeQuery(
        `SELECT task_id, description, checklist, completed, photos, checklist_timers
        FROM Tasks
        WHERE booking_id = @param1`,
        [bookingId]
      );

      const tasks = taskRes.recordset.map(t => {
        console.log("🟦 [AdminReview] RAW task row:", t);

        const raw = t.checklist || "";

        // giống TaskerJobDone: tách theo dòng
        const checklist = raw
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length > 0);

        let photos = [];
        try {
          photos = t.photos ? JSON.parse(t.photos) : [];
        } catch (_) { }

        console.log("🟦 [AdminReview] RAW checklist_timers:", t.checklist_timers);

        let timers = {};
        try {
          timers = t.checklist_timers ? JSON.parse(t.checklist_timers) : {};
        } catch (err) {
          console.log("❌ [AdminReview] ERROR parsing checklist_timers:", err);
        }

        console.log("🟩 [AdminReview] Parsed timers:", timers);

        return {
          task_id: t.task_id,
          description: t.description,
          completed: t.completed,
          checklist_raw: raw,   // giữ bản gốc
          checklist,            // FE đọc theo dòng
          photos,
          timers
        };

        console.log("🟪 [AdminReview] Final task object:", taskObj);

        return taskObj;
      });

      const before_photos = photoRes.recordset
        .filter(p => p.photo_type === "before")
        .map(p => p.photo_url);

      const after_photos = photoRes.recordset
        .filter(p => p.photo_type === "after")
        .map(p => p.photo_url);

      booking.before_photos = before_photos;
      booking.after_photos = after_photos;

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

      console.log("[AdminReview][get] DONE");
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
        b.status
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
           VALUES (@param1, @param2, N'refund', N'complaint_approved', @param3, N'Khiếu nại được duyệt', GETDATE())`,
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
          VALUES (@param1, @param2, N'payout', N'complaint_rejected', @param3, N'Khiếu nại bị từ chối', GETDATE())`,
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
      const { checklist_timers } = req.body;

      console.log("📥 Incoming bookingId:", bookingId);
      console.log("📥 Incoming timers:", checklist_timers);

      if (!bookingId) {
        console.log("❌ Missing bookingId");
        return res.status(400).json({ message: "Missing bookingId" });
      }

      // 1) SAVE CHECKLIST TIMERS → Bảng Tasks
      console.log("💾 Saving checklist timers to Tasks table...");

      await executeQuery(
        `
            UPDATE Tasks
            SET checklist_timers = @param1
            WHERE booking_id = @param2
            `,
        [JSON.stringify(checklist_timers || {}), bookingId]
      );

      console.log("✔ Saved timers successfully");

      console.log("====== [COMPLETE JOB] SUCCESS ======");
      return res.status(200).json({
        message: "Checklist timers saved",
        booking_id: bookingId,
        checklist_timers
      });

    } catch (err) {
      console.error("❌ COMPLETE JOB ERROR:", err);
      return res.status(500).json({
        message: "Internal server error (completeJob)",
        error: err.message
      });
    }
  };

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
  updateStatusSOS: BookingController.updateStatusSOS,
};
