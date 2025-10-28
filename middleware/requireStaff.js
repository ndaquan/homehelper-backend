module.exports = function requireStaff(req, res, next) {
  try {
    const role = req.user && req.user.role;
    if (!role) return res.status(401).json({ success:false, message:'Unauthorized' });
    if (role === 'Staff' || role === 'Admin') return next();
    return res.status(403).json({ success:false, message:'Yêu cầu quyền Staff' });
  } catch (e) {
    return res.status(500).json({ success:false, message:'Middleware error', error:e.message });
  }
};