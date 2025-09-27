const { executeQuery } = require("../config/database");

class Wishlist {
  // Lấy wishlist cơ bản của customer
  static async getByCustomerId(customerId) {
    const query = `
      SELECT customer_id, favorite_taskers
      FROM Wishlist
      WHERE customer_id = @param1
    `;
    const result = await executeQuery(query, [customerId]);
    return result?.recordset[0] || null;
  }

  // Lấy wishlist kèm chi tiết tasker
  static async getByCustomerIdWithDetails(customerId) {
    const wishlist = await this.getByCustomerId(customerId);
    if (!wishlist || !wishlist.favorite_taskers) return [];

    const taskerIds = wishlist.favorite_taskers
      .split(",")
      .map((id) => Number(id))
      .filter(Boolean);

    if (!taskerIds.length) return [];

    const placeholders = taskerIds.map((_, i) => `@param${i + 1}`).join(",");
    const query = `
      SELECT t.tasker_id, u.name, t.rating
      FROM Taskers t
      JOIN Users u ON t.tasker_id = u.user_id
      WHERE t.tasker_id IN (${placeholders})
    `;

    const result = await executeQuery(query, taskerIds);
    return result.recordset || [];
  }

  // Xóa một tasker khỏi wishlist
  static async removeTasker(customer_id, taskerId) {
    const wishlist = await this.getByCustomerId(customer_id);
    if (!wishlist || !wishlist.favorite_taskers) return null;

    const taskers = wishlist.favorite_taskers
      .split(",")
      .map(Number)
      .filter((id) => id !== taskerId);

    return this.upsert({ customer_id, favorite_taskers: taskers });
  }

  // Thêm tasker vào wishlist
  static async addTasker(customer_id, taskerId) {
    // Lấy danh sách hiện tại
    const wishlist = await this.getByCustomerId(customer_id);
    let taskers = [];
    if (wishlist && wishlist.favorite_taskers) {
      taskers = wishlist.favorite_taskers.split(",").map(Number).filter(Boolean);
    }
    // Thêm tasker mới nếu chưa có
    if (!taskers.includes(Number(taskerId))) {
      taskers.push(Number(taskerId));
    }
    // Cập nhật lại wishlist
    return this.upsert({ customer_id, favorite_taskers: taskers });
  }
  //Cập nhật  wishlist
  static async upsert({ customer_id, favorite_taskers }) {
    const taskers = Array.isArray(favorite_taskers)
      ? favorite_taskers.join(",")
      : favorite_taskers;

    const query = `
      MERGE Wishlist AS target
      USING (SELECT @param1 AS customer_id) AS source
      ON target.customer_id = source.customer_id
      WHEN MATCHED THEN 
        UPDATE SET favorite_taskers = @param2
      WHEN NOT MATCHED THEN
        INSERT (customer_id, favorite_taskers)
        VALUES (@param1, @param2)
      OUTPUT inserted.*;
    `;
    const result = await executeQuery(query, [customer_id, taskers]);
    return result.recordset[0];
  }
}

module.exports = Wishlist;
