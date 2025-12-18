const { executeQuery } = require("../config/database");

class AdminStatsController {
  static async getDashboardStats(req, res) {
    try {
      // 1. User counts by role
      const userCountsQuery = `
        SELECT role, COUNT(*) as count 
        FROM Users 
        GROUP BY role
      `;
      const userCounts = await executeQuery(userCountsQuery);

      // 2. Booking counts by status
      const bookingCountsQuery = `
        SELECT status, COUNT(*) as count 
        FROM Bookings 
        GROUP BY status
      `;
      const bookingCounts = await executeQuery(bookingCountsQuery);

      // 3. Revenue stats
      const revenueQuery = `
        SELECT 
          SUM(ISNULL(paid_amount, 0)) as total_revenue,
          SUM(ISNULL(paid_amount, 0) * 0.1) as total_income
        FROM Bookings
        WHERE status = N'Hoàn thành'
      `;
      const revenueStats = await executeQuery(revenueQuery);

      // 4. Recent bookings
      const recentBookingsQuery = `
        SELECT TOP 5
          b.booking_id,
          b.booking_time,
          b.status,
          b.paid_amount,
          b.expected_price,
          b.final_price,
          u.name as customer_name,
          s.name as service_name
        FROM Bookings b
        JOIN Users u ON b.customer_id = u.user_id
        JOIN Services s ON b.service_id = s.service_id
        ORDER BY b.booking_time DESC
      `;
      const recentBookings = await executeQuery(recentBookingsQuery);

      // 5. Service distribution
      const serviceStatsQuery = `
        SELECT TOP 5
          s.name,
          COUNT(b.booking_id) as booking_count
        FROM Services s
        LEFT JOIN Bookings b ON s.service_id = b.service_id
        GROUP BY s.name
        ORDER BY booking_count DESC
      `;
      const serviceStats = await executeQuery(serviceStatsQuery);

      // 6. Booking trends (last 14 days)
      const trendsQuery = `
        SELECT 
          CAST(booking_time AS DATE) as date,
          COUNT(*) as count,
          SUM(ISNULL(final_price, expected_price)) as revenue
        FROM Bookings
        WHERE booking_time >= DATEADD(day, -14, GETDATE())
        GROUP BY CAST(booking_time AS DATE)
        ORDER BY date ASC
      `;
      const trends = await executeQuery(trendsQuery);

      // 7. Complaint stats
      const complaintStatsQuery = `
        SELECT status, COUNT(*) as count 
        FROM CustomerComplaint 
        GROUP BY status
      `;
      const complaintStats = await executeQuery(complaintStatsQuery);

      // 8. Rating distribution
      const ratingDistQuery = `
        SELECT rating, COUNT(*) as count 
        FROM Ratings 
        GROUP BY rating
        ORDER BY rating DESC
      `;
      const ratingDist = await executeQuery(ratingDistQuery);

      // 9. Voucher stats
      const voucherStatsQuery = `
        SELECT 
          COUNT(*) as total_vouchers,
          SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used_vouchers
        FROM Vouchers
      `;
      const voucherStats = await executeQuery(voucherStatsQuery);

      res.status(200).json({
        success: true,
        data: {
          userCounts: userCounts.recordset,
          bookingCounts: bookingCounts.recordset,
          revenue: revenueStats.recordset[0],
          recentBookings: recentBookings.recordset,
          serviceStats: serviceStats.recordset,
          trends: trends.recordset,
          complaintStats: complaintStats.recordset,
          ratingDist: ratingDist.recordset,
          voucherStats: voucherStats.recordset[0]
        }
      });

    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  static async getFinancialDetails(req, res) {
    try {
      const vouchers = await executeQuery(`
        SELECT v.*, u.name as user_name
        FROM Vouchers v
        LEFT JOIN Users u ON v.user_id = u.user_id
        ORDER BY v.created_at DESC
      `);

      const walletTransactions = await executeQuery(`
        SELECT wt.*, u.name as user_name, u.email as user_email
        FROM WalletTransactions wt
        LEFT JOIN Users u ON wt.user_id = u.user_id
        ORDER BY wt.id DESC
      `);

      const momoTransactions = await executeQuery(`
        SELECT t.*, u.name as user_name, u.email as user_email
        FROM Transactions t
        LEFT JOIN Users u ON t.user_id = u.user_id
        ORDER BY t.created_at DESC
      `);

      const withdrawRequests = await executeQuery(`
        SELECT wr.*, u.name as user_name, u.email as user_email
        FROM WithdrawRequest wr
        LEFT JOIN Users u ON wr.user_id = u.user_id
        ORDER BY wr.created_at DESC
      `);

      res.status(200).json({
        success: true,
        data: {
          vouchers: vouchers.recordset,
          walletTransactions: walletTransactions.recordset,
          momoTransactions: momoTransactions.recordset,
          withdrawRequests: withdrawRequests.recordset
        }
      });
    } catch (error) {
      console.error("Error fetching financial details:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = AdminStatsController;
