const WalletTx = require('../models/WalletTransaction');
const { getPool, sql } = require('../config/database');
const { notifyBookingEvent, notifyWithdrawalEvent } = require('../services/notification.service');
async function computeBalance(pool, user_id) {
  const rs = await pool.request()
    .input("user_id", sql.Int, user_id)
    .query(`
      SELECT ISNULL(SUM(
        CASE 
          WHEN type IN ('credit', 'refund', 'compensation') THEN amount
          WHEN type = 'debit' THEN -amount
          ELSE 0 
        END
      ),0) AS balance
      FROM WalletTransactions
      WHERE user_id=@user_id
    `);
  console.log("=== BE SQL RESULT ===", rs.recordset[0]);
  return Number(rs.recordset[0]?.balance || 0);
}

// GET /api/wallet/balance
exports.getBalance = async (req, res) => {
  console.log("=== BE DEBUG BALANCE CALLED ===");
  console.log("req.user =", req.user);
  console.log("Headers token =", req.headers.authorization);
  console.log("===============================");
  try {
    const user_id = req.user?.user_id;
    if (!user_id) return res.status(401).json({ error: 'unauthorized' });

    const balance = await WalletTx.getBalance(user_id);
    return res.json({ balance });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/wallet/history
exports.getHistory = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    if (!user_id) return res.status(401).json({ error: 'unauthorized' });

    const limit = Number(req.query.limit) || 20;
    const history = await WalletTx.getHistory(user_id, limit);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.payForBooking = async (req, res) => {
  const user_id = req.user?.user_id;
  if (!user_id) return res.status(401).json({ success: false, message: "Unauthorized" });

  const { booking_id, voucher_id } = req.body || {};
  if (!booking_id) return res.status(400).json({ success: false, message: "booking_id is required" });

  console.log("=== [DEBUG payForBooking] ===");
  console.log("user_id:", user_id);
  console.log("booking_id:", booking_id);
  console.log("voucher_id:", voucher_id);

  let tx;

  try {
    const pool = await getPool();
    console.log("✅ Connected to DB");

    // 1) Lấy booking và số tiền cần thanh toán
    const bRs = await pool.request()
      .input("booking_id", sql.Int, booking_id)
      .query(`
        SELECT TOP 1
          b.booking_id,
          b.customer_id,
          b.tasker_id,
          b.status,
          b.final_price,
          b.expected_price,
          b.quantity
        FROM Bookings b
        WHERE b.booking_id = @booking_id
      `);
    console.log("📦 Booking record:", bRs.recordset[0]);

    const booking = bRs.recordset[0];
    if (!booking) {
      console.log("⚠️ Booking not found");
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    console.log("🧮 Start transaction...");

    if (booking.customer_id !== user_id) {
      return res.status(403).json({ success: false, message: "You cannot pay for this booking" });
    }

    // 2) Lấy giá gốc / đơn vị
    let unitPrice = Number(booking.final_price) > 0
      ? Number(booking.final_price)
      : Number(booking.expected_price);

    console.log("💲 Unit price per unit:", unitPrice);

    // 3) Lấy quantity từ DB
    let quantity = Number(booking.quantity) || 1;
    console.log("🔢 Quantity:", quantity);

    // 4) Tính subtotal (tổng trước voucher)
    let subtotal = unitPrice * quantity;
    console.log("🧮 Subtotal (unitPrice × quantity):", subtotal);

    let total = subtotal;

    // 3) Nếu có voucher_id → BE tự kiểm tra
    if (voucher_id) {
      const vRs = await pool.request()
        .input("voucher_id", sql.Int, voucher_id)
        .input("user_id", sql.Int, user_id)
        .query(`
          SELECT TOP 1 *
          FROM Vouchers
          WHERE voucher_id = @voucher_id AND user_id = @user_id
        `);

      const voucher = vRs.recordset[0];

      if (!voucher)
        return res.status(400).json({ success: false, message: "Voucher không hợp lệ" });

      if (new Date(voucher.expiry_date) < new Date())
        return res.status(400).json({ success: false, message: "Voucher đã hết hạn" });

      console.log("🎁 Voucher detected:", voucher);

      // Logic áp dụng voucher
      // Nếu là percent HOẶC discount <= 1 (xem như tỉ lệ 0.1, 0.2...)
      // thì tính theo %
      if (voucher.type === "percent" || (voucher.discount > 0 && voucher.discount <= 1)) {
        total = Math.round(subtotal * (1 - voucher.discount));
      } else {
        // Ngược lại trừ thẳng (VND)
        total = subtotal - voucher.discount;
        if (total < 0) total = 0;
      }

      console.log("🏷️ Price after voucher:", total);
    }

    let toPay = total;

    console.log("💰 Final amount to pay:", toPay);

    if (!toPay || toPay <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount to pay" });
    }

    // 2) Kiểm tra số dư
    const currentBalance = await computeBalance(pool, user_id);
    if (currentBalance < toPay) {
      return res.status(400).json({
        success: false,
        message: "Số dư không đủ. Vui lòng nạp thêm tiền.",
        balance: currentBalance
      });
    }

    // 3) Transaction: trừ tiền + ghi giao dịch + cập nhật booking
    tx = new sql.Transaction(pool);
    await tx.begin();

    const reqTx = new sql.Request(tx);
    console.log("💰 Begin insert WalletTransactions...");

    // 3.1) Ghi giao dịch debit
    const txReq1 = new sql.Request(tx);
    await txReq1
      .input("user_id", sql.Int, user_id)
      .input("amount", sql.Money, toPay)
      .input("type", sql.NVarChar, "debit")
      .input("purpose", sql.NVarChar, "booking_payment")
      .input("related_id", sql.Int, booking_id)
      .input("note", sql.NVarChar, voucher_id ? `Thanh toán với voucher ${voucher_id}` : "Thanh toán booking")
      .query(`
        INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
        VALUES (@user_id, @amount, @type, @purpose, @related_id, @note, SYSUTCDATETIME());
      `);
    console.log("✅ Insert done");

    // 3.2) Cập nhật trạng thái booking = "Đã thanh toán"
    const txReq2 = new sql.Request(tx);
    await txReq2
      .input("booking_id", sql.Int, booking_id)
      .query(`
        UPDATE Bookings
        SET status = N'Đã thanh toán'
        WHERE booking_id = @booking_id;
      `);

    // 3.2.1) Lưu paid_amount đúng với số tiền khách đã trả
    const txReq3 = new sql.Request(tx);
    await txReq3
      .input("booking_id", sql.Int, booking_id)
      .input("paid_amount", sql.Money, toPay)
      .input("voucher_id", sql.Int, voucher_id || null)
      .query(`
        UPDATE Bookings
        SET paid_amount = @paid_amount,
        used_voucher_id = @voucher_id
        WHERE booking_id = @booking_id;
      `);

    // 3.3) Đánh dấu voucher đã dùng (nếu có)
    if (voucher_id) {
      const txReq4 = new sql.Request(tx);
      await txReq4
        .input("voucher_id", sql.Int, voucher_id)
        .query(`
          UPDATE Vouchers
          SET used = 1
          WHERE voucher_id = @voucher_id;
        `);
    }

    await tx.commit();
    console.log("✅ COMMIT DONE!");

    try {
      const io = req.app.get('io');
      await notifyBookingEvent(io, {
        action: 'paid',
        booking_id,
        customer_id: user_id,
        tasker_id: booking.tasker_id,
        amount: toPay
      });
    } catch (notifyErr) {
      console.warn('[wallet.pay] notifyBookingEvent failed:', notifyErr?.message || notifyErr);
    }

    return res.json({
      success: true,
      message: "Thanh toán thành công (local fake)",
      booking_id,
      paid_amount: toPay,
      balance_after: currentBalance - toPay
    });
  } catch (e) {
    if (tx) {
      try { await tx.rollback(); } catch { }
    }
    console.error("[wallet.pay] error:", e);
    return res.status(500).json({ success: false, message: "Payment failed (local)" });
  }
}

// 1. User tạo yêu cầu rút tiền
exports.requestWithdrawal = async (req, res) => {
  const user_id = req.user?.user_id;
  if (!user_id) return res.status(401).json({ success: false, message: "Unauthorized" });

  const { amount, bank_name, bank_number, account_holder, note } = req.body;
  const withdrawAmount = Number(amount);

  // Validate số tiền (Đơn vị tính là Nghìn đồng, vd: 50 = 50.000đ)
  if (isNaN(withdrawAmount) || withdrawAmount < 50) {
    return res.status(400).json({ success: false, message: "Số tiền rút tối thiểu là 50 (tương đương 50.000 VNĐ)" });
  }

  if (!bank_name || !bank_number || !account_holder) {
    return res.status(400).json({ success: false, message: "Vui lòng cung cấp đầy đủ thông tin ngân hàng" });
  }

  try {
    const pool = await getPool();
    const currentBalance = await computeBalance(pool, user_id);

    if (currentBalance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: "Số dư không đủ để thực hiện yêu cầu này.",
        balance: currentBalance
      });
    }

    // Tạo record trong WithdrawRequest
    await pool.request()
      .input("user_id", sql.Int, user_id)
      .input("amount", sql.Money, withdrawAmount)
      .input("status", sql.NVarChar, 'pending')
      .input("bank_name", sql.NVarChar, bank_name)
      .input("bank_number", sql.NVarChar, bank_number)
      .input("account_holder", sql.NVarChar, account_holder)
      .input("note", sql.NVarChar, note || "")
      .query(`
        INSERT INTO WithdrawRequest (user_id, amount, status, bank_name, bank_number, account_holder, note, created_at, updated_at)
        VALUES (@user_id, @amount, @status, @bank_name, @bank_number, @account_holder, @note, SYSUTCDATETIME(), SYSUTCDATETIME());
      `);

    res.json({
      success: true,
      message: "Yêu cầu rút tiền của bạn đã được gửi và đang chờ xử lý.",
      balance: currentBalance
    });
  } catch (error) {
    console.error("❌ Error requesting withdrawal:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Admin lấy danh sách yêu cầu
exports.getWithdrawRequests = async (req, res) => {
  // if (req.user?.role !== 'Admin') return res.status(403).json({ success: false, message: "Forbidden" });

  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT wr.*, u.name as user_name, u.email as user_email
      FROM WithdrawRequest wr
      JOIN Users u ON wr.user_id = u.user_id
      ORDER BY wr.request_id DESC
    `);

    res.json({ success: true, data: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Admin xử lý yêu cầu (Duyệt/Từ chối)
exports.processWithdrawal = async (req, res) => {
  const { request_id, decision, admin_note } = req.body; // decision: 'completed' | 'rejected'
  // if (req.user?.role !== 'Admin') return res.status(403).json({ success: false, message: "Forbidden" });

  if (!['completed', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" });
  }

  let tx;
  try {
    const pool = await getPool();

    // Lấy thông tin yêu cầu
    const requestRes = await pool.request()
      .input("rid", sql.Int, request_id)
      .query("SELECT * FROM WithdrawRequest WHERE request_id = @rid");

    const request = requestRes.recordset[0];
    if (!request) return res.status(404).json({ success: false, message: "Không tìm thấy yêu cầu" });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: "Yêu cầu này đã được xử lý" });

    if (decision === 'rejected') {
      const finalNote = admin_note || "Từ chối";
      await pool.request()
        .input("rid", sql.Int, request_id)
        .input("note", sql.NVarChar, finalNote)
        .query(`UPDATE WithdrawRequest SET status = 'rejected', note = @note, updated_at = SYSUTCDATETIME() WHERE request_id = @rid`);

      try {
        const io = req.app.get('io');
        await notifyWithdrawalEvent(io, {
          user_id: request.user_id,
          amount: request.amount,
          status: 'rejected',
          admin_note: finalNote
        });
      } catch (err) { console.error("Notify rejection error:", err); }

      return res.json({ success: true, message: "Đã từ chối yêu cầu rút tiền" });
    }

    // Nếu là completed (Duyệt) -> Kiểm tra lại số dư và trừ tiền thật
    const currentBalance = await computeBalance(pool, request.user_id);
    if (currentBalance < request.amount) {
      return res.status(400).json({ success: false, message: "Số dư ví không đủ để thực hiện yêu cầu này" });
    }

    tx = new sql.Transaction(pool);
    await tx.begin();

    // 1. Ghi WalletTransaction (debit)
    await new sql.Request(tx)
      .input("uid", sql.Int, request.user_id)
      .input("amount", sql.Money, request.amount)
      .input("note", sql.NVarChar, `Rút tiền về NH: ${request.bank_name}`)
      .input("rid", sql.Int, request_id)
      .query(`
        INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
        VALUES (@uid, @amount, 'debit', 'withdrawal', @rid, @note, SYSUTCDATETIME())
      `);

    // 2. Update WithdrawRequest thành completed
    await new sql.Request(tx)
      .input("rid", sql.Int, request_id)
      .query(`UPDATE WithdrawRequest SET status = 'completed', updated_at = SYSUTCDATETIME() WHERE request_id = @rid`);

    await tx.commit();

    try {
      const io = req.app.get('io');
      await notifyWithdrawalEvent(io, {
        user_id: request.user_id,
        amount: request.amount,
        status: 'completed'
      });
    } catch (err) { console.error("Notify approval error:", err); }

    res.json({ success: true, message: "Đã duyệt và trừ tiền thành công" });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("❌ Error processing withdrawal:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. User lấy danh sách yêu cầu rút tiền của mình
exports.getMyWithdrawRequests = async (req, res) => {
  const user_id = req.user?.user_id;
  if (!user_id) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("user_id", sql.Int, user_id)
      .query(`
        SELECT * FROM WithdrawRequest 
        WHERE user_id = @user_id 
        ORDER BY request_id DESC
      `);

    res.json({ success: true, data: result.recordset });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};