const { executeQuery } = require("../config/database");
const { getReliabilityColor, getReliabilityLabel } = require("../utils/reliability");

class Tasker {
  //  tìm tất cả tasker với dịch vụ kèm theo
  static async findAll(search = "", serviceId = "") {
    try {
      console.log('🔍 Tasker.findAll called with:', { search, serviceId });

      const params = [];
      let paramIndex = 1;

      // Build WHERE conditions
      // Always filter: only active taskers, not banned users
      let whereClause = `WHERE u.is_banned = 0 AND (t.status IS NULL OR t.status = 'Active')`;
      
      // Search condition - only search in tasker name to avoid filtering out taskers without services
      if (search && search.trim()) {
        // Case-insensitive search - SQL Server LIKE is case-insensitive by default for NVARCHAR
        // But we'll use UPPER() to ensure case-insensitive matching
        whereClause += ` AND UPPER(u.name) LIKE UPPER(@param${paramIndex})`;
        params.push(`%${search.trim()}%`);
        paramIndex++;
        console.log(`🔍 Search condition added: "${search.trim()}"`);
      }

      // Service filter - use EXISTS to filter taskers that have this service
      if (serviceId) {
        whereClause += ` AND EXISTS (
          SELECT 1 FROM TaskerServiceVariants tsv2
          INNER JOIN ServiceVariants sv2 ON tsv2.variant_id = sv2.variant_id
          WHERE tsv2.tasker_id = t.tasker_id AND sv2.service_id = @param${paramIndex}
        )`;
        params.push(serviceId);
        paramIndex++;
        console.log(`🔍 Service filter added: serviceId=${serviceId}`);
      }

      let query = `
      SELECT 
        t.tasker_id,
        u.name AS tasker_name,
        t.Introduce AS Introduce,
        t.certifications,
        t.status,
        ISNULL(t.rating, 0) AS rating,
        ISNULL(t.reliability_score, 100) AS reliability_score,
        ISNULL(rc.review_count, 0) AS reviewsCount,
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
        SELECT reviewee_id, COUNT(*) AS review_count
        FROM Ratings
        GROUP BY reviewee_id
      ) rc ON t.tasker_id = rc.reviewee_id
      ${whereClause}
      ORDER BY t.tasker_id
    `;

      console.log('🔍 SQL Query:', query);
      console.log('🔍 SQL Params:', params);
      
      const result = await executeQuery(query, params);
      const rows = result.recordset || [];
      
      console.log('📊 Raw rows from DB:', rows.length);
      if (rows.length > 0) {
        console.log('📊 First row:', rows[0]);
        console.log('📊 Sample tasker names:', rows.slice(0, 5).map(r => r.tasker_name));
      } else {
        console.log('⚠️ No rows returned from query');
      }

      // Group dữ liệu taskers -> services -> variants
      const taskersMap = {};

      rows.forEach((row) => {
        if (!taskersMap[row.tasker_id]) {
          const score = row.reliability_score || 0;
          taskersMap[row.tasker_id] = {
            tasker_id: row.tasker_id,
            name: row.tasker_name,
            Introduce: row.Introduce,
            certifications: row.certifications,
            rating: parseFloat(row.rating),
            reviewsCount: row.reviewsCount,
            status: row.status,
            reliability_score: score,
            reliability_color: getReliabilityColor(score),
            reliability_label: getReliabilityLabel(score),
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

      const taskersArray = Object.values(taskersMap);
      console.log('📊 Taskers after grouping:', taskersArray.length);
      if (taskersArray.length > 0) {
        console.log('📊 First tasker after grouping:', JSON.stringify(taskersArray[0], null, 2));
      } else {
        console.log('⚠️ No taskers after grouping - check if database has taskers');
        // Debug: Check if there are any taskers in database
        const checkQuery = `SELECT COUNT(*) as count FROM Taskers t JOIN Users u ON t.tasker_id = u.user_id WHERE u.is_banned = 0`;
        const checkResult = await executeQuery(checkQuery);
        console.log('📊 Total taskers in DB (not banned):', checkResult.recordset[0]?.count || 0);
      }

      return taskersArray;
    } catch (err) {
      console.error("Lỗi findAll Taskers:", err);
      return [];
    }
  }

  // Cập nhật trạng thái hoạt động của tasker
  static async updateStatus(taskerId, status) {
    console.log("🔥 [DEBUG] updateStatus() CALLED:", { taskerId, status });
    console.log("📌 [Stack]\n", new Error().stack);

    // 👇 DÙNG ENUM ĐÚNG VỚI DATABASE
    const ALLOWED = ["Active", "Inactive", "Banned"];

    if (!ALLOWED.includes(status)) {
      console.error("❌ [ERROR] Status KHÔNG hợp lệ:", status);
      return false; // chặn lại không cho chạy xuống SQL
    }

    const query = `UPDATE Taskers SET status = @param1 WHERE tasker_id = @param2`;
    console.log("🔵 SQL RUN:", query, [status, taskerId]);

    await executeQuery(query, [status, taskerId]);
    return true;
  }

  // Lấy danh sách tasker theo variant_id (liên kết qua TaskerServiceVariants)
  static async findByVariant(variantId) {
    try {
      const query = `
        SELECT 
          t.tasker_id,
          u.name AS tasker_name,
          u.email AS email,
          t.Introduce AS Introduce,
          t.certifications,
          t.status,
          ISNULL(t.rating, 0) AS rating,
          ISNULL(t.reliability_score, 100) AS reliability_score,
          ISNULL(rc.review_count, 0) AS reviewsCount,
          s.service_id,
          s.name AS service_name,
          sv.variant_id,
          sv.variant_name,
          sv.price_min,
          sv.price_max,
          sv.unit
        FROM Taskers t
        JOIN Users u ON t.tasker_id = u.user_id
        JOIN TaskerServiceVariants tsv ON t.tasker_id = tsv.tasker_id
        JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
        JOIN Services s ON sv.service_id = s.service_id
        LEFT JOIN (
          SELECT reviewee_id, COUNT(*) AS review_count
          FROM Ratings
          GROUP BY reviewee_id
        ) rc ON t.tasker_id = rc.reviewee_id
        WHERE sv.variant_id = @param1
        ORDER BY t.tasker_id`;

      const result = await executeQuery(query, [variantId]);
      const rows = result.recordset || [];

      const taskersMap = {};
      rows.forEach((row) => {
        if (!taskersMap[row.tasker_id]) {
          const score = row.reliability_score || 0;
          taskersMap[row.tasker_id] = {
            tasker_id: row.tasker_id,
            name: row.tasker_name,
            Introduce: row.Introduce,
            certifications: row.certifications,
            rating: parseFloat(row.rating),
            reviewsCount: row.reviewsCount,
            email: row.email,
            status: row.status,
            reliability_score: score,
            reliability_color: getReliabilityColor(score),
            reliability_label: getReliabilityLabel(score),
            services: [],
          };
        }

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
        service.variants.push({
          variant_id: row.variant_id,
          variant_name: row.variant_name,
          price_min: row.price_min,
          price_max: row.price_max,
          unit: row.unit,
        });
      });

      return Object.values(taskersMap);
    } catch (err) {
      console.error('Lỗi findByVariant Taskers:', err);
      return [];
    }
  }

  // lấy tasker theo id

  static async findById(id) {
    try {
      const query = `
        SELECT *
        FROM Users u
        JOIN Taskers t ON t.tasker_id = u.user_id
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
  static async getUserLocation(userId) {
    const result = await executeQuery(
      `SELECT TOP 1 lat, lng 
       FROM Addresses 
       WHERE user_id = @userId`,
      { userId }
    );
    return result.recordset && result.recordset.length > 0 ? result.recordset[0] : null;
  }

  // Lấy danh sách Tasker với khoảng cách từ vị trí user
  static async getTaskersWithDistance(userLat, userLng) {
    const result = await executeQuery(
      `SELECT 
         u.user_id, 
         u.name, 
         u.email, 
         u.phone, 
         a.address, 
         a.lat, 
         a.lng,
         ( 6371 * acos( 
           cos( radians(@userLat) ) * cos( radians( a.lat ) ) * cos( radians( a.lng ) - radians(@userLng) ) + 
           sin( radians(@userLat) ) * sin( radians( a.lat ) ) 
         ) ) AS distance_km
       FROM Users u
       INNER JOIN Addresses a ON u.user_id = a.user_id
       WHERE u.role = 'Tasker'
       ORDER BY distance_km ASC`,
      { userLat, userLng }
    );
    return result.recordset;
  }

  static async findByIdWithServices(taskerId) {
    const query = `
    SELECT 
      t.tasker_id,
      u.name,
      u.email,
      u.phone,
      s.service_id,
      s.name AS service_name,
      sv.variant_id,
      sv.variant_name,
      sv.pricing_type,
      sv.price_min,
      sv.price_max,
      sv.unit
    FROM Taskers t
    JOIN Users u ON t.tasker_id = u.user_id
    LEFT JOIN TaskerServiceVariants tsv ON t.tasker_id = tsv.tasker_id
    LEFT JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
    LEFT JOIN Services s ON sv.service_id = s.service_id
    WHERE t.tasker_id = @param1
  `;
    const result = await executeQuery(query, [taskerId]);

    if (!result.recordset.length) return null;

    const servicesMap = new Map();

    result.recordset.forEach((row) => {
      if (!servicesMap.has(row.service_id)) {
        servicesMap.set(row.service_id, {
          service_id: row.service_id,
          service_name: row.service_name,
          variants: [],
        });
      }

      if (row.variant_id) {
        servicesMap.get(row.service_id).variants.push({
          variant_id: row.variant_id,
          variant_name: row.variant_name,
          pricing_type: row.pricing_type,
          price_min: row.price_min,
          price_max: row.price_max,
          unit: row.unit,
        });
      }
    });

    return {
      tasker_id: result.recordset[0].tasker_id,
      name: result.recordset[0].name,
      email: result.recordset[0].email,
      phone: result.recordset[0].phone,
      services: Array.from(servicesMap.values()),
    };
  }
}

module.exports = Tasker;
