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
    const { booking_id, reviewee_id, rating, comment } = req.body;
    const reviewer_id = req.user.userId;

    const newRating = await Rating.create({
      booking_id,
      reviewer_id,
      reviewee_id,
      rating,
      comment,
    });

    // Lấy tên reviewer
    const reviewer = await User.findById(reviewer_id);

    res.json({
      id: newRating.rating_id,
      name: reviewer?.name || "Ẩn danh",
      rating: newRating.rating,
      comment: newRating.comment,
      created_at: newRating.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getRatings, addRating, getRatingsByTasker };
