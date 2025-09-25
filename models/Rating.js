// models/Rating.js
const { executeQuery } = require("../config/database");

class Rating {
  // Tạo rating mới
  // models/Rating.js
  static async getByTaskerId(taskerId) {
    const query = `
    SELECT 
      r.rating_id,
      u.name AS reviewer_name,
      r.rating,
      r.comment AS text,
      r.created_at AS date,
      s.name AS service_name
    FROM Ratings r
    JOIN Users u ON r.reviewer_id = u.user_id
    JOIN Bookings b ON r.booking_id = b.booking_id
    JOIN Services s ON b.service_id = s.service_id
    WHERE r.reviewee_id = @param1
    ORDER BY r.created_at DESC
  `;

    const result = await executeQuery(query, [taskerId]);
    const rows = result?.recordset || [];

    const reviews = rows.map((r) => ({
      id: r.rating_id,
      name: r.reviewer_name || "Ẩn danh",
      rating: r.rating || 0,
      text: r.text || "",
      date: r.date,
    }));

    const total = reviews.length;
    const ratingsCount = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((r) => {
      ratingsCount[r.rating] = (ratingsCount[r.rating] || 0) + 1;
    });

    const average = total
      ? Number(
          (reviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1)
        )
      : 0;

    return { reviews, average, total, ratingsCount };
  }
  static async create({
    booking_id,
    reviewer_id,
    reviewee_id,
    rating,
    comment,
  }) {
    // Một số DB có thể không dùng IDENTITY cho rating_id theo setup2.sql,
    // nên cần kiểm tra và tự sinh rating_id khi cần.
    try {
      const identityCheckQuery = `SELECT COLUMNPROPERTY(OBJECT_ID('Ratings'), 'rating_id', 'IsIdentity') AS is_identity`;
      const identityResult = await executeQuery(identityCheckQuery);
      const isIdentity =
        identityResult.recordset &&
        identityResult.recordset[0] &&
        identityResult.recordset[0].is_identity === 1;

      if (isIdentity) {
        const query = `
          INSERT INTO Ratings (booking_id, reviewer_id, reviewee_id, rating, comment, created_at)
          OUTPUT INSERTED.*
          VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE())
        `;
        const params = [booking_id, reviewer_id, reviewee_id, rating, comment];
        const result = await executeQuery(query, params);
        return result.recordset[0];
      }

      // Không phải IDENTITY: sinh thủ công next id
      const nextIdQuery = `SELECT ISNULL(MAX(rating_id), 0) + 1 AS next_id FROM Ratings`;
      const nextIdResult = await executeQuery(nextIdQuery);
      const nextId = nextIdResult.recordset[0].next_id;

      const query = `
        INSERT INTO Ratings (rating_id, booking_id, reviewer_id, reviewee_id, rating, comment, created_at)
        OUTPUT INSERTED.*
        VALUES (@param1, @param2, @param3, @param4, @param5, @param6, GETDATE())
      `;
      const params = [
        nextId,
        booking_id,
        reviewer_id,
        reviewee_id,
        rating,
        comment,
      ];
      const result = await executeQuery(query, params);
      return result.recordset[0];
    } catch (error) {
      // Thông điệp thân thiện với lỗi trùng lặp (UNIQUE(booking_id, reviewer_id))
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
}

module.exports = Rating;
