const { executeQuery } = require("../config/database");

class ComplaintController {
    static async getAllComplaints(req, res) {
        try {
            console.log("🔍 [ComplaintController] Fetching all complaints...");
            const query = `
        SELECT 
            cc.complaint_id,
            cc.booking_id,
            cc.customer_id,
            cc.type,
            cc.description,
            cc.image_urls,
            cc.status,
            cc.created_at,
            cc.updated_at,
            u_cust.name as customer_name,
            s.name as service_name,
            sv.variant_name
        FROM CustomerComplaint cc
        LEFT JOIN Bookings b ON cc.booking_id = b.booking_id
        LEFT JOIN Users u_cust ON cc.customer_id = u_cust.user_id
        LEFT JOIN Services s ON b.service_id = s.service_id
        LEFT JOIN ServiceVariants sv ON b.variant_id = sv.variant_id
        ORDER BY cc.created_at DESC
      `;
            const result = await executeQuery(query);
            console.log(`✅ [ComplaintController] Found ${result.recordset?.length || 0} complaints`);
            res.json(result.recordset);
        } catch (error) {
            console.error("❌ Error fetching complaints:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    static async updateStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!['open', 'in_progress', 'resolved', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" });
            }

            const query = `
        UPDATE CustomerComplaint 
        SET status = @status, updated_at = GETDATE() 
        WHERE complaint_id = @id
      `;
            await executeQuery(query, { id, status });

            res.json({ success: true, message: "Cập nhật trạng thái khiếu nại thành công" });
        } catch (error) {
            console.error("❌ Error updating complaint status:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
}


module.exports = ComplaintController;
