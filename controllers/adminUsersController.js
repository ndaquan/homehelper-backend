const { executeQuery } = require('../config/database');
const User = require('../models/User');

// Helper to ensure is_banned column exists (idempotent)
async function ensureBanColumns() {
  try {
    await executeQuery(`IF COL_LENGTH('users','is_banned') IS NULL ALTER TABLE users ADD is_banned BIT NOT NULL DEFAULT 0;`, []);
    await executeQuery(`IF COL_LENGTH('users','banned_at') IS NULL ALTER TABLE users ADD banned_at DATETIME NULL;`, []);
  } catch (e) {
    console.warn('[adminUsers] ensureBanColumns warn:', e.message);
  }
}

exports.listUsers = async (req, res) => {
  try {
    await ensureBanColumns();
    const { page = 1, pageSize = 20, search = '', role, order = 'created_at', dir = 'DESC' } = req.query;
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const offset = (p - 1) * ps;
    const params = [];
    let where = 'WHERE 1=1';
    if (search) {
      where += ' AND (u.name LIKE @param' + (params.length + 1) + ' OR u.email LIKE @param' + (params.length + 1) + ')';
      params.push('%' + search + '%');
    }
    if (role) {
      where += ' AND u.role = @param' + (params.length + 1);
      params.push(role);
    }
    const safeOrderCols = ['user_id','name','email','role','created_at','updated_at'];
    const orderCol = safeOrderCols.includes(order) ? order : 'created_at';
    const direction = /^(ASC|DESC)$/i.test(dir) ? dir : 'DESC';
    const dataQuery = `SELECT u.user_id, u.name, u.email, u.role, u.phone, u.is_banned, u.banned_at, u.created_at, u.updated_at
                       FROM users u
                       ${where}
                       ORDER BY ${orderCol} ${direction}
                       OFFSET ${offset} ROWS FETCH NEXT ${ps} ROWS ONLY`;
    const countQuery = `SELECT COUNT(1) AS total FROM users u ${where}`;
    const rows = await executeQuery(dataQuery, params);
    const totalRes = await executeQuery(countQuery, params);
    const total = totalRes.recordset[0].total;
    res.json({ success:true, data: rows.recordset, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total/ps) } });
  } catch (e) {
    console.error('listUsers error', e); res.status(500).json({ success:false, message:'Lỗi lấy danh sách user', error:e.message });
  }
};

exports.getUser = async (req, res) => {
  try {
    await ensureBanColumns();
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success:false, message:'Không tìm thấy user' });
    // Add ban columns if missing in model result
    const row = await executeQuery('SELECT is_banned, banned_at FROM users WHERE user_id=@param1', [req.params.id]);
    if (row.recordset.length) Object.assign(user, row.recordset[0]);
    res.json({ success:true, data:user });
  } catch (e) { res.status(500).json({ success:false, message:'Lỗi lấy user', error:e.message }); }
};

exports.updateUser = async (req, res) => {
  try {
    await ensureBanColumns();
    const { name, phone, role } = req.body || {};
    const userId = parseInt(req.params.id,10);
    const existing = await User.findById(userId);
    if (!existing) return res.status(404).json({ success:false, message:'Không tìm thấy user' });
    // Build dynamic update
    const fields = []; const params = [];
    if (name !== undefined) { fields.push('name=@param'+(params.length+1)); params.push(name); }
    if (phone !== undefined) { fields.push('phone=@param'+(params.length+1)); params.push(phone); }
    if (role !== undefined) { fields.push('role=@param'+(params.length+1)); params.push(role); }
    if (!fields.length) return res.status(400).json({ success:false, message:'Không có dữ liệu cập nhật' });
    fields.push('updated_at=GETDATE()');
    params.push(userId);
    const q = `UPDATE users SET ${fields.join(', ')} WHERE user_id=@param${params.length}`;
    await executeQuery(q, params);
    const updated = await User.findById(userId);
    const banInfo = await executeQuery('SELECT is_banned, banned_at FROM users WHERE user_id=@param1',[userId]);
    Object.assign(updated, banInfo.recordset[0]||{});
    res.json({ success:true, message:'Cập nhật thành công', data: updated });
  } catch (e) { console.error('updateUser error', e); res.status(500).json({ success:false, message:'Lỗi cập nhật user', error:e.message }); }
};

exports.banUser = async (req, res) => {
  try {
    await ensureBanColumns();
    const userId = parseInt(req.params.id,10);
    await executeQuery('UPDATE users SET is_banned=1, banned_at=GETDATE() WHERE user_id=@param1',[userId]);
    res.json({ success:true, message:'Đã ban user', data:{ user_id:userId, is_banned:1 } });
  } catch (e) { res.status(500).json({ success:false, message:'Lỗi ban user', error:e.message }); }
};

exports.unbanUser = async (req, res) => {
  try {
    await ensureBanColumns();
    const userId = parseInt(req.params.id,10);
    await executeQuery('UPDATE users SET is_banned=0, banned_at=NULL WHERE user_id=@param1',[userId]);
    res.json({ success:true, message:'Đã gỡ ban user', data:{ user_id:userId, is_banned:0 } });
  } catch (e) { res.status(500).json({ success:false, message:'Lỗi gỡ ban user', error:e.message }); }
};

exports.deleteUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id,10);
    await executeQuery('DELETE FROM users WHERE user_id=@param1',[userId]);
    res.json({ success:true, message:'Đã xoá user', data:{ user_id:userId } });
  } catch (e) { res.status(500).json({ success:false, message:'Lỗi xoá user', error:e.message }); }
};
