const { executeQuery } = require('../config/database');

class TaskerApplication {
  static async findByStatus(status = 'Pending') {
    const res = await executeQuery("SELECT ta.*, u.name as user_name, u.email, u.phone FROM TaskerApplications ta JOIN Users u ON ta.user_id = u.user_id WHERE ta.status = @param1 ORDER BY ta.created_at ASC", [status]);
    return (res.recordset || []).map(row => TaskerApplication._hydrate(row));
  }
  static async findById(id) {
    const res = await executeQuery("SELECT ta.*, u.name as user_name, u.email, u.phone FROM TaskerApplications ta JOIN Users u ON ta.user_id = u.user_id WHERE ta.application_id = @param1", [id]);
    if (!res.recordset.length) return null; return TaskerApplication._hydrate(res.recordset[0]);
  }
  static async updateStatus(id, status, reviewerId, note = null) {
    await executeQuery("UPDATE TaskerApplications SET status=@param1, reviewed_at=SYSUTCDATETIME(), reviewer_id=@param2, note=@param3 WHERE application_id=@param4", [status, reviewerId, note, id]);
    return this.findById(id);
  }
  static async approve(id, reviewerId) { return this.updateStatus(id, 'Approved', reviewerId, null); }
  static async reject(id, reviewerId, note) { return this.updateStatus(id, 'Rejected', reviewerId, note || ''); }
  static _hydrate(row) {
    let variants = []; let certs = []; let video = null;
    try { if (row.variants_json) variants = JSON.parse(row.variants_json); } catch (_) { }
    try { if (row.certifications_json) certs = JSON.parse(row.certifications_json); } catch (_) { }
    try { if (row.video_json) video = JSON.parse(row.video_json); } catch (_) { }
    return { ...row, variants, certifications: certs, introduction_video: video };
  }
}

module.exports = TaskerApplication;
