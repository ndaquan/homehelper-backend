const { executeQuery } = require('../config/database');

class TaskerServiceVariants {
  // Thêm bản ghi cho tasker đăng ký dịch vụ/biến thể
  static async add(tasker_id, variant_id) {
    const query = `INSERT INTO TaskerServiceVariants (tasker_id, variant_id) VALUES (@param1, @param2)`;
    await executeQuery(query, [tasker_id, variant_id]);
    return { tasker_id, variant_id };
  }

  // Lấy danh sách dịch vụ/biến thể của tasker
  static async listByTasker(tasker_id) {
    const query = `SELECT * FROM TaskerServiceVariants WHERE tasker_id = @param1`;
    const result = await executeQuery(query, [tasker_id]);
    return result.recordset || [];
  }
}

module.exports = TaskerServiceVariants;
