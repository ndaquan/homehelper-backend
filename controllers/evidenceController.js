const EvidenceReview = require("../models/EvidenceReview");
const Booking = require("../models/Booking");

exports.submitNoShowEvidence = async (req, res) => {
  try {
    const { booking_id, note } = req.body;
    const tasker_id = req.user.id; // Auth middleware

    // 4 ảnh
    const house = req.files.house_number[0].path;
    const call = req.files.call_screenshot[0].path;
    const gps = req.files.gps_screenshot[0].path;
    const front = req.files.house_front[0].path;

    await EvidenceReview.create({
      booking_id,
      tasker_id,
      note,
      house_number_img: house,
      call_screenshot_img: call,
      gps_screenshot_img: gps,
      house_front_img: front,
    });

    res.json({ success: true, message: "Đã gửi báo cáo cho admin." });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "Lỗi server." });
  }
};

exports.getPendingEvidence = async (req, res) => {
  const data = await EvidenceReview.findAll({
    where: { status: "pending" },
    order: [["created_at", "DESC"]],
  });

  res.json({ success: true, data });
};

exports.approveEvidence = async (req, res) => {
  const { id } = req.params;
  const admin_id = req.user.id;

  const review = await EvidenceReview.findByPk(id);
  if (!review) return res.json({ success: false, message: "Không tìm thấy báo cáo." });

  await review.update({
    status: "approved",
    admin_id,
    reviewed_at: new Date(),
  });

  // Cập nhật booking
  await Booking.update(
    { status: "no_show_customer" },
    { where: { id: review.booking_id } }
  );

  // Refund/bồi thường theo Rule R6
  // Bạn đã có logic refund => chỉ cần gọi service:
  await refundService.applyCustomerNoShow(review.booking_id);

  res.json({ success: true, message: "Đã xác nhận khách vắng mặt." });
};

exports.rejectEvidence = async (req, res) => {
  const { id } = req.params;
  const admin_id = req.user.id;

  const review = await EvidenceReview.findByPk(id);
  if (!review) return res.json({ success: false, message: "Không tìm thấy báo cáo." });

  await review.update({
    status: "rejected",
    admin_id,
    reviewed_at: new Date(),
  });

  // Cập nhật booking thành hủy sát giờ
  await Booking.update(
    { status: "tasker_late_cancel" },
    { where: { id: review.booking_id } }
  );

  // Apply penalty –20 điểm + refund 100% cho khách
  await updateReliabilityScore(review.tasker_id, -20);
  await refundService.applyTaskerLate(review.booking_id);

  res.json({ success: true, message: "Đã từ chối báo cáo." });
};

