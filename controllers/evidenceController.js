const { executeQuery } = require("../config/database");
const { cloudinary } = require("../config/cloudinary");
const { calculateRefundPolicy } = require("../services/refundPolicy.service");
const { updateReliabilityScore } = require("../services/reliabilityScore.service");

// Upload ảnh lên Cloudinary
async function uploadToCloud(file) {
  if (!file) return null;

  const result = await cloudinary.uploader.upload(file.path, {
    folder: "no_show_evidence",
  });

  return result.secure_url;
}

exports.submitNoShowEvidence = async (req, res) => {
  try {
    const { booking_id, tasker_id, note } = req.body;

    if (!booking_id || !tasker_id) {
      return res.status(400).json({
        success: false,
        message: "Thiếu booking_id hoặc tasker_id",
      });
    }

    // Upload ảnh
    const houseNumber = await uploadToCloud(req.files?.house_number?.[0]);
    const callShot = await uploadToCloud(req.files?.call_screenshot?.[0]);
    const gpsShot = await uploadToCloud(req.files?.gps_screenshot?.[0]);
    const houseFront = await uploadToCloud(req.files?.house_front?.[0]);

    // Insert database bằng executeQuery
    const insertQuery = `
      INSERT INTO EvidenceReview 
      (booking_id, tasker_id, note, house_number_img, call_screenshot_img, gps_screenshot_img, house_front_img, status)
      VALUES (@booking_id, @tasker_id, @note, @houseNumber, @callShot, @gpsShot, @houseFront, 'pending')
    `;

    await executeQuery(insertQuery, {
      booking_id,
      tasker_id,
      note: note || "",
      houseNumber,
      callShot,
      gpsShot,
      houseFront,
    });

    // 3. 🔥 UPDATE BOOKING → “Chờ duyệt báo cáo”
    const updateBooking = `
          UPDATE Bookings
          SET status = N'Chờ duyệt báo cáo'
          WHERE booking_id = @booking_id
        `;
    await executeQuery(updateBooking, { booking_id });

    res.status(201).json({
      success: true,
      message: "Gửi báo cáo thành công!",
    });

  } catch (err) {
    console.error("❌ submitNoShowEvidence:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getPendingEvidence = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM EvidenceReview
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `;

    const result = await executeQuery(query);

    res.json({
      success: true,
      data: result.recordset || [],
    });
  } catch (err) {
    console.error("❌ getPendingEvidence:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.approveEvidence = async (req, res) => {
  try {
    const { id } = req.params;
    const admin_id = req.user?.user_id;

    // 1. Lấy report theo ID
    const data = await executeQuery(`SELECT * FROM EvidenceReview WHERE id = @id`, { id });
    if (!data.recordset.length) {
      return res.json({ success: false, message: "Không tìm thấy báo cáo." });
    }
    const review = data.recordset[0];

    // Fetch booking
    const b = await executeQuery(
      `SELECT * FROM Bookings WHERE booking_id = @bid`,
      { bid: review.booking_id }
    );
    const booking = b.recordset[0];

    // --- RULE R6: Tasker nhận 100% số tiền khách đã trả (Không trừ phí hệ thống)
    const policy = calculateRefundPolicy(booking, "no_show");
    const actualPaid = Number(booking.paid_amount || 0);
    const compensationAmount = actualPaid;

    /// Update Evidence
    await executeQuery(`
      UPDATE EvidenceReview
      SET status = N'approved', admin_id=@admin_id, reviewed_at=GETDATE()
      WHERE id=@id
    `, { id, admin_id });

    // Update Booking
    await executeQuery(`
      UPDATE Bookings
      SET status = N'Báo cáo được duyệt'
      WHERE booking_id = @bid
    `, { bid: booking.booking_id });

    // Ghi log compensation (y chang cancelBooking)
    await executeQuery(`
      INSERT INTO WalletTransactions
      (user_id, amount, type, purpose, related_id, note, created_at)
      VALUES (@uid, @amount, N'compensation', N'evidence_approved', @bid, @note, GETDATE())
    `, {
      uid: booking.tasker_id,
      amount: compensationAmount,
      bid: booking.booking_id,
      note: `[${policy.ruleCode}] ${policy.note}`
    });

    res.json({
      success: true,
      message: "Đã duyệt báo cáo. Tasker nhận 100% tiền.",
      compensationAmount
    });
  } catch (err) {
    console.error("❌ approveEvidence:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.rejectEvidence = async (req, res) => {
  try {
    const { id } = req.params;
    const admin_id = req.user?.user_id;

    const data = await executeQuery(`SELECT * FROM EvidenceReview WHERE id = @id`, { id });
    if (!data.recordset.length) {
      return res.json({ success: false, message: "Không tìm thấy báo cáo." });
    }
    const review = data.recordset[0];

    const b = await executeQuery(`SELECT * FROM Bookings WHERE booking_id = @bid`, { bid: review.booking_id });
    const booking = b.recordset[0];

    const alreadyRefunded = await executeQuery(`
      SELECT TOP 1 1
      FROM WalletTransactions
      WHERE purpose = N'evidence_rejected' AND related_id = @bid
    `, { bid: booking.booking_id });

    if (alreadyRefunded.recordset.length) {
      return res.json({ success: false, message: "Booking đã được hoàn tiền do reject trước đó." });
    }

    // 🚫 Chống double theo trạng thái (query trạng thái hiện tại)
    const sttRes = await executeQuery(
      `SELECT status FROM Bookings WHERE booking_id = @bid`,
      { bid: booking.booking_id }
    );
    const currentStatus = sttRes.recordset[0]?.status;
    if (currentStatus === 'Hủy' || currentStatus === 'Báo cáo bị từ chối') {
      return res.json({ success: false, message: "Booking đã được xử lý refund trước đó." });
    }


    // --- RULE R8: Hoàn 100% số tiền khách đã trả (Sử dụng paid_amount)
    const policy = calculateRefundPolicy(booking, "evidence_rejected");
    const actualPaid = Number(booking.paid_amount || 0);
    const refundAmount = actualPaid;

    // Update evidence
    await executeQuery(`
      UPDATE EvidenceReview
      SET status = N'rejected', admin_id=@admin_id, reviewed_at=GETDATE()
      WHERE id=@id
    `, { id, admin_id });

    // Update booking
    await executeQuery(`
      UPDATE Bookings
      SET status = N'Báo cáo bị từ chối'
      WHERE booking_id=@bid
    `, { bid: booking.booking_id });

    // 3) Trả lại voucher đã dùng
    const usedVoucher = await executeQuery(`
      SELECT TOP 1 voucher_id
      FROM Vouchers
      WHERE source_booking_id = @bid AND used = 1
    `, { bid: booking.booking_id });

    if (usedVoucher.recordset.length > 0) {
      await executeQuery(`
        UPDATE Vouchers
        SET used = 0
        WHERE voucher_id = @vid
      `, { vid: usedVoucher.recordset[0].voucher_id });

      console.log("🎟️ Đã hoàn trả voucher đã sử dụng:", usedVoucher.recordset[0].voucher_id);
    }

    // Refund → customer
    await executeQuery(`
      INSERT INTO WalletTransactions 
      (user_id, amount, type, purpose, related_id, note, created_at)
      VALUES (@uid, @amount, N'refund', N'evidence_rejected', @bid, @note, GETDATE())
    `, {
      uid: booking.customer_id,
      amount: refundAmount,
      bid: booking.booking_id,
      note: `[${policy.ruleCode}] ${policy.note}`
    });

    // Trừ 30 uy tín
    await updateReliabilityScore(booking.tasker_id, -30);

    try {
      console.log("🔥 Bắt đầu INSERT voucher...");
      await executeQuery(`
        INSERT INTO Vouchers
        (user_id, type, discount, used, created_at, source_booking_id)
        VALUES
        (@uid, 'compensation', 0.1, 0, GETDATE(), @bid)
      `, {
        uid: booking.customer_id,
        bid: booking.booking_id
      });

      console.log(`🎟️ Đã tạo voucher cho khách ${booking.customer_id}`);
    }
    catch (voucherErr) {
      console.error("❌ LỖI INSERT VOUCHER:", voucherErr);
    }

    res.json({
      success: true,
      message: "Đã từ chối báo cáo. Hoàn 100% cho khách và trừ 30 uy tín.",
      refundAmount
    });

  } catch (err) {
    console.error("❌ rejectEvidence:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

