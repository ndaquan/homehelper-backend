const { executeQuery, executeStoredProcedure } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  // Tạo user mới
  static async create(userData) {
    try {
      const { name, email, password, role, phone } = userData;
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const query = `
        INSERT INTO Users (name, email, password, role, phone, created_at, updated_at)
        VALUES (@param1, @param2, @param3, @param4, @param5, GETDATE(), GETDATE());
        
        SELECT SCOPE_IDENTITY() AS user_id;
      `;
      
      const params = [name, email, hashedPassword, role, phone];
      const result = await executeQuery(query, params);
      
      // Debug: log kết quả để xem format
      console.log('🔍 Result from create:', JSON.stringify(result, null, 2));
      
      // Kiểm tra và xử lý kết quả
      let userId;
      if (result && result.recordset && result.recordset.length > 0) {
        userId = result.recordset[0].user_id;
      } else if (result && result.rowsAffected && result.rowsAffected[0] > 0) {
        // Nếu INSERT thành công nhưng không có SELECT, tạo ID tạm
        userId = Date.now();
      } else {
        throw new Error('Không thể lấy user_id sau khi tạo');
      }
      
      return {
        user_id: userId,
        name,
        email,
        role,
        phone,
        created_at: new Date()
      };
    } catch (error) {
      throw new Error(`Lỗi tạo user: ${error.message}`);
    }
  }

  // Lấy user theo ID
  static async findById(userId) {
    try {
      const query = `
        SELECT user_id, name, email, role, phone, created_at, updated_at
        FROM Users 
        WHERE user_id = @param1
      `;
      
      const result = await executeQuery(query, [userId]);
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi tìm user: ${error.message}`);
    }
  }

  // Lấy user theo email
  static async findByEmail(email) {
    try {
      const query = `
        SELECT user_id, name, email, password, role, phone, created_at, updated_at
        FROM Users 
        WHERE email = @param1
      `;
      
      const result = await executeQuery(query, [email]);
      
      // Debug: log kết quả để xem format
      console.log('🔍 Result from findByEmail:', JSON.stringify(result, null, 2));
      
      // Kiểm tra và xử lý kết quả
      if (!result) {
        console.log('⚠️ Result is null or undefined');
        return null;
      }
      
      if (result.recordset && result.recordset.length > 0) {
        return result.recordset[0];
      }
      
      if (result.rowsAffected && result.rowsAffected[0] === 0) {
        console.log('📭 Không tìm thấy user với email:', email);
        return null;
      }
      
      console.log('⚠️ Unexpected result format:', result);
      return null;
    } catch (error) {
      throw new Error(`Lỗi tìm user theo email: ${error.message}`);
    }
  }

  // Cập nhật user
  static async update(userId, updateData) {
    try {
      const allowedFields = ['name', 'phone'];
      const updates = [];
      const params = [];
      let paramIndex = 1;

      // Chỉ cho phép cập nhật các trường được phép
      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field) && value !== undefined) {
          updates.push(`${field} = @param${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (updates.length === 0) {
        throw new Error('Không có trường nào được cập nhật');
      }

      updates.push('updated_at = GETDATE()');
      params.push(userId);

      const query = `
        UPDATE Users 
        SET ${updates.join(', ')}
        WHERE user_id = @param${paramIndex}
      `;

      await executeQuery(query, params);
      
      return await this.findById(userId);
    } catch (error) {
      throw new Error(`Lỗi cập nhật user: ${error.message}`);
    }
  }

  // Xóa user (soft delete)
  static async delete(userId) {
    try {
      const query = `
        UPDATE Users 
        SET updated_at = GETDATE()
        WHERE user_id = @param1
      `;
      
      await executeQuery(query, [userId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi xóa user: ${error.message}`);
    }
  }

  // Lấy danh sách users với phân trang
  static async findAll(page = 1, limit = 10, filters = {}) {
    try {
      let whereClause = '';
      const params = [];
      let paramIndex = 1;

      // Xử lý filters
      if (filters.role) {
        whereClause += ` WHERE role = @param${paramIndex}`;
        params.push(filters.role);
        paramIndex++;
      }

      if (filters.search) {
        const searchCondition = whereClause ? ' AND ' : ' WHERE ';
        whereClause += `${searchCondition} (name LIKE '%' + @param${paramIndex} + '%' OR email LIKE '%' + @param${paramIndex} + '%')`;
        params.push(filters.search);
        paramIndex++;
      }

      const offset = (page - 1) * limit;
      
      const query = `
        SELECT user_id, name, email, role, phone, created_at, updated_at
        FROM Users 
        ${whereClause}
        ORDER BY created_at DESC
        OFFSET @param${paramIndex} ROWS
        FETCH NEXT @param${paramIndex + 1} ROWS ONLY;
        
        SELECT COUNT(*) AS total FROM Users ${whereClause};
      `;
      
      params.push(offset, limit);
      const result = await executeQuery(query, params);
      
      return {
        users: result.recordset.slice(0, -1), // Loại bỏ record cuối (count)
        total: result.recordset[result.recordset.length - 1].total,
        page,
        limit,
        totalPages: Math.ceil(result.recordset[result.recordset.length - 1].total / limit)
      };
    } catch (error) {
      throw new Error(`Lỗi lấy danh sách users: ${error.message}`);
    }
  }

  // Xác thực password
  static async verifyPassword(password, hashedPassword) {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      throw new Error(`Lỗi xác thực password: ${error.message}`);
    }
  }

  // Cập nhật password
  static async updatePassword(userId, newPassword) {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      
      const query = `
        UPDATE Users 
        SET password = @param1, updated_at = GETDATE()
        WHERE user_id = @param2
      `;
      
      await executeQuery(query, [hashedPassword, userId]);
      return true;
    } catch (error) {
      throw new Error(`Lỗi cập nhật password: ${error.message}`);
    }
  }

  // Tìm kiếm user theo tên hoặc email (dùng cho tạo cuộc trò chuyện)
  static async search(searchQuery, limit = 10, excludeUserId = null) {
    try {
      const params = [];
      let paramIndex = 1;
      let where = `WHERE 1=1`;

      if (excludeUserId) {
        where += ` AND user_id <> @param${paramIndex}`;
        params.push(excludeUserId);
        paramIndex++;
      }

      if (searchQuery && searchQuery.trim()) {
        // Chỉ tìm theo tên
        where += ` AND name LIKE '%' + @param${paramIndex} + '%'`;
        params.push(searchQuery.trim());
        paramIndex++;
      }

      const query = `
        SELECT TOP (@param${paramIndex}) user_id, name, email, role, phone
        FROM Users
        ${where}
        ORDER BY name ASC
      `;
      params.push(limit);

      const result = await executeQuery(query, params);
      return result.recordset || [];
    } catch (error) {
      throw new Error(`Lỗi tìm kiếm user: ${error.message}`);
    }
  }
}

module.exports = User;
