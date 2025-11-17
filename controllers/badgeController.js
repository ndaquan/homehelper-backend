const { executeQuery, executeNonQuery } = require('../config/database');

const ALLOWED_CRITERIA = new Set([
  'COMPLETED_JOBS',
  'AVERAGE_RATING',
  'RATING_5_STAR',
  'VERIFIED_CCCD',
  'CERTIFIED_PRO',
  'NO_CANCELLATION_30D',
  'VIDEO_CREATOR',
  'FAVORITED_BY'
]);

exports.listBadges = async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM Badges ORDER BY badge_id DESC');
    res.json({ data: result.recordset });
  } catch (e) {
    console.error('listBadges error', e);
    res.status(500).json({ error: 'Không lấy được danh sách huy hiệu' });
  }
};

const { uploadBadgeIcon } = require('../config/cloudinary');

exports.createBadge = async (req, res) => {
  try {
    const { name, description, criteria_key, criteria_value, is_active } = req.body || {};

    // Debug: log raw body keys and presence of file
    console.log('[createBadge] body keys:', Object.keys(req.body || {}));
    console.log('[createBadge] has file?', !!req.file);

    if (!name || !description || !criteria_key) {
      return res.status(400).json({ error: 'Thiếu trường bắt buộc' });
    }
    if (!ALLOWED_CRITERIA.has(criteria_key)) {
      return res.status(400).json({ error: 'Tiêu chí không hợp lệ' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Thiếu tệp icon (trường "icon")' });
    }

    // Safer numeric parsing (allow decimal for rating criteria)
    let valueNum = Number(criteria_value);
    if (Number.isNaN(valueNum)) valueNum = 0;

    const activeBit = (is_active === 'true' || is_active === true) ? 1 : 0;

    // Insert row first (SQL Server: use OUTPUT to reliably get inserted identity)
    const insertQuery = `INSERT INTO Badges (name, description, icon_url, criteria_key, criteria_value, is_active)
                         OUTPUT INSERTED.badge_id
                         VALUES (@name, @description, @icon_url, @criteria_key, @criteria_value, @is_active)`;
    const insertParams = {
      name: name.trim(),
      description: description.trim(),
      icon_url: null,
      criteria_key,
      criteria_value: valueNum,
      is_active: activeBit,
    };
    let badgeId = null;
    try {
      const insertResult = await executeQuery(insertQuery, insertParams);
      if (insertResult.recordset && insertResult.recordset.length) {
        badgeId = insertResult.recordset[0].badge_id;
      }
    } catch (insertErr) {
      console.error('[createBadge] insert error:', insertErr);
      return res.status(500).json({ error: 'Lỗi khi tạo bản ghi huy hiệu' });
    }
    if (!badgeId) {
      console.error('[createBadge] badgeId null after INSERT');
      return res.status(500).json({ error: 'Không lấy được badge_id sau khi tạo' });
    }

    try {
      const uploadResult = await uploadBadgeIcon(req.file.buffer, badgeId);
      const finalIconUrl = uploadResult.secure_url;
      await executeNonQuery('UPDATE Badges SET icon_url = @icon_url WHERE badge_id = @badge_id', {
        icon_url: finalIconUrl,
        badge_id: badgeId,
      });
      return res.status(201).json({ message: 'Tạo huy hiệu thành công', badge_id: badgeId, icon_url: finalIconUrl });
    } catch (uploadErr) {
      console.error('[createBadge] Cloudinary upload error:', uploadErr);
      // Rollback inserted badge to avoid orphan record without icon
      try {
        await executeNonQuery('DELETE FROM Badges WHERE badge_id = @badge_id', { badge_id: badgeId });
      } catch (rollbackErr) {
        console.error('[createBadge] rollback failed:', rollbackErr);
      }
      return res.status(500).json({ error: 'Upload icon thất bại' });
    }
  } catch (e) {
    console.error('createBadge error', e);
    res.status(500).json({ error: 'Không tạo được huy hiệu' });
  }
};

exports.updateBadge = async (req, res) => {
  try {
    const badgeId = Number(req.params.id);
    if (!badgeId) return res.status(400).json({ error: 'Thiếu badge_id' });

    const { name, description, criteria_key, criteria_value, is_active } = req.body || {};

    // Validate if criteria_key provided
    if (criteria_key && !ALLOWED_CRITERIA.has(criteria_key)) {
      return res.status(400).json({ error: 'Tiêu chí không hợp lệ' });
    }

    // Build dynamic update set
    const fields = [];
    const params = { badge_id: badgeId };
    if (typeof name === 'string') { fields.push('name = @name'); params.name = name.trim(); }
    if (typeof description === 'string') { fields.push('description = @description'); params.description = description.trim(); }
    if (typeof criteria_key === 'string') { fields.push('criteria_key = @criteria_key'); params.criteria_key = criteria_key; }
    if (criteria_value !== undefined) { const v = Number(criteria_value); fields.push('criteria_value = @criteria_value'); params.criteria_value = Number.isNaN(v) ? 0 : v; }
    if (is_active !== undefined) { const bit = (is_active === 'true' || is_active === true) ? 1 : 0; fields.push('is_active = @is_active'); params.is_active = bit; }

    // If icon file provided, upload then set icon_url
    if (req.file) {
      try {
        const up = await uploadBadgeIcon(req.file.buffer, badgeId);
        fields.push('icon_url = @icon_url');
        params.icon_url = up.secure_url;
      } catch (err) {
        console.error('[updateBadge] upload error:', err);
        return res.status(500).json({ error: 'Upload icon thất bại' });
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Không có trường nào để cập nhật' });
    }

    const sql = `UPDATE Badges SET ${fields.join(', ')} WHERE badge_id = @badge_id`;
    await executeNonQuery(sql, params);
    res.json({ message: 'Cập nhật huy hiệu thành công' });
  } catch (e) {
    console.error('updateBadge error', e);
    res.status(500).json({ error: 'Không cập nhật được huy hiệu' });
  }
};

exports.deleteBadge = async (req, res) => {
  try {
    const badgeId = Number(req.params.id);
    if (!badgeId) return res.status(400).json({ error: 'Thiếu badge_id' });
    await executeNonQuery('DELETE FROM Badges WHERE badge_id = @badge_id', { badge_id: badgeId });
    res.json({ message: 'Xóa huy hiệu thành công' });
  } catch (e) {
    console.error('deleteBadge error', e);
    res.status(500).json({ error: 'Không xóa được huy hiệu' });
  }
};
