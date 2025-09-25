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
}

module.exports = TaskerProfileController;
