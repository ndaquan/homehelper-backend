const WalletTx = require('../models/WalletTransaction');
const { getPool, sql } = require('../config/database');
const { notifyBookingEvent } = require('../services/notification.service');
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
          b.expected_price 
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

    // 2) Lấy giá gốc
    let price = Number(booking.final_price);

    if (!price || price <= 0) {
      price = Number(booking.expected_price);
    }

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

      // Áp dụng giảm giá
      price = Math.round(price * (1 - voucher.discount));

      console.log("💳 Applied voucher:", voucher.discount * 100 + "%");
      console.log("💰 Price after discount:", price);
    }

    const toPay = price;
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
    await reqTx
      .input("user_id", sql.Int, user_id)
      .input("amount", sql.Money, toPay)
      .input("type", sql.NVarChar, "debit")
      .input("purpose", sql.NVarChar, "booking_payment")
      .input("related_id", sql.Int, booking_id)
      .input("note", sql.NVarChar, voucher_id ? `Payment with voucher ${voucher_id}` : "Payment")
      .query(`
        INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
        VALUES (@user_id, @amount, @type, @purpose, @related_id, @note, SYSUTCDATETIME());
      `);
    console.log("✅ Insert done");

    // 3.2) Cập nhật trạng thái booking = "Đã thanh toán"
    await reqTx
      .input("booking_id", sql.Int, booking_id)
      .query(`
        UPDATE Bookings
        SET status = N'Đã thanh toán'
        WHERE booking_id = @booking_id;
      `);

    // 3.3) Đánh dấu voucher đã dùng (nếu có)
    if (voucher_id) {
      await reqTx
        .input("voucher_id", sql.Int, voucher_id)
        .query(`
          UPDATE Vouchers
          SET used = 1
          WHERE voucher_id = @voucher_id;
        `);
    }

    await tx.commit();
    console.log("✅ COMMIT DONE!");

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