const { executeQuery } = require("../config/database");

async function autoCancelUnpaidBookings() {
  console.log("⏱ [Job] Kiểm tra booking quá hạn thanh toán...");

  try {
    const result = await executeQuery(`
      UPDATE Bookings
      SET status = N'Hủy',
      OUTPUT INSERTED.booking_id, INSERTED.customer_id, INSERTED.status
      WHERE status IN (N'Chờ xử lý', N'Pending')
        AND DATEDIFF(MINUTE, booking_time, GETDATE()) > 30;
    `);

    if (result.recordset.length > 0) {
      console.log(
        "❌ Hủy tự động các booking:",
        result.recordset.map((b) => b.booking_id).join(", ")
      );
    }
  } catch (err) {
    console.error("Lỗi auto-cancel:", err);
  }
}

module.exports = { autoCancelUnpaidBookings };