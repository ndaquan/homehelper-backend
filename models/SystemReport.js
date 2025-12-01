const { executeQuery, executeNonQuery } = require('../config/database');
const ImageEncryption = require('../utils/imageEncryption');

class SystemReport {
    // Tạo báo cáo mới
    static async create(data) {
        try {
            const { user_id, title, description, image_url } = data;

            // Encrypt image URL before saving
            const encrypted_image_url = image_url ? ImageEncryption.encrypt(image_url) : null;

            const query = `
        INSERT INTO SystemReports (user_id, title, description, image_url, status, created_at, updated_at)
        OUTPUT INSERTED.*
        VALUES (@user_id, @title, @description, @image_url, 'Pending', GETDATE(), GETDATE())
      `;

            const result = await executeQuery(query, { user_id, title, description, image_url: encrypted_image_url });
            return result.recordset[0];
        } catch (error) {
            throw new Error(`Lỗi tạo báo cáo: ${error.message}`);
        }
    }

    // Lấy tất cả báo cáo (có phân trang và filter)
    static async findAll(page = 1, limit = 10, status = null) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            const params = { limit, offset };

            if (status) {
                whereClause = 'WHERE r.status = @status';
                params.status = status;
            }

            const query = `
        SELECT r.*, u.name as user_name, u.email as user_email, u.phone as user_phone
        FROM SystemReports r
        JOIN Users u ON r.user_id = u.user_id
        ${whereClause}
        ORDER BY r.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

            const countQuery = `
        SELECT COUNT(*) as total
        FROM SystemReports r
        ${whereClause}
      `;

            const [reports, countResult] = await Promise.all([
                executeQuery(query, params),
                executeQuery(countQuery, status ? { status } : {})
            ]);

            // Decrypt image URLs for display
            const decryptedReports = reports.recordset.map(report => ({
                ...report,
                image_url: report.image_url ? ImageEncryption.decrypt(report.image_url) : null
            }));

            return {
                reports: decryptedReports,
                total: countResult.recordset[0].total,
                page,
                limit,
                totalPages: Math.ceil(countResult.recordset[0].total / limit)
            };
        } catch (error) {
            throw new Error(`Lỗi lấy danh sách báo cáo: ${error.message}`);
        }
    }

    // Lấy chi tiết báo cáo
    static async findById(report_id) {
        try {
            const query = `
        SELECT r.*, u.name as user_name, u.email as user_email, u.phone as user_phone
        FROM SystemReports r
        JOIN Users u ON r.user_id = u.user_id
        WHERE r.report_id = @report_id
      `;

            const result = await executeQuery(query, { report_id });
            const report = result.recordset[0];

            // Decrypt image URL
            if (report && report.image_url) {
                report.image_url = ImageEncryption.decrypt(report.image_url);
            }

            return report;
        } catch (error) {
            throw new Error(`Lỗi lấy chi tiết báo cáo: ${error.message}`);
        }
    }

    // Cập nhật trạng thái
    static async updateStatus(report_id, status) {
        try {
            const query = `
        UPDATE SystemReports
        SET status = @status, updated_at = GETDATE()
        OUTPUT INSERTED.*
        WHERE report_id = @report_id
      `;

            const result = await executeQuery(query, { report_id, status });
            return result.recordset[0];
        } catch (error) {
            throw new Error(`Lỗi cập nhật trạng thái: ${error.message}`);
        }
    }
}

module.exports = SystemReport;
