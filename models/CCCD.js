const { executeQuery, executeNonQuery } = require('../config/database');

class CCCD {
  // Tạo bản ghi CCCD mới
  static async create(data) {
    try {
      const {
        user_id,
        cccd_number,
        full_name,
        date_of_birth,
        gender,
        nationality,
        place_of_origin,
        place_of_residence,
        issued_date,
        expiry_date,
        front_image_path,
        back_image_path,
        face_image_path,
        ocr_text_front,
        ocr_text_back,
        ocr_accuracy,
        verification_status,
        verified_at,
        verified_by
      } = data;

      // Chuyển đổi format ngày tháng cho SQL Server
      const convertDate = (dateStr) => {
        if (!dateStr) return null;
        
        try {
          // Chuyển từ dd/mm/yyyy sang yyyy-mm-dd
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            
            // Kiểm tra tính hợp lệ của ngày
            if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
              console.warn(`Ngày không hợp lệ: ${dateStr}`);
              return null; // Trả về null thay vì ngày không hợp lệ
            }
            
            // Tạo Date object để kiểm tra ngày có tồn tại không
            const date = new Date(year, month - 1, day);
            if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
              console.warn(`Ngày không tồn tại: ${dateStr}`);
              return null;
            }
            
            return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          }
        } catch (error) {
          console.error(`Lỗi chuyển đổi ngày: ${dateStr}`, error);
          return null;
        }
        
        return null;
      };

      const query = `
        INSERT INTO cccd_verification (
          user_id, cccd_number, full_name, date_of_birth, gender, nationality,
          place_of_origin, place_of_residence, issued_date, expiry_date,
          front_image_path, back_image_path, face_image_path,
          ocr_text_front, ocr_text_back, ocr_accuracy,
          verification_status, verified_at, verified_by,
          created_at, updated_at
        ) VALUES (
          @user_id, @cccd_number, @full_name, @date_of_birth, @gender, @nationality,
          @place_of_origin, @place_of_residence, @issued_date, @expiry_date,
          @front_image_path, @back_image_path, @face_image_path,
          @ocr_text_front, @ocr_text_back, @ocr_accuracy,
          @verification_status, @verified_at, @verified_by,
          GETDATE(), GETDATE()
        )
      `;

      const params = {
        user_id,
        cccd_number,
        full_name,
        date_of_birth: convertDate(date_of_birth),
        gender,
        nationality,
        place_of_origin,
        place_of_residence,
        issued_date: convertDate(issued_date),
        expiry_date: convertDate(expiry_date),
        front_image_path,
        back_image_path,
        face_image_path,
        ocr_text_front,
        ocr_text_back,
        ocr_accuracy,
        verification_status,
        verified_at,
        verified_by
      };

      const result = await executeNonQuery(query, params);
      console.log('📊 CCCD create result:', result);
      
      // Lấy bản ghi vừa tạo
      if (result && result.insertId) {
        const newRecord = await this.findById(result.insertId);
        console.log('📊 New CCCD record:', newRecord);
        return newRecord;
      } else {
        // Fallback: lấy bản ghi mới nhất của user
        console.log('⚠️ No insertId, getting latest record for user');
        const latestRecord = await this.findLatestByUserId(user_id);
        return latestRecord;
      }

    } catch (error) {
      throw new Error(`Lỗi tạo bản ghi CCCD: ${error.message}`);
    }
  }

  // Lấy CCCD theo user_id
  static async findByUserId(userId) {
    try {
      const query = `
        SELECT * FROM cccd_verification 
        WHERE user_id = @userId AND is_deleted = 0
        ORDER BY created_at DESC
      `;
      
      const result = await executeQuery(query, { userId });
      return result.recordset;

    } catch (error) {
      throw new Error(`Lỗi lấy CCCD theo user: ${error.message}`);
    }
  }

  // Lấy CCCD theo ID
  static async findById(id) {
    try {
      const query = `
        SELECT * FROM cccd_verification 
        WHERE id = @id AND is_deleted = 0
      `;
      
      const result = await executeQuery(query, { id });
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];

    } catch (error) {
      throw new Error(`Lỗi lấy CCCD theo ID: ${error.message}`);
    }
  }

  // Lấy CCCD mới nhất của user
  static async findLatestByUserId(userId) {
    try {
      const query = `
        SELECT TOP 1 * FROM cccd_verification 
        WHERE user_id = @userId AND is_deleted = 0
        ORDER BY created_at DESC
      `;
      
      const result = await executeQuery(query, { userId });
      
      if (result.recordset.length === 0) {
        return null;
      }
      
      return result.recordset[0];

    } catch (error) {
      throw new Error(`Lỗi lấy CCCD mới nhất: ${error.message}`);
    }
  }

  // Cập nhật trạng thái xác minh
  static async updateVerificationStatus(id, status, verifiedBy = null) {
    try {
      const query = `
        UPDATE cccd_verification 
        SET 
          verification_status = @status,
          verified_at = @verifiedAt,
          verified_by = @verifiedBy,
          updated_at = GETDATE()
        WHERE id = @id
      `;
      
      const verifiedAt = status === 'Verified' ? new Date().toISOString() : null;
      
      await executeNonQuery(query, { status, verifiedAt, verifiedBy, id });
      
      return await this.findById(id);

    } catch (error) {
      throw new Error(`Lỗi cập nhật trạng thái CCCD: ${error.message}`);
    }
  }

  // Kiểm tra user đã có CCCD được duyệt chưa
  static async hasVerifiedCCCD(userId) {
    try {
      const query = `
        SELECT TOP 1 * FROM cccd_verification 
        WHERE user_id = @userId AND verification_status = 'Verified' AND is_deleted = 0
        ORDER BY verified_at DESC
      `;
      const result = await executeQuery(query, { userId });
      return result.recordset && result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (error) {
      throw new Error(`Lỗi kiểm tra CCCD đã duyệt: ${error.message}`);
    }
  }

  // Lấy trạng thái CCCD của user
  static async getCCCDStatus(userId) {
    try {
      const query = `
        SELECT TOP 1 verification_status, verified_at, created_at 
        FROM cccd_verification 
        WHERE user_id = @userId AND is_deleted = 0
        ORDER BY created_at DESC
      `;
      const result = await executeQuery(query, { userId });
      if (!result.recordset || result.recordset.length === 0) {
        return { status: 'NotSubmitted', message: 'Chưa gửi CCCD' };
      }
      const r = result.recordset[0];
      return {
        status: r.verification_status,
        verified_at: r.verified_at,
        created_at: r.created_at,
        message:
          r.verification_status === 'Verified'
            ? 'CCCD đã được duyệt'
            : r.verification_status === 'Pending'
            ? 'CCCD đang chờ duyệt'
            : 'CCCD bị từ chối'
      };
    } catch (error) {
      throw new Error(`Lỗi lấy trạng thái CCCD: ${error.message}`);
    }
  }
}

module.exports = CCCD;