const { executeQuery } = require("../config/database");

class Tasker {
  //  tìm tất cả tasker với dịch vụ kèm theo
  static async findAll(search = "", serviceId = "") {
    try {
      let query = `
      SELECT 
        t.tasker_id,
        u.name AS tasker_name,
        t.Introduce AS Introduce,
        t.certifications,
        t.status,
        ISNULL(r.avg_rating, 0) AS rating,
        ISNULL(r.review_count, 0) AS reviewsCount,
        s.service_id,
        s.name AS service_name,
        sv.variant_id,
        sv.variant_name,
        sv.price_min,
        sv.price_max,
        sv.unit
      FROM Taskers t
      JOIN Users u ON t.tasker_id = u.user_id
      LEFT JOIN TaskerServiceVariants tsv ON t.tasker_id = tsv.tasker_id
      LEFT JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
      LEFT JOIN Services s ON sv.service_id = s.service_id
      LEFT JOIN (
        SELECT reviewee_id,
               AVG(CAST(rating AS FLOAT)) AS avg_rating,
               COUNT(*) AS review_count
        FROM Ratings
        GROUP BY reviewee_id
      ) r ON t.tasker_id = r.reviewee_id
      WHERE 1=1
    `;

      const params = [];
      let paramIndex = 1;

      if (search) {
        query += ` AND (u.name LIKE @param${paramIndex} OR s.name LIKE @param${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (serviceId) {
        query += ` AND s.service_id = @param${paramIndex}`;
        params.push(serviceId);
        paramIndex++;
      }

      query += ` ORDER BY t.tasker_id`;

      const result = await executeQuery(query, params);
      const rows = result.recordset || [];

      // Group dữ liệu taskers -> services -> variants
      const taskersMap = {};

      rows.forEach((row) => {
        if (!taskersMap[row.tasker_id]) {
          taskersMap[row.tasker_id] = {
            tasker_id: row.tasker_id,
            name: row.tasker_name,
            Introduce: row.Introduce,
            certifications: row.certifications,
            rating: parseFloat(row.rating),
            reviewsCount: row.reviewsCount,
            status: row.status,
            services: [],
          };
        }

        if (row.service_id) {
          let service = taskersMap[row.tasker_id].services.find(
            (s) => s.service_id === row.service_id
          );

          if (!service) {
            service = {
              service_id: row.service_id,
              name: row.service_name,
              variants: [],
            };
            taskersMap[row.tasker_id].services.push(service);
          }

          if (row.variant_id) {
            service.variants.push({
              variant_id: row.variant_id,
              variant_name: row.variant_name,
              price_min: row.price_min,
              price_max: row.price_max,
              unit: row.unit,
            });
          }
        }
      });

      return Object.values(taskersMap);
    } catch (err) {
      console.error("Lỗi findAll Taskers:", err);
      return [];
    }
  }
  // lấy tasker theo id

  static async findById(id) {
    try {
      const query = `
        SELECT *
        FROM Users
        WHERE role = 'Tasker' AND user_id = @param1
      `;
      const result = await executeQuery(query, [id]);
      if (!result.recordset.length) return null;
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi lấy tasker theo ID: ${error.message}`);
    }
  }

  // lấy tasker kèm reviews
  static async findByIdWithReviews(id) {
    try {
      const tasker = await this.findById(id);
      if (!tasker) return null;

      const reviewsQuery = `
      SELECT 
        r.rating_id AS id,
        r.reviewer_id,
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

      const reviewsResult = await executeQuery(reviewsQuery, [id]);
      const reviews = reviewsResult.recordset.map((r) => ({
        id: r.id,
        name: r.reviewer_name, // tên người đánh giá
        rating: r.rating,
        text: r.text,
        date: r.date,
        service: r.service_name, // tên dịch vụ
        verified: true,
        helpful: 0,
      }));

      tasker.reviews = reviews;

      tasker.rating = tasker.reviews.length
        ? parseFloat(
            (
              tasker.reviews.reduce((sum, r) => sum + r.rating, 0) /
              tasker.reviews.length
            ).toFixed(1)
          )
        : 0;

      tasker.reviewCount = tasker.reviews.length;

      return tasker; // chỉ trả dữ liệu, không gọi res.json ở đây
    } catch (error) {
      throw new Error(`Lỗi lấy tasker với reviews: ${error.message}`);
    }
  }
}

module.exports = Tasker;
