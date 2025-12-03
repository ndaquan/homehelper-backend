const { executeQuery } = require("../config/database");

// GET /api/vouchers/my
exports.getMyVouchers = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    // lấy điểm
    const userRes = await executeQuery(
      `SELECT user_id, points FROM Users WHERE user_id = @uid`,
      { uid: userId }
    );
    const me = userRes.recordset?.[0];
    if (!me) return res.status(404).json({ success: false, message: "User not found" });

    // lấy voucher của user (mới nhất trước)
    const vRes = await executeQuery(
      `SELECT voucher_id, type, discount, used, created_at, expiry_date, source_booking_id
       FROM Vouchers
       WHERE user_id = @uid
       ORDER BY voucher_id DESC`,
      { uid: userId }
    );

    return res.json({
      success: true,
      points: me.points ?? 0,
      vouchers: vRes.recordset || []
    });
  } catch (err) {
    console.error("❌ getMyVouchers:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vouchers/redeem  (100 points -> 1 voucher 10%)
exports.redeemVoucher = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    // lấy điểm hiện tại
    const userRes = await executeQuery(
      `SELECT points FROM Users WHERE user_id = @uid`,
      { uid: userId }
    );
    const me = userRes.recordset?.[0];
    if (!me) return res.status(404).json({ success: false, message: "User not found" });

    const current = Number(me.points ?? 0);
    if (current < 100) {
      return res.status(400).json({ success: false, message: "Bạn chưa đủ 100 điểm để đổi voucher." });
    }

    // trừ 100 điểm
    await executeQuery(
      `UPDATE Users SET points = points - 100 WHERE user_id = @uid`,
      { uid: userId }
    );

    // tạo voucher type = reward, discount = 0.1, expiry_date là computed (tự +7 ngày)
    await executeQuery(
      `INSERT INTO Vouchers (user_id, type, discount, used, created_at)
       VALUES (@uid, 'reward', 0.1, 0, GETDATE())`,
      { uid: userId }
    );

    // trả lại dữ liệu mới để FE refresh
    const afterRes = await executeQuery(
      `SELECT voucher_id, type, discount, used, created_at, expiry_date, source_booking_id
       FROM Vouchers WHERE user_id = @uid
       ORDER BY voucher_id DESC`,
      { uid: userId }
    );
    const pointsRes = await executeQuery(
      `SELECT points FROM Users WHERE user_id = @uid`,
      { uid: userId }
    );

    return res.json({
      success: true,
      message: "Đổi voucher thành công (–100 points → +1 voucher 10%).",
      points: pointsRes.recordset?.[0]?.points ?? 0,
      vouchers: afterRes.recordset || []
    });
  } catch (err) {
    console.error("❌ redeemVoucher:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vouchers/available-for-booking  (dùng cho popup trong lúc đặt booking)
exports.getAvailableForBooking = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const vRes = await executeQuery(
      `SELECT voucher_id, type, discount, used, created_at, expiry_date
       FROM Vouchers
       WHERE user_id = @uid
         AND used = 0
         AND expiry_date > GETDATE()
       ORDER BY expiry_date ASC, voucher_id DESC`,
      { uid: userId }
    );

    return res.json({ success: true, vouchers: vRes.recordset || [] });
  } catch (err) {
    console.error("❌ getAvailableForBooking:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
