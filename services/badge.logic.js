// Badge logic mapping: criteria_key -> calculator(userId) => numeric value
// Return numbers so that simple >= comparison with Badges.criteria_value works.
// For boolean-like checks, return 1 (true) or 0 (false).

const { executeQuery } = require('../config/database');

// Helper: safely extract single scalar from query result
function scalar(result, def = 0) {
  if (!result || !result.recordset || result.recordset.length === 0) return def;
  const row = result.recordset[0];
  const val = Object.values(row)[0];
  const num = Number(val);
  return Number.isNaN(num) ? def : num;
}

const BadgeLogicMap = {
  // 1) Số công việc đã hoàn thành
  async COMPLETED_JOBS(userId) {
    const q = `SELECT COUNT(*) AS cnt FROM Bookings WHERE tasker_id = @user_id AND status = N'Hoàn thành'`;
    const r = await executeQuery(q, { user_id: userId });
    return scalar(r, 0);
  },

  // 2) Đánh giá trung bình (lưu trong Taskers.rating)
  async AVERAGE_RATING(userId) {
    const q = `SELECT ISNULL(CAST(rating AS DECIMAL(10,2)), 0) AS rating FROM Taskers WHERE tasker_id = @user_id`;
    const r = await executeQuery(q, { user_id: userId });
    // rating có thể là decimal, vẫn trả về Number để so sánh >= criteria_value (có thể là 4.5, 4.8 ...)
    if (!r.recordset || r.recordset.length === 0) return 0;
    const val = r.recordset[0].rating;
    return Number(val) || 0;
  },

  // 3) Số lượng đánh giá 5 sao nhận được
  async RATING_5_STAR(userId) {
    const q = `SELECT COUNT(*) AS cnt FROM Ratings WHERE reviewee_id = @user_id AND rating = 5`;
    const r = await executeQuery(q, { user_id: userId });
    return scalar(r, 0);
  },

  // 4) Đã xác minh CCCD (Users.cccd_status = 'Đã xác minh')
  async VERIFIED_CCCD(userId) {
    const q = `
      SELECT CASE 
        WHEN UPPER(CONVERT(NVARCHAR(100), LTRIM(RTRIM(cccd_status)))) COLLATE SQL_Latin1_General_CP1_CI_AI LIKE N'%DA XAC MINH%'
          THEN 1 ELSE 0 
      END AS verified 
      FROM Users WHERE user_id = @user_id`;
    const r = await executeQuery(q, { user_id: userId });
    return scalar(r, 0);
  },

  // 5) Đã duyệt chứng chỉ (ít nhất 1 chứng chỉ Approved)
  async CERTIFIED_PRO(userId) {
    const q = `SELECT COUNT(*) AS cnt FROM TaskerCertifications WHERE tasker_id = @user_id AND status = 'Approved'`;
    const r = await executeQuery(q, { user_id: userId });
    return scalar(r, 0);
  },

  // 6) Không hủy cuốc (30 ngày): trả 1 nếu KHÔNG có bản ghi hủy trong 30 ngày gần nhất, ngược lại 0
  async NO_CANCELLATION_30D(userId) {
    // Note: Bookings không có updated_at, dùng booking_time để gần đúng thời điểm hủy.
    const q = `SELECT COUNT(*) AS cnt
              FROM Bookings
              WHERE tasker_id = @user_id
                AND status = N'Hủy'
                AND booking_time >= DATEADD(day, -30, SYSDATETIME())`;
    const r = await executeQuery(q, { user_id: userId });
    const cancels = scalar(r, 0);
    return cancels === 0 ? 1 : 0;
  },

  // 7) Số video đã đăng (đã duyệt), bỏ qua video bị xóa
  async VIDEO_CREATOR(userId) {
    const q = `SELECT COUNT(*) AS cnt FROM Videos WHERE user_id = @user_id AND ISNULL(is_deleted, 0) = 0 AND status = 'Approved'`;
    const r = await executeQuery(q, { user_id: userId });
    return scalar(r, 0);
  },

  // 8) Số người yêu thích (Wishlist.favorite_taskers là JSON array các tasker_id)
  async FAVORITED_BY(userId) {
    // Hỗ trợ nhiều định dạng:
    // - JSON array các số: [12, 34]
    // - JSON array chuỗi số: ["12","34"]
    // - JSON array object: [{"tasker_id":12}, {"id":34}]
    // - Chuỗi không phải JSON (ví dụ: "12, 34" hoặc "[12,34]") → chuẩn hóa rồi LIKE có dấu phân cách để tránh trùng tiền tố
    const qRobust = `
      DECLARE @uid NVARCHAR(20) = CAST(@user_id AS NVARCHAR(20));
      
      ;WITH JSONMatches AS (
        SELECT 1 AS m
        FROM Wishlist
        WHERE ISJSON(favorite_taskers) = 1
          AND EXISTS (
            SELECT 1
            FROM OPENJSON(favorite_taskers)
                 WITH (
                   id_int INT '$',
                   id1   INT '$.tasker_id',
                   id2   INT '$.id',
                   id_str NVARCHAR(100) '$'
                 ) j
            WHERE COALESCE(j.id_int, j.id1, j.id2, TRY_CAST(j.id_str AS INT)) = @user_id
          )
      ), StringMatches AS (
        SELECT 1 AS m
        FROM Wishlist
        WHERE ISJSON(favorite_taskers) = 0
          AND (
            ',' + 
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(CAST(favorite_taskers AS NVARCHAR(MAX)), '[',''),
                ']',''), '"',''), ' ','')
            + ','
          ) LIKE '%,' + @uid + ',%'
      )
      SELECT (SELECT COUNT(*) FROM JSONMatches) + (SELECT COUNT(*) FROM StringMatches) AS cnt;`;

    try {
      const r = await executeQuery(qRobust, { user_id: userId });
      return scalar(r, 0);
    } catch (e) {
      // Fallback cuối cùng: LIKE đơn giản (kém chính xác hơn)
      const likeStr = `%${userId}%`;
      const qLike = `SELECT COUNT(*) AS cnt FROM Wishlist WHERE CAST(favorite_taskers AS NVARCHAR(MAX)) LIKE @likeStr`;
      const r2 = await executeQuery(qLike, { likeStr });
      return scalar(r2, 0);
    }
  },
};

module.exports = BadgeLogicMap;
