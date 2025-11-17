// Nightly badge job: scan users and grant badges if they meet criteria
const { executeQuery, executeNonQuery } = require('../config/database');
const BadgeLogicMap = require('./badge.logic');

async function fetchAllUsers() {
  const r = await executeQuery(`SELECT user_id FROM Users`);
  return (r.recordset || []).map((x) => x.user_id);
}

async function fetchActiveBadges() {
  const r = await executeQuery(`SELECT badge_id, criteria_key, criteria_value FROM Badges WHERE is_active = 1`);
  return r.recordset || [];
}

async function fetchOwnedBadgesSet() {
  const r = await executeQuery(`SELECT user_id, badge_id FROM UserBadges`);
  const set = new Set();
  (r.recordset || []).forEach((row) => set.add(`${row.user_id}_${row.badge_id}`));
  return set;
}

async function grantBadge(userId, badgeId) {
  await executeNonQuery(
    `INSERT INTO UserBadges (user_id, badge_id) VALUES (@user_id, @badge_id)`,
    { user_id: userId, badge_id: badgeId }
  );
}

async function runBadgeScanOnce() {
  const startedAt = new Date();
  console.log(`[Badges] 🔎 Bắt đầu quét huy hiệu: ${startedAt.toLocaleString('vi-VN')}`);

  const [users, badges, ownedSet] = await Promise.all([
    fetchAllUsers(),
    fetchActiveBadges(),
    fetchOwnedBadgesSet(),
  ]);

  let granted = 0;
  let checked = 0;
  for (const userId of users) {
    for (const badge of badges) {
      checked++;
      const key = `${userId}_${badge.badge_id}`;
      if (ownedSet.has(key)) continue; // đã có

      const calcFn = BadgeLogicMap[badge.criteria_key];
      if (!calcFn) continue; // không hỗ trợ key này

      try {
        const actualValue = await calcFn(userId);
        if (Number(actualValue) >= Number(badge.criteria_value)) {
          await grantBadge(userId, badge.badge_id);
          ownedSet.add(key);
          granted++;
        }
      } catch (err) {
        console.error(`[Badges] Lỗi tính ${badge.criteria_key} cho user ${userId}:`, err.message || err);
      }
    }
  }

  const finishedAt = new Date();
  const seconds = ((finishedAt - startedAt)/1000).toFixed(1);
  console.log(`[Badges] ✅ Hoàn thành quét huy hiệu. Cấp mới: ${granted}. Kiểm tra: ${checked}. Thời gian: ${seconds}s`);
  return { granted, checked, startedAt, finishedAt, durationSeconds: Number(seconds) };
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
