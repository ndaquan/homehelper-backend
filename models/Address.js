const { executeQuery } = require('../config/database');

const Address = {
  // Add new method to check existing address
  hasExistingAddress: async (user_id) => {
    const query = `
      SELECT COUNT(*) as count 
      FROM Addresses 
      WHERE user_id = @param1
    `;
    const result = await executeQuery(query, [user_id]);
    return result.recordset[0].count > 0;
  },

  // Tạo địa chỉ mới
  create: async (user_id, address, lat, lng) => {
    // Check if user already has an address
    const hasAddress = await Address.hasExistingAddress(user_id);
    if (hasAddress) {
      throw new Error('User already has an address. Please update existing address instead.');
    }

    const query = `
      INSERT INTO Addresses (user_id, address, lat, lng, created_at, updated_at)
      OUTPUT INSERTED.*
      VALUES (@param1, @param2, @param3, @param4, GETDATE(), GETDATE())
    `;
    const params = [user_id, address, lat, lng];
    const result = await executeQuery(query, params);
    return result.recordset[0];
  },

  // Tìm địa chỉ theo user_id
  findByUserId: async (user_id) => {
    const query = `
      SELECT * FROM Addresses WHERE user_id = @param1
    `;
    const params = [user_id];
    const result = await executeQuery(query, params);
    return result.recordset;
  },

  // Tìm địa chỉ theo address_id
  findById: async (address_id) => {
    const query = `
      SELECT * FROM Addresses WHERE address_id = @param1
    `;
    const params = [address_id];
    const result = await executeQuery(query, params);
    return result.recordset[0];
  },

  // Cập nhật địa chỉ
  update: async (address_id, address, lat, lng) => {
    const query = `
      UPDATE Addresses
      SET address = @param1, lat = @param2, lng = @param3, updated_at = GETDATE()
      OUTPUT INSERTED.*
      WHERE address_id = @param4
    `;
    const params = [address, lat, lng, address_id];
    const result = await executeQuery(query, params);
    return result.recordset[0];
  },

  // Xóa địa chỉ
  delete: async (address_id) => {
    const query = `
      DELETE FROM Addresses WHERE address_id = @param1
    `;
    const params = [address_id];
    await executeQuery(query, params);
  },

  // Lấy tất cả địa chỉ có tọa độ hợp lệ (cũ, giữ nguyên)
  findAllWithCoords: async () => {
    const query = `
      SELECT 
        a.address_id,
        a.user_id,
        a.address,
        a.lat,
        a.lng,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.cccd_status
      FROM Addresses a
      INNER JOIN Users u ON a.user_id = u.user_id
      WHERE a.lat != 0 AND a.lng != 0 AND u.role = 'Tasker'
    `;
    const result = await executeQuery(query);
    return result.recordset;
  },

  // Tìm địa chỉ của Tasker với filters: services (array service_id), min_rating
 findFilteredTaskerAddresses: async (min_rating = null, services = []) => {
    try {
      let conditions = [
        "a.lat != 0 AND a.lng != 0",
        "u.role = 'Tasker'"
      ];
      let params = [];

      let paramIndex = 1;

      // Filter rating
      if (min_rating !== null && !isNaN(min_rating)) {
        conditions.push(`t.rating >= @param${paramIndex}`);
        params.push(min_rating);
        paramIndex++;
      }

      // Filter services using EXISTS
      if (services.length > 0) {
        conditions.push(`EXISTS (
          SELECT 1 
          FROM TaskerServiceVariants tsv2
          INNER JOIN ServiceVariants sv2 ON tsv2.variant_id = sv2.variant_id
          WHERE tsv2.tasker_id = u.user_id 
          AND sv2.service_id IN (${services.map((_, i) => `@param${paramIndex + i}`).join(',')})
        )`);
        params.push(...services);
        paramIndex += services.length;
      }

      const whereClause = conditions.join(' AND ');

      const query = `
        SELECT 
          a.address_id,
          a.user_id,
          a.address,
          a.lat,
          a.lng,
          u.name,
          u.email,
          u.phone,
          u.role,
          u.cccd_status,
          t.rating,
          (
            SELECT JSON_QUERY((
              SELECT 
                sv.variant_id,
                sv.service_id,
                s.name AS service_name,
                sv.variant_name,
                sv.pricing_type,
                sv.specific_price,
                sv.unit
              FROM TaskerServiceVariants tsv
              INNER JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
              INNER JOIN Services s ON sv.service_id = s.service_id
              WHERE tsv.tasker_id = t.tasker_id
              FOR JSON PATH
            ))
          ) AS service_variants
        FROM Addresses a
        INNER JOIN Users u ON a.user_id = u.user_id
        INNER JOIN Taskers t ON t.tasker_id = u.user_id
        WHERE ${whereClause}
      `;

      const result = await executeQuery(query, params);

      // Parse JSON strings to objects
      return result.recordset.map(record => ({
        ...record,
        service_variants: JSON.parse(record.service_variants || '[]')
      }));
    } catch (error) {
      console.error('Error in findFilteredTaskerAddresses:', error);
      throw error;
    }
  },
};

module.exports = Address;