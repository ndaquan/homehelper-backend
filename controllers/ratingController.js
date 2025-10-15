const Rating = require("../models/Rating");
const User = require("../models/User");
const { get } = require("../routes/ratings");

const getRatingsByTasker = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Tasker ID không hợp lệ" });

    const ratings = await Rating.getByTaskerId(id); // gọi model
    res.json(ratings); // trả về toàn bộ object { reviews, average, total, breakdown }
  } catch (err) {
    console.error("Lỗi khi lấy ratings:", err);
    res.status(500).json({ error: err.message });
  }
};

// Lấy danh sách Ratings
const getRatings = async (req, res) => {
  try {
    const ratings = await Rating.findAll(); // dùng model
    res.json(ratings.ratings); // trả về danh sách
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thêm Rating
const addRating = async (req, res) => {
  try {
    const reviewer_id = req.user?.user_id;
    console.log("📥 [addRating] Request body:", req.body);
    console.log("👤 [addRating] Reviewer ID (from JWT):", reviewer_id);
    const rating = await Rating.create({
      ...req.body,
      reviewer_id, // ép vào từ JWT
    });
    console.log("✅ [addRating] Rating created:", rating);

    // ✅ Nếu review bị chờ duyệt
    if (rating.status === 0) {
      return res.status(202).json({
        success: true,
        status: 0, //  thêm dòng này để FE biết
        message: "Bình luận của bạn đang được kiểm duyệt.",
        rating,
      });
    }

    // ✅ Nếu review được duyệt ngay
    if (rating.status === 1) {
      return res.status(200).json({
        success: true,
        status: 1, //  thêm dòng này
        message: "Đánh giá đã được đăng thành công.",
        rating,
      });
    }

    // 🟡 Nếu có trạng thái khác (dự phòng)
    return res.status(200).json({
      success: true,
      status: rating.status ?? -1,
      message: rating.moderation_message || "Đánh giá đã được xử lý.",
      rating,
    });
  } catch (error) {
    console.error("❌ Lỗi khi thêm rating:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};
const approveRating = async (req, res) => {
  try {
    const { id } = req.params;
    await Rating.approve(id);
    res.json({ success: true, message: "Đánh giá đã được duyệt" });
  } catch (err) {
    console.error("❌ Approve rating error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const rejectRating = async (req, res) => {
  try {
    const { id } = req.params;
    await Rating.reject(id);
    res.json({ success: true, message: "Đánh giá đã bị từ chối" });
  } catch (err) {
    console.error("❌ Reject rating error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getRatings,
  addRating,
  getRatingsByTasker,
  approveRating,
  rejectRating,
};
