const TaskerProfile = require("../models/TaskerProfile");

class TaskerProfileController {
  static async getById(req, res) {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "ID không hợp lệ" });

    try {
      const tasker = await TaskerProfile.findById(id);
      if (!tasker) return res.status(404).json({ message: "Tasker không tồn tại" });
      res.json(tasker);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  // Cập nhật profile tasker
  static async update(req, res) {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "ID không hợp lệ" });

    // Chỉ cho phép user cập nhật profile của chính mình
    if (req.user.userId !== parseInt(id)) {
      return res.status(403).json({ message: "Bạn không có quyền cập nhật profile này" });
    }

    try {
      const { name, phone, Introduce } = req.body;
      const updatedTasker = await TaskerProfile.update(id, { name, phone, Introduce });
      
      if (!updatedTasker) {
        return res.status(404).json({ message: "Tasker không tồn tại" });
      }

      res.json({
        success: true,
        message: "Cập nhật profile thành công",
        data: updatedTasker
      });
    } catch (err) {
      console.error("Update profile error:", err);
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = TaskerProfileController;
