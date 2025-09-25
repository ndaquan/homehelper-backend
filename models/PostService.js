const { executeQuery } = require('../config/database');

class PostService {
  constructor(data) {
    this.post_service_id = data.post_service_id;
    this.post_id = data.post_id;
    this.service_id = data.service_id;
    this.variant_id = data.variant_id;
    this.desired_price = data.desired_price;
    this.notes = data.notes;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Optionally: Thêm các trường từ Service/ServiceVariants nếu cần
    this.service_name = data.service_name;
    this.description = data.description;
    this.base_price = data.base_price;
    this.category = data.category;
    this.unit = data.unit;
    this.variant_name = data.variant_name;
    this.pricing_type = data.pricing_type;
    this.price_min = data.price_min;
    this.price_max = data.price_max;
  }

  // Tạo post service mới
  static async create(postServiceData) {
    const {
      post_id,
      service_id,
      variant_id = null,
      desired_price = null,
      notes = null
    } = postServiceData;

    let final_desired_price = desired_price;
    if (final_desired_price == null && variant_id != null) {
      // Lấy specific_price từ ServiceVariants
      const priceQuery = 'SELECT specific_price FROM ServiceVariants WHERE variant_id = @param1';
      try {
        const priceResult = await executeQuery(priceQuery, [variant_id]);
        if (priceResult.recordset && priceResult.recordset.length > 0) {
          final_desired_price = priceResult.recordset[0].specific_price;
        }
      } catch (e) {
        // Nếu lỗi vẫn cho phép tạo, desired_price sẽ là null
        console.error('Không lấy được specific_price từ ServiceVariants:', e.message);
      }
    }

    try {
      // Detect whether post_service_id is an IDENTITY column
      const identityCheckQuery = `SELECT COLUMNPROPERTY(OBJECT_ID('PostServices'), 'post_service_id', 'IsIdentity') AS is_identity`;
      const identityResult = await executeQuery(identityCheckQuery);
      const isIdentity = identityResult.recordset && identityResult.recordset[0] && identityResult.recordset[0].is_identity === 1;

      if (isIdentity) {
        // Standard insert relying on IDENTITY
        const insertQuery = `
          INSERT INTO PostServices (post_id, service_id, variant_id, desired_price, notes)
          VALUES (@param1, @param2, @param3, @param4, @param5);
          SELECT SCOPE_IDENTITY() AS post_service_id;
        `;
        const result = await executeQuery(insertQuery, [post_id, service_id, variant_id, final_desired_price, notes]);
        const serviceId = result.recordset[0].post_service_id;
        return await PostService.findById(serviceId);
      } else {
        // No IDENTITY on post_service_id: compute next id and insert explicitly
        const nextIdQuery = `SELECT ISNULL(MAX(post_service_id), 0) + 1 AS next_id FROM PostServices`;
        const nextIdResult = await executeQuery(nextIdQuery);
        const nextId = nextIdResult.recordset[0].next_id;

        const insertQuery = `
          INSERT INTO PostServices (post_service_id, post_id, service_id, variant_id, desired_price, notes)
          VALUES (@param1, @param2, @param3, @param4, @param5, @param6);
        `;
        await executeQuery(insertQuery, [nextId, post_id, service_id, variant_id, final_desired_price, notes]);
        return await PostService.findById(nextId);
      }
    } catch (error) {
      throw new Error(`Error creating post service: ${error.message}`);
    }
  }

  // Tạo nhiều post services cùng lúc
  static async createMultiple(postId, services) {
    const results = [];
    for (const service of services) {
      const result = await PostService.create({
        post_id: postId,
        service_id: service.service_id,
        variant_id: service.variant_id,
        desired_price: service.desired_price,
        notes: service.notes
      });
      results.push(result);
    }
    return results;
  }

  // Tìm post service theo ID
  static async findById(id) {
    const query = `
      SELECT ps.*, s.name as service_name, s.description,
             v.variant_name, v.pricing_type, v.price_min, v.price_max, v.unit, v.specific_price
      FROM PostServices ps
      LEFT JOIN Services s ON ps.service_id = s.service_id
      LEFT JOIN ServiceVariants v ON ps.variant_id = v.variant_id
      WHERE ps.post_service_id = @param1
    `;
    try {
      const result = await executeQuery(query, [id]);
      if (!result.recordset || result.recordset.length === 0) return null;
      return new PostService(result.recordset[0]);
    } catch (error) {
      throw new Error(`Error finding post service: ${error.message}`);
    }
  }

  // Lấy danh sách services của một bài đăng
  static async findByPostId(postId) {
    const query = `
      SELECT ps.*, s.name as service_name, s.description,
             v.variant_name, v.pricing_type, v.price_min, v.price_max, v.unit, v.specific_price
      FROM PostServices ps
      LEFT JOIN Services s ON ps.service_id = s.service_id
      LEFT JOIN ServiceVariants v ON ps.variant_id = v.variant_id
      WHERE ps.post_id = @param1
      ORDER BY ps.post_service_id ASC
    `;
    try {
      const result = await executeQuery(query, [postId]);
      return result.recordset.map(row => {
        const service = new PostService(row);
        service.tag = row.service_name || null;
        return service;
      });
    } catch (error) {
      throw new Error(`Error finding post services: ${error.message}`);
    }
  }

  // Lấy danh sách posts có chứa một service cụ thể
  static async findByServiceId(serviceId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const query = `
      SELECT ps.post_service_id, ps.post_id, ps.service_id, ps.variant_id, ps.desired_price, ps.notes,
             p.title as post_title, p.content as post_content, p.post_date, p.status,
             u.name as author_name, s.name as service_name, s.description
      FROM PostServices ps
      LEFT JOIN Posts p ON ps.post_id = p.post_id
      LEFT JOIN Users u ON p.user_id = u.user_id
      LEFT JOIN Services s ON ps.service_id = s.service_id
      WHERE ps.service_id = @param1 AND (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
      ORDER BY p.post_date DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    try {
      const result = await executeQuery(query, [serviceId]);
      const postServices = result.recordset.map(row => new PostService(row));

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM PostServices ps
        LEFT JOIN Posts p ON ps.post_id = p.post_id
        WHERE ps.service_id = @param1 AND (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
      `;
      const countResult = await executeQuery(countQuery, [serviceId]);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        postServices,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      throw new Error(`Error finding posts by service: ${error.message}`);
    }
  }

  // Lấy thống kê services được yêu cầu nhiều nhất
  static async getPopularServices(limit = 10) {
    const query = `
      SELECT TOP ${limit} s.service_id, s.name as service_name, s.description,
             COUNT(ps.post_service_id) as request_count,
             AVG(ps.desired_price) as avg_desired_price,
             MIN(ps.desired_price) as min_desired_price,
             MAX(ps.desired_price) as max_desired_price
      FROM Services s
      LEFT JOIN PostServices ps ON s.service_id = ps.service_id
      LEFT JOIN Posts p ON ps.post_id = p.post_id
      WHERE (p.status = 'Approved' OR p.status = N'Đã phê duyệt' OR p.status IS NULL)
      GROUP BY s.service_id, s.name, s.description
      ORDER BY request_count DESC
    `;
    try {
      const result = await executeQuery(query);
      return result.recordset;
    } catch (error) {
      throw new Error(`Error getting popular services: ${error.message}`);
    }
  }

  // Lấy thống kê giá cả theo service
  static async getPriceStats(serviceId) {
    const query = `
      SELECT 
        COUNT(*) as total_requests,
        AVG(desired_price) as avg_price,
        MIN(desired_price) as min_price,
        MAX(desired_price) as max_price
      FROM PostServices ps
      LEFT JOIN Services s ON ps.service_id = s.service_id
      LEFT JOIN Posts p ON ps.post_id = p.post_id
      WHERE ps.service_id = @param1 AND (p.status = 'Approved' OR p.status = N'Đã phê duyệt') AND ps.desired_price IS NOT NULL
    `;
    try {
      const result = await executeQuery(query, [serviceId]);
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Error getting price stats: ${error.message}`);
    }
  }

  // Cập nhật post service
  async update(updateData) {
    const allowedFields = ['desired_price', 'notes'];
    
    const updates = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = @param${values.length + 1}`);
        values.push(value);
      }
    }
    
    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }
    
  values.push(this.post_service_id);
  const query = `UPDATE PostServices SET ${updates.join(', ')} WHERE post_service_id = @param${values.length}`;
    
    try {
      await executeQuery(query, values);
      return await PostService.findById(this.post_service_id);
    } catch (error) {
      throw new Error(`Error updating post service: ${error.message}`);
    }
  }

  // Xóa post service
  async delete() {
    const query = 'DELETE FROM PostServices WHERE post_service_id = @param1';
    try {
      const result = await executeQuery(query, [this.post_service_id]);
      
      if (result.rowsAffected[0] === 0) {
        throw new Error('Post service không tồn tại');
      }
      
      return true;
    } catch (error) {
      throw new Error(`Error deleting post service: ${error.message}`);
    }
  }

  // Xóa tất cả services của một post
  static async deleteByPostId(postId) {
    const query = 'DELETE FROM PostServices WHERE post_id = @param1';
    try {
      await executeQuery(query, [postId]);
      return true;
    } catch (error) {
      throw new Error(`Error deleting post services: ${error.message}`);
    }
  }

  // Lấy thống kê tổng quan
  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total_post_services,
        COUNT(DISTINCT ps.post_id) as posts_with_services,
        COUNT(DISTINCT ps.service_id) as unique_services_requested,
        AVG(ps.desired_price) as avg_desired_price
      FROM PostServices ps
      LEFT JOIN Posts p ON ps.post_id = p.post_id
      WHERE (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
    `;
    try {
      const result = await executeQuery(query);
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Error getting post service stats: ${error.message}`);
    }
  }

  // Tìm kiếm posts theo service và giá
  static async searchByServiceAndPrice(serviceId, minPrice = null, maxPrice = null, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ps.post_service_id, ps.post_id, ps.service_id, ps.variant_id, ps.desired_price, ps.notes,
             p.title as post_title, p.content as post_content, p.post_date,
             u.name as author_name, s.name as service_name, s.description
      FROM PostServices ps
      LEFT JOIN Posts p ON ps.post_id = p.post_id
      LEFT JOIN Users u ON p.user_id = u.user_id
      LEFT JOIN Services s ON ps.service_id = s.service_id
      WHERE ps.service_id = @param1 AND (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
    `;
    const params = [serviceId];

    if (minPrice !== null) {
      query += ' AND ps.desired_price >= @param' + (params.length + 1);
      params.push(minPrice);
    }

    if (maxPrice !== null) {
      query += ' AND ps.desired_price <= @param' + (params.length + 1);
      params.push(maxPrice);
    }

    query += ` ORDER BY p.post_date DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    
    try {
      const result = await executeQuery(query, params);
      const postServices = result.recordset.map(row => new PostService(row));

      // Get total count
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM PostServices ps
        LEFT JOIN Posts p ON ps.post_id = p.post_id
        WHERE ps.service_id = @param1 AND (p.status = 'Approved' OR p.status = N'Đã phê duyệt')
      `;
      const countParams = [serviceId];

      if (minPrice !== null) {
        countQuery += ' AND ps.desired_price >= @param' + (countParams.length + 1);
        countParams.push(minPrice);
      }

      if (maxPrice !== null) {
        countQuery += ' AND ps.desired_price <= @param' + (countParams.length + 1);
        countParams.push(maxPrice);
      }

      const countResult = await executeQuery(countQuery, countParams);
      const total = countResult.recordset[0].total;
      const totalPages = Math.ceil(total / limit);

      return {
        postServices,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      throw new Error(`Error searching post services: ${error.message}`);
    }
  }
}

module.exports = PostService;