const { executeQuery } = require('../config/database');
const { generateSignedCertificateUrl } = require('../config/cloudinary');

// GET /api/admin/taskers/summary
// Trả về danh sách tasker + dịch vụ (variants) + chứng chỉ
// Cấu trúc:
// [ { tasker_id, name, rating, variants: [ { variant_id, service_id, service_name, variant_name } ], certifications: [ { cert_id, cert_name, status, issued_by, cert_public_id, issued_date, parsed_holder_name, parsed_certificate_code, service_id, service_name } ] } ]
exports.summary = async (req, res) => {
  try {
    // 1. Lấy taskers (join Users để lấy name)
    const taskersResult = await executeQuery(`
      SELECT t.tasker_id, u.name, u.email, t.rating, t.status
      FROM Taskers t
      INNER JOIN Users u ON u.user_id = t.tasker_id
      ORDER BY t.tasker_id DESC`);
    const taskers = taskersResult.recordset || [];

    if (taskers.length === 0) {
      return res.json({ data: [] });
    }

    const idList = taskers.map(t => t.tasker_id).join(',');

    // 2. Lấy variants của các tasker
    const variantsResult = await executeQuery(`
      SELECT tsv.tasker_id, sv.variant_id, sv.service_id, sv.variant_name, s.name AS service_name
      FROM TaskerServiceVariants tsv
      INNER JOIN ServiceVariants sv ON sv.variant_id = tsv.variant_id
      INNER JOIN Services s ON s.service_id = sv.service_id
      WHERE tsv.tasker_id IN (${idList})
      ORDER BY tsv.tasker_id, sv.service_id`);
    const variantsRows = variantsResult.recordset || [];

    // 3. Lấy certifications của các tasker
    const certsResult = await executeQuery(`
      SELECT tc.tasker_id,
        tc.cert_id,
        tc.cert_name,
        tc.status,
        tc.issued_by,
        tc.service_id AS cert_service_id,
        s2.name AS cert_service_name,
        tc.cert_public_id,
        tc.issued_date,
        tc.parsed_holder_name,
        tc.parsed_certificate_code
      FROM TaskerCertifications tc
      LEFT JOIN Services s2 ON s2.service_id = tc.service_id
      WHERE tc.tasker_id IN (${idList})
      ORDER BY tc.tasker_id, tc.cert_id DESC`);
    const certRows = certsResult.recordset || [];

    // 4. Gom nhóm
    const variantMap = new Map();
    const serviceMap = new Map();
    variantsRows.forEach(v => {
      if (!variantMap.has(v.tasker_id)) variantMap.set(v.tasker_id, []);
      variantMap.get(v.tasker_id).push({
        variant_id: v.variant_id,
        service_id: v.service_id,
        service_name: v.service_name,
        variant_name: v.variant_name
      });

      // Build unique services per tasker
      if (!serviceMap.has(v.tasker_id)) serviceMap.set(v.tasker_id, new Map());
      const m = serviceMap.get(v.tasker_id);
      if (!m.has(v.service_id)) {
        m.set(v.service_id, { service_id: v.service_id, service_name: v.service_name });
      }
    });

    const certMap = new Map();
    certRows.forEach(c => {
      if (!certMap.has(c.tasker_id)) certMap.set(c.tasker_id, []);
      let signed = null;
      try {
        if (c.cert_public_id) {
          // Certificates may be image/pdf; use auto resource_type for safety
          signed = generateSignedCertificateUrl(c.cert_public_id, { resource_type: 'image', ttlSeconds: 3600 });
        }
      } catch (e) {
        // Fail silently; signed stays null
        signed = null;
      }
      certMap.get(c.tasker_id).push({
        cert_id: c.cert_id,
        cert_name: c.cert_name,
        status: c.status,
        issued_by: c.issued_by,
        service_id: c.cert_service_id || null,
        service_name: c.cert_service_name || null,
        cert_public_id: c.cert_public_id || null,
        issued_date: c.issued_date || null,
        parsed_holder_name: c.parsed_holder_name || null,
        parsed_certificate_code: c.parsed_certificate_code || null,
        cert_signed_preview_url: signed ? signed.url : null,
        cert_signed_expires_at: signed ? signed.expiresAt : null
      });
    });


    // 5. Lấy badges cho từng tasker (dùng UserBadges)
    const badgesResult = await executeQuery(`
      SELECT ub.user_id AS tasker_id, b.badge_id, b.name AS badge_name, b.icon_url, ub.earned_at
      FROM UserBadges ub
      INNER JOIN Badges b ON b.badge_id = ub.badge_id
      WHERE ub.user_id IN (${idList})
      ORDER BY ub.user_id, b.badge_id`);
    const badgeRows = badgesResult.recordset || [];
    const badgeMap = new Map();
    badgeRows.forEach(b => {
      if (!badgeMap.has(b.tasker_id)) badgeMap.set(b.tasker_id, []);
      badgeMap.get(b.tasker_id).push({
        badge_id: b.badge_id,
        badge_name: b.badge_name,
        icon_url: b.icon_url,
        earned_at: b.earned_at || null
      });
    });

    const data = taskers.map(t => ({
      tasker_id: t.tasker_id,
      name: t.name,
      email: t.email,
      rating: t.rating,
      status: t.status,
      variants: variantMap.get(t.tasker_id) || [],
      services: Array.from((serviceMap.get(t.tasker_id) || new Map()).values()),
      certifications: certMap.get(t.tasker_id) || [],
      badges: badgeMap.get(t.tasker_id) || []
    }));

    res.json({ data });
  } catch (e) {
    console.error('[adminTaskers.summary] error', e);
    res.status(500).json({ error: 'Không lấy được danh sách tasker', detail: e.message });
  }
};
