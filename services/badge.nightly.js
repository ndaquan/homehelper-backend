// Nightly badge job: scan users and grant badges if they meet criteria
const { executeQuery } = require('../config/database');
const BadgeLogicMap = require('./badge.logic');

async function fetchAllUsers() {
  // Only scan accounts that are Taskers (exist in Taskers table)
  const r = await executeQuery(`
    SELECT u.user_id, u.name
    FROM Users u
    INNER JOIN Taskers t ON t.tasker_id = u.user_id
  `);
  const rows = r.recordset || [];
  return {
    ids: rows.map(x => x.user_id),
    map: new Map(rows.map(x => [x.user_id, { name: x.name }]))
  };
}

async function fetchActiveBadges() {
  const r = await executeQuery(`SELECT badge_id, name, icon_url, criteria_key, criteria_value FROM Badges WHERE is_active = 1`);
  const rows = r.recordset || [];
  return {
    rows,
    map: new Map(rows.map(b => [b.badge_id, { name: b.name, icon_url: b.icon_url, criteria_key: b.criteria_key, criteria_value: b.criteria_value }]))
  };
}

async function fetchOwnedBadgesSet() {
  const r = await executeQuery(`SELECT user_id, badge_id FROM UserBadges`);
  const set = new Set();
  (r.recordset || []).forEach((row) => set.add(`${row.user_id}_${row.badge_id}`));
  return set;
}

async function grantBadge(userId, badgeId) {
  // Use OUTPUT to return DB-recorded earned_at timestamp
  const r = await executeQuery(
    `INSERT INTO UserBadges (user_id, badge_id)
     OUTPUT INSERTED.earned_at
     VALUES (@user_id, @badge_id)`,
    { user_id: userId, badge_id: badgeId }
  );
  const earned_at = (r.recordset && r.recordset[0] && r.recordset[0].earned_at) || null;
  return earned_at;
}

async function runBadgeScanOnce() {
  const startedAt = new Date();
  console.log(`[Badges] 🔎 Bắt đầu quét huy hiệu: ${startedAt.toLocaleString('vi-VN')}`);

  const [{ ids: userIds, map: userMap }, { rows: activeBadges, map: badgeMap }, ownedSet] = await Promise.all([
    fetchAllUsers(),
    fetchActiveBadges(),
    fetchOwnedBadgesSet(),
  ]);


  let granted = 0;
  let checked = 0;
  const grants = [];
  for (const userId of userIds) {
    for (const badge of activeBadges) {
      checked++;
      const key = `${userId}_${badge.badge_id}`;
      if (ownedSet.has(key)) continue; // đã có

      const calcFn = BadgeLogicMap[badge.criteria_key];
      if (!calcFn) continue; // không hỗ trợ key này

      try {
        const actualValue = await calcFn(userId);
        if (Number(actualValue) >= Number(badge.criteria_value)) {
          const earned_at = await grantBadge(userId, badge.badge_id);
          ownedSet.add(key);
          granted++;
          const u = userMap.get(userId) || { name: null };
          const b = badgeMap.get(badge.badge_id) || { name: null, icon_url: null };
          grants.push({ user_id: userId, user_name: u.name, badge_id: badge.badge_id, badge_name: b.name, icon_url: b.icon_url, earned_at });
        }
      } catch (err) {
        console.error(`[Badges] Lỗi tính ${badge.criteria_key} cho user ${userId}:`, err.message || err);
      }
    }
  }

  const finishedAt = new Date();
  const seconds = ((finishedAt - startedAt)/1000).toFixed(1);
  console.log(`[Badges] ✅ Hoàn thành quét huy hiệu. Cấp mới: ${granted}. Kiểm tra: ${checked}. Thời gian: ${seconds}s`);
  return { granted, checked, startedAt, finishedAt, durationSeconds: Number(seconds), grants };
}

// Schedule helper: chạy mỗi ngày lúc 02:00 sáng (giờ hệ thống) mà không cần thư viện ngoài.
function scheduleDailyAt(hour = 2, minute = 0, jobFn = runBadgeScanOnce) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      // hôm nay đã qua 2:00 -> hẹn ngày mai
      next.setDate(next.getDate() + 1);
    }
    const delay = next - now;
    console.log(`[Badges] ⏰ Lên lịch chạy tiếp lúc ${next.toLocaleString('vi-VN')} (trong ${(delay/1000/60).toFixed(1)} phút)`);
    setTimeout(async () => {
      try {
        await jobFn();
      } finally {
        // Lên lịch cho lần tiếp theo sau khi chạy xong
        scheduleNext();
      }
    }, delay);
  };
  scheduleNext();
}

function startNightlyBadgeJob() {
  // Lên lịch chạy lúc 02:00 sáng hằng ngày
  scheduleDailyAt(2, 0, runBadgeScanOnce);
}

module.exports = {
  runBadgeScanOnce,
  startNightlyBadgeJob,
};
