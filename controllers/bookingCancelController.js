const { executeQuery } = require("../config/database");
const { calculateRefundPolicy } = require("../services/refundPolicy.service");
const { updateReliabilityScore } = require("../services/reliabilityScore.service");

// Hàm hủy booking
class BookingCancelController {
    static async cancelBooking(req, res) {
        try {
            const bookingId = parseInt(req.params.id, 10);
            const { cancelledBy, evidenceUrl } = req.body || {};

            if (!bookingId || !cancelledBy) {
                return res.status(400).json({ success: false, message: "Thiếu bookingId hoặc cancelledBy" });
            }

            // 1️⃣ Lấy booking
            const result = await executeQuery(
                `SELECT * FROM Bookings WHERE booking_id = @param1`,
                [bookingId]
            );
            const booking = result.recordset?.[0];
            if (!booking) {
                return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
            }

            // Nếu đã hủy / hoàn thành thì không cho hủy lại
            if (booking.status === "Hủy" || booking.status === "Hoàn thành") {
                return res.status(400).json({ success: false, message: `Booking hiện ở trạng thái '${booking.status}', không thể hủy.` });
            }

            // Nếu là no_show thì bắt buộc có bằng chứng
            if (cancelledBy === "no_show" && !evidenceUrl) {
                return res.status(400).json({ success: false, message: "Thiếu bằng chứng (evidenceUrl) cho trường hợp khách không có mặt." });
            }

            // 2️⃣ Tính rule refund / compensation
            const policy = calculateRefundPolicy(booking, cancelledBy);
            const total = policy.total || 0;
            const alreadyPaid = booking.status === "Đã thanh toán";

            const refundAmount = alreadyPaid ? Math.round(total * (policy.refundPercent / 100)) : 0;
            const compensationAmount = alreadyPaid ? Math.round(total * (policy.compensationPercent / 100)) : 0;

            // 3️⃣ Update trạng thái booking
            await executeQuery(
                `UPDATE Bookings SET status = N'Hủy' WHERE booking_id = @param1`,
                [bookingId]
            );

            // 4️⃣ Ghi log ví (nếu đã thanh toán)
            if (alreadyPaid) {
                // Refund cho khách
                if (refundAmount > 0) {
                    await executeQuery(
                        `INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
           VALUES (@param1, @param2, N'refund', N'booking_cancel', @param3, @param4, GETDATE())`,
                        [booking.customer_id, refundAmount, bookingId, `[${policy.ruleCode}] ${policy.note}`]
                    );
                }

                // Đền bù cho tasker
                if (compensationAmount > 0) {
                    await executeQuery(
                        `INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
           VALUES (@param1, @param2, N'compensation', N'booking_cancel', @param3, @param4, GETDATE())`,
                        [booking.tasker_id, compensationAmount, bookingId, `[${policy.ruleCode}] ${policy.note}`]
                    );
                }
            }

            // 5️⃣ Ghi log system/no_show (nếu cần)
            if (cancelledBy === "system" || cancelledBy === "no_show") {
                await executeQuery(
                    `INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note, created_at)
         VALUES (@param1, 0, N'system', @param2, @param3, @param4, GETDATE())`,
                    [
                        booking.customer_id,
                        cancelledBy === "system" ? "system_cancel" : "no_show",
                        bookingId,
                        `[${policy.ruleCode}] ${policy.note}${evidenceUrl ? ` | evidence: ${evidenceUrl}` : ""}`
                    ]
                );
            }

            if (cancelledBy === "tasker" || cancelledBy === "tasker_late") {
                // --- 1) Nếu khách chưa thanh toán: KHÔNG phạt ---
                if (!booking.isPaid) {
                    console.log("Tasker hủy nhưng khách chưa thanh toán → Không phạt.");
                    return;
                }

                // --- 2) Nếu khách đã thanh toán: Áp dụng phạt ---
                let penalty = 0;

                if (cancelledBy === "tasker") {
                    penalty = -10; // hủy bình thường (>2h)
                }

                if (cancelledBy === "tasker_late") {
                    penalty = -20; // hủy sát giờ (<2h)
                }

                await updateReliabilityScore(booking.tasker_id, penalty);
            }


            return res.json({
                success: true,
                message: "Hủy booking thành công",
                rule: policy.ruleCode,
                refundAmount,
                compensationAmount,
            });
        } catch (error) {
            console.error("❌ Lỗi hủy booking:", error);

            // In thêm thông tin chi tiết để debug
            console.log("=== [DEBUG ERROR DETAILS] ===");
            console.log("Error name:", error.name);
            console.log("Error message:", error.message);
            console.log("Error stack:", error.stack);
            console.log("Error code:", error.code);
            console.log("SQL state:", error.sqlState);
            console.log("SQL info:", error.info);

            // Trả về client lỗi rõ ràng (chỉ dùng khi dev)
            return res.status(500).json({
                success: false,
                message: "Lỗi server",
                error: error.message,
            });
        }
    }
}

module.exports = BookingCancelController;
