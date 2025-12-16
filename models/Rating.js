// models/Rating.js
const { executeQuery } = require("../config/database");
const { processReview } = require("../config/gemini.service"); 

class Rating {
  static async getByTaskerId(taskerId, currentUserId = null) {
    // Query không dùng RatingHelpful để tránh lỗi nếu bảng chưa tồn tại
    const query = `
    SELECT 
      r.rating_id,
      u.name AS reviewer_name,
      r.rating,
      r.reviewee_id,
      r.comment AS text,
      r.created_at AS date,
      r.staff_reply,
      r.staff_reply_date,
      r.helpful,   
      s.name AS service_name,
      0 AS userLiked
    FROM Ratings r
    JOIN Users u ON r.reviewer_id = u.user_id
    JOIN Bookings b ON r.booking_id = b.booking_id
    JOIN Services s ON b.service_id = s.service_id
    WHERE r.reviewee_id = @param1
      AND r.status = 1
    ORDER BY r.created_at DESC
  `;

    const result = await executeQuery(query, [taskerId]);
    const rows = result?.recordset || [];

    return {
      reviews: rows.map((r) => ({
        id: r.rating_id,
        name: r.reviewer_name || "Ẩn danh",
        reviewee_id: r.reviewee_id,
        rating: r.rating || 0,
        text: r.text || "",
        date: r.date,
        staff_reply: r.staff_reply || null,
        staff_reply_date: r.staff_reply_date || null,
        helpful: r.helpful || 0,
        userLiked: r.userLiked === 1,
      })),
      total: rows.length,
      average: rows.length
        ? Number(
            (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length).toFixed(
              1
            )
          )
        : 0,
      ratingsCount: rows.reduce(
        (acc, r) => {
          acc[r.rating] = (acc[r.rating] || 0) + 1;
          return acc;
        },
        { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      ),
    };
  }

  static async create({
    booking_id,
    reviewer_id,
    reviewee_id,
    rating,
    comment,
  }) {
    try {
      const reviewCheck = await processReview(comment, rating);

      // if (!reviewCheck.allow) {
      //   throw new Error(
      //     "Bình luận chứa từ ngữ không phù hợp. Không thể đăng đánh giá."
      //   );
      // }

      const query = `
      INSERT INTO Ratings (booking_id, reviewer_id, reviewee_id, rating, comment, status, created_at)
      OUTPUT INSERTED.*
      VALUES (@param1, @param2, @param3, @param4, @param5, @param6, GETDATE())
    `;
      const params = [
        booking_id,
        reviewer_id,
        reviewee_id,
        rating,
        comment,
        reviewCheck.status,
      ];
      const result = await executeQuery(query, params);
      const newRating = result.recordset[0];

      // Lấy reviewer_name
      const reviewerNameResult = await executeQuery(
        "SELECT name FROM Users WHERE user_id = @param1",
        [reviewer_id]
      );
      const reviewer_name = reviewerNameResult.recordset[0]?.name || null;

      // if (reviewCheck.status === 1) {
      //   const updateQuery = `
      //   UPDATE Taskers
      //   SET rating = (
      //     SELECT CAST(AVG(CAST(rating AS FLOAT)) AS DECIMAL(3,2))
      //     FROM Ratings
      //     WHERE reviewee_id = @param1 AND status = 1
      //   )
      //   WHERE tasker_id = @param1
      // `;
      //   await executeQuery(updateQuery, [reviewee_id]);
      // }

      return {
        ...newRating,
        reviewer_name,
        moderation_message: reviewCheck.message,
      };
    } catch (error) {
      const msg = String(error.message || "");
      if (
        msg.includes("UNIQUE") ||
        msg.includes("duplicate key") ||
        msg.includes("Violation of UNIQUE KEY constraint")
      ) {
        throw new Error(
          "Bạn đã đánh giá cho booking này rồi. Không thể tạo đánh giá trùng."
        );
      }
      throw error;
    }
  }

  // Lấy toàn bộ ratings (đáp ứng controller.getRatings)
  static async findAll() {
    const query = `
      SELECT 
        r.rating_id,
        r.booking_id,
        r.reviewer_id,
        r.reviewee_id,
        r.rating,
        r.comment,
        r.status, 
        r.created_at,
        u.name AS reviewer_name,
        uu.name AS reviewee_name,
        s.name AS service_name
      FROM Ratings r
      LEFT JOIN Users u ON r.reviewer_id = u.user_id
      LEFT JOIN Users uu ON r.reviewee_id = uu.user_id
      LEFT JOIN Bookings b ON r.booking_id = b.booking_id
      LEFT JOIN Services s ON b.service_id = s.service_id
      ORDER BY r.created_at DESC
    `;
    const result = await executeQuery(query);
    return { ratings: result?.recordset || [] };
  }
  static async reply(rating_id, reply, user_id) {
    const query = `
    UPDATE Ratings 
    SET staff_reply = @param1,
        staff_reply_date = GETDATE()
    WHERE rating_id = @param2
  `;
    const result = await executeQuery(query, [reply, rating_id]);
    return result;
  }

  static async toggleHelpful(ratingId, userId) {
    try {
      // Lấy lượt hữu ích hiện tại
      const reviewResult = await executeQuery(
        "SELECT helpful FROM Ratings WHERE rating_id = @param1",
        [ratingId]
      );

      if (reviewResult.recordset.length === 0)
        throw new Error("Đánh giá không tồn tại.");

      const { helpful } = reviewResult.recordset[0];

      // Kiểm tra xem user đã bấm chưa
      const check = await executeQuery(
        "SELECT * FROM RatingHelpful WHERE rating_id = @param1 AND user_id = @param2",
        [ratingId, userId]
      );

      let newHelpful;

      if (check.recordset.length > 0) {
        // Huỷ lượt bấm
        await executeQuery(
          "DELETE FROM RatingHelpful WHERE rating_id = @param1 AND user_id = @param2",
          [ratingId, userId]
        );
        newHelpful = Math.max(0, helpful - 1);
      } else {
        // Thêm lượt bấm
        await executeQuery(
          "INSERT INTO RatingHelpful (rating_id, user_id) VALUES (@param1, @param2)",
          [ratingId, userId]
        );
        newHelpful = helpful + 1;
      }

      // Cập nhật số hữu ích trong Ratings
      await executeQuery(
        "UPDATE Ratings SET helpful = @param2 WHERE rating_id = @param1",
        [ratingId, newHelpful]
      );

      return { liked: check.recordset.length === 0, helpful: newHelpful };
    } catch (error) {
      console.error("❌ RatingModel.toggleHelpful error:", error);
      throw error;
    }
  }

  // static async approve(id) {
  //   // Cập nhật trạng thái rating sang 1 (đã duyệt)
  //   await executeQuery(
  //     `UPDATE Ratings SET status = 1 WHERE rating_id = @param1`,
  //     [id]
  //   );

  //   // Cập nhật lại điểm trung bình cho tasker
  //   await executeQuery(
  //     `
  //     UPDATE Taskers
  //     SET rating = (
  //       SELECT CAST(AVG(CAST(rating AS FLOAT)) AS DECIMAL(3,2))
  //       FROM Ratings
  //       WHERE reviewee_id = (
  //         SELECT reviewee_id FROM Ratings WHERE rating_id = @param1
  //       )
  //       AND status = 1
  //     )
  //     WHERE tasker_id = (
  //       SELECT reviewee_id FROM Ratings WHERE rating_id = @param1
  //     )
  //   `,
  //     [id]
  //   );
  // }
  // static async reject(id) {
  //   const result = await executeQuery(
  //     `UPDATE Ratings SET status = 2 WHERE rating_id = @param1`,
  //     [parseInt(id)]
  //   );
  //   console.log("Reject rating:", id, "Rows affected:", result.rowsAffected);
  //   const check = await executeQuery(
  //     `SELECT rating_id, status FROM Ratings WHERE rating_id = @param1`,
  //     [parseInt(id)]
  //   );
  //   console.log("Status sau reject:", check.recordset[0]);
  //   return check.recordset[0];
  // }
}

module.exports = Rating;
