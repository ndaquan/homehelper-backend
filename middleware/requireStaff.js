module.exports = function requireStaff(req, res, next) {
  try {
    const rawRole = (req.user && (req.user.role || req.user.roleName)) || '';
    if (!rawRole) return res.status(401).json({ success:false, message:'Unauthorized' });
    const role = String(rawRole).toLowerCase();
    if (role === 'staff' || role === 'admin') return next();
    return res.status(403).json({ success:false, message:'Yêu cầu quyền Staff' });
  } catch (e) {
    return res.status(500).json({ success:false, message:'Middleware error', error:e.message });
  }
};