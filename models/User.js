const { executeQuery, executeNonQuery } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  // Lấy user theo ID
  static async findById(userId) {
    try {
      const query = `
        SELECT user_id, name, email, role, phone, cccd_status, cccd_verified_at, created_at, updated_at
        FROM users 
        WHERE user_id = @userId
      `;
      
      const result = await executeQuery(query, { userId });
      
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
        SELECT user_id, name, email, password, role, phone, cccd_status, cccd_verified_at, created_at, updated_at
        FROM users 
        WHERE email = @email
      `;
      
      const result = await executeQuery(query, { email });
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Lỗi tìm user theo email: ${error.message}`);
    }
  }

  // Cập nhật user
  static async update(userId, updateData) {
    try {
      const allowedFields = ['name', 'phone', 'cccd_status', 'cccd_verified_at', 'cccd_verified_by'];
      const updates = [];
      const params = { userId };

      // Chỉ cho phép cập nhật các trường được phép
      for (const [field, value] of Object.entries(updateData)) {
        if (allowedFields.includes(field) && value !== undefined) {
          updates.push(`${field} = @${field}`);
          params[field] = value;
        }
      }

      if (updates.length === 0) {
        throw new Error('Không có trường nào được cập nhật');
      }

      updates.push('updated_at = GETDATE()');

      const query = `
        UPDATE users 
        SET ${updates.join(', ')}
        WHERE user_id = @userId
      `;

      await executeNonQuery(query, params);
      
      return await this.findById(userId);
    } catch (error) {
      throw new Error(`Lỗi cập nhật user: ${error.message}`);
    }
  }

  // Cập nhật thông tin user từ CCCD đã xác minh
  static async updateFromCCCD(userId, cccdData) {
    try {
      const {
        full_name,
        cccd_url
      } = cccdData;

      const query = `
        UPDATE users 
        SET 
          name = ISNULL(@full_name, name),
          cccd_status = 'Đã xác minh',
          cccd_verified_at = GETDATE(),
          cccd_url = ISNULL(@cccd_url, cccd_url),
          updated_at = GETDATE()
        WHERE user_id = @userId
      `;

      await executeNonQuery(query, { full_name, cccd_url, userId });
      
      return await this.findById(userId);
    } catch (error) {
      throw new Error(`Lỗi cập nhật user từ CCCD: ${error.message}`);
    }
  }

  // Lấy thông tin user với CCCD
  static async findByIdWithCCCD(userId) {
    try {
      const query = `
        SELECT 
          u.user_id, u.name, u.email, u.role, u.phone, 
          u.cccd_status, u.cccd_verified_at,
          cv.cccd_number, cv.full_name as cccd_full_name, cv.date_of_birth, cv.gender,
          cv.nationality, cv.place_of_origin, cv.place_of_residence,
          cv.verification_status, cv.created_at as cccd_created_at
        FROM users u
        LEFT JOIN cccd_verification cv ON u.user_id = cv.user_id
        WHERE u.user_id = @userId
        ORDER BY cv.created_at DESC
      `;
      
      const result = await executeQuery(query, { userId });
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];

    } catch (error) {
      throw new Error(`Lỗi lấy thông tin user với CCCD: ${error.message}`);
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

  // Tạo user mới
  static async create(userData) {
    try {
      const { name, email, password, role = 'Customer', phone } = userData;
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const query = `
        INSERT INTO users (name, email, password, role, phone, created_at, updated_at)
        OUTPUT INSERTED.user_id, INSERTED.name, INSERTED.email, INSERTED.role
        VALUES (@name, @email, @password, @role, @phone, GETDATE(), GETDATE())
      `;
      
      const result = await executeQuery(query, {
        name,
        email,
        password: hashedPassword,
        role,
        phone
      });
      
      // Kiểm tra kết quả trả về
      if (result.recordset && result.recordset.length > 0) {
        return result.recordset[0];
      } else {
        throw new Error('Không thể lấy thông tin user vừa tạo');
      }
    } catch (error) {
      throw new Error(`Lỗi tạo user: ${error.message}`);
    }
  }
}

module.exports = User;