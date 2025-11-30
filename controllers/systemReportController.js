const SystemReport = require('../models/SystemReport');

class SystemReportController {
    // User tạo báo cáo
    static async createReport(req, res) {
        try {
            const user_id = req.user.user_id; // Lấy từ token
            const { title, description, image_url } = req.body;

            if (!title || !description) {
                return res.status(400).json({ error: 'Vui lòng nhập tiêu đề và mô tả' });
            }

            const report = await SystemReport.create({
                user_id,
                title,
                description,
                image_url
            });

            res.status(201).json({
                message: 'Gửi báo cáo thành công',
                report
            });
        } catch (error) {
            console.error('Lỗi tạo báo cáo:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Admin lấy danh sách báo cáo
    static async getAllReports(req, res) {
        try {
            const { page = 1, limit = 10, status } = req.query;

            const result = await SystemReport.findAll(
                parseInt(page),
                parseInt(limit),
                status
            );

            res.status(200).json({
                message: 'Lấy danh sách báo cáo thành công',
                ...result
            });
        } catch (error) {
            console.error('Lỗi lấy danh sách báo cáo:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // Admin cập nhật trạng thái
    static async updateReportStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!['Pending', 'In Progress', 'Resolved', 'Rejected'].includes(status)) {
                return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
            }

            const report = await SystemReport.updateStatus(id, status);

            if (!report) {
                return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
            }

            res.status(200).json({
                message: 'Cập nhật trạng thái thành công',
                report
            });
        } catch (error) {
            console.error('Lỗi cập nhật trạng thái:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = SystemReportController;
