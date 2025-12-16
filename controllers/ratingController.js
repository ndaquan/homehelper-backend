const Rating = require("../models/Rating");
const Booking = require("../models/Booking");
const User = require("../models/User");
const { get } = require("../routes/ratings");
const { executeQuery } = require("../config/database");

const getRatingsByTasker = async (req, res) => {
  try {
    const { id } = req.params; // taskerId
    const currentUserId = req.query.userId || null; // user hiện tại
    if (!id) return res.status(400).json({ error: "Tasker ID không hợp lệ" });

    const ratings = await Rating.getByTaskerId(id, currentUserId);
    res.json(ratings);
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
const replyToRating = async (req, res) => {
  try {
    const { rating_id } = req.params;
    const { reply } = req.body;
    const replier_id = req.user?.user_id; // tasker trả lời
    const result = await Rating.reply(rating_id, reply);

    if (!reply?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Nội dung phản hồi không được để trống.",
      });
    }

    if (!result.rowsAffected || result.rowsAffected[0] === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đánh giá." });
    }

    res.json({
      success: true,
      message: "Phản hồi đã được ghi nhận thành công.",
    });
  } catch (error) {
    console.error("❌ replyToRating error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
const toggleHelpful = async (req, res) => {
  try {
    const { id } = req.params; // rating_id
    const user_id = req.user.user_id;

    const result = await Rating.toggleHelpful(id, user_id);

    res.json(result); // { liked: true/false, helpful: <count> }
  } catch (error) {
    console.error("❌ toggleHelpful controller error:", error);
    res
      .status(400)
      .json({ message: error.message || "Lỗi khi cập nhật lượt hữu ích." });
  }
};

const addRatingByBooking = async (req, res) => {
  try {
    const reviewer_id = req.user?.user_id;
    const { booking_id, rating, comment } = req.body;

    if (!booking_id) {
      return res.status(400).json({ success: false, message: "Thiếu booking_id." });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Số sao không hợp lệ." });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, message: "Bình luận không được bỏ trống." });
    }

    // 1. Kiểm tra booking có tồn tại không
    const bookingResult = await executeQuery(
      "SELECT * FROM Bookings WHERE booking_id = @param1",
      [booking_id]
    );

    const booking = bookingResult.recordset[0];
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking không tồn tại." });
    }

    // 2. Kiểm tra booking thuộc về user hiện tại
    if (booking.customer_id !== reviewer_id) {
      return res.status(400).json({
        success: false,
        message: "Bạn không thể đánh giá booking của người khác.",
      });
    }

    // 3. Kiểm tra trạng thái (phải Hoàn thành)
    if (booking.status !== "Hoàn thành") {
      return res.status(400).json({
        success: false,
        message: "Chỉ có thể đánh giá sau khi booking đã hoàn thành.",
      });
    }

    // 4. Kiểm tra xem đã đánh giá booking này hay chưa
    const checkExists = await executeQuery(
      "SELECT rating_id FROM Ratings WHERE booking_id = @param1",
      [booking_id]
    );

    if (checkExists.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Bạn đã đánh giá booking này rồi.",
      });
    }

    // 5. Tạo rating mới
    const newRating = await Rating.create({
      booking_id,
      reviewer_id,
      reviewee_id: booking.tasker_id,
      rating,
      comment,
    });

    return res.status(200).json({
      success: true,
      message: "Đánh giá thành công!",
      rating: newRating
    });

  } catch (err) {
    console.error("❌ addRatingByBooking error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Lỗi server khi tạo rating.",
    });
  }
};

const findRatingByBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const result = await executeQuery(
      "SELECT * FROM Ratings WHERE booking_id = @param1",
      [bookingId]
    );

    res.json({
      rating: result.recordset[0] || null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// const approveRating = async (req, res) => {
//   try {
//     const { id } = req.params;
//     await Rating.approve(id);
//     res.json({ success: true, message: "Đánh giá đã được duyệt" });
//   } catch (err) {
//     console.error("❌ Approve rating error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// const rejectRating = async (req, res) => {
//   try {
//     const { id } = req.params;
//     await Rating.reject(id);
//     res.json({ success: true, message: "Đánh giá đã bị từ chối" });
//   } catch (err) {
//     console.error("❌ Reject rating error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

module.exports = {
  getRatings,
  addRating,
  getRatingsByTasker,
  replyToRating,
  toggleHelpful,
  addRatingByBooking,
  findRatingByBooking
};
