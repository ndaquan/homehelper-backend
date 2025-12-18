// services/refundPolicy.service.js
function hoursUntil(startTimeISO) {
  const now = new Date();
  const start = new Date(startTimeISO);
  return (start.getTime() - now.getTime()) / 3600000; // hours
}

/**
 * cancelledBy: "customer" | "tasker" | "system" | "no_show"
 * booking: { start_time, final_price, expected_price }
 * Returns { ruleCode, refundPercent, compensationPercent, note }
 */
function calculateRefundPolicy(booking, cancelledBy) {
  // Tổng tiền làm căn cứ hoàn/bồi thường: nếu đã thanh toán dùng final_price, chưa thanh toán fallback expected_price.
  const total = Number(
    booking.paid_amount ??
    booking.final_price ??
    booking.expected_price ??
    0
  );

  // R6: Khách không có mặt (no_show) = giống <4h (R4) nhưng yêu cầu bằng chứng ở tầng controller
  if (cancelledBy === "no_show") {
    return {
      ruleCode: "R6",
      refundPercent: 0,
      compensationPercent: 100,
      note: "Khách không có mặt / không mở cửa (xác thực hợp lệ), trả tiền tasker",
      total,
    };
  }

  // R5: Tasker hủy – hoàn 100% (voucher làm sau)
  if (cancelledBy === "tasker") {
    return {
      ruleCode: "R5",
      refundPercent: 100,
      compensationPercent: 0,
      note: "Tasker hủy đơn – hoàn 100% cho khách",
      total,
    };
  }

  if (cancelledBy === "tasker_late") {
    return {
      ruleCode: "R5",
      refundPercent: 100,
      compensationPercent: 0,
      note: "Tasker hủy sát giờ, hoàn tiền cho khách",
      total,
    };
  }

  // R7: Báo cáo bị từ chối – Tasker sai → Hoàn 100% cho khách, Tasker 0%
  if (cancelledBy === "evidence_rejected") {
    return {
      ruleCode: "R8",
      refundPercent: 100,
      compensationPercent: 0,
      note: "Báo cáo bị từ chối – Tasker cung cấp bằng chứng không hợp lệ, hoàn tiền cho khách",
      total,
    };
  }

  // R1–R4: Khách hủy theo mốc giờ
  if (cancelledBy === "customer") {
    const diffHours = hoursUntil(booking.start_time);

    if (diffHours > 24) {
      return { ruleCode: "R1", refundPercent: 100, compensationPercent: 0, note: "Khách hủy >24h trước giờ làm, hoàn 100% cho khách", total };
    }
    if (diffHours > 12) {
      return { ruleCode: "R2", refundPercent: 75, compensationPercent: 25, note: "Khách hủy 12–24h trước giờ làm, hoàn 75% cho khách", total };
    }
    if (diffHours > 4) {
      return { ruleCode: "R3", refundPercent: 50, compensationPercent: 50, note: "Khách hủy 4–12h trước giờ làm, hoàn 50% cho khách", total };
    }
    // <= 4h
    return { ruleCode: "R4", refundPercent: 0, compensationPercent: 100, note: "Khách hủy < 4h trước giờ làm, hoàn 100% cho khách", total };
  }

  // Fallback
  return { ruleCode: "NONE", refundPercent: 0, compensationPercent: 0, note: "Không xác định", total };
}

module.exports = { calculateRefundPolicy };
