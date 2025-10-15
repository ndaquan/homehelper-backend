#!/usr/bin/env node
// Backfill parsed_* and base columns for TaskerCertifications
// Usage: node scripts/backfill_certifications.js
// Idempotent: runs safe updates only when target columns null.

require('dotenv').config();
const { executeQuery, connectDB, closeDB } = require('../config/database');

(async () => {
  try {
    await connectDB();
    console.log('🔧 Starting certifications backfill');

    // 1. Add ai_detected_service column if missing (defensive)
    try {
      await executeQuery("IF COL_LENGTH('TaskerCertifications','ai_detected_service') IS NULL ALTER TABLE TaskerCertifications ADD ai_detected_service NVARCHAR(120) NULL;");
      console.log('✅ Ensured ai_detected_service column exists');
    } catch (e) { console.warn('⚠️ Could not ensure ai_detected_service column:', e.message); }

    // 2. Backfill parsed_* from base where parsed null
    const updates = [
      { parsed: 'parsed_cert_name', base: 'cert_name' },
      { parsed: 'parsed_issued_by', base: 'issued_by' },
      { parsed: 'parsed_issued_date', base: 'issued_date' }
    ];
    for (const u of updates) {
      const q = `UPDATE TaskerCertifications SET ${u.parsed} = ${u.base} WHERE ${u.parsed} IS NULL AND ${u.base} IS NOT NULL`;
      const result = await executeQuery(q);
      console.log(`✅ Backfilled ${u.parsed} from ${u.base}. Rows affected:`, result.rowsAffected[0]);
    }

    // 3. Optionally backfill base from parsed if base null
    const reverse = [
      { parsed: 'parsed_cert_name', base: 'cert_name' },
      { parsed: 'parsed_issued_by', base: 'issued_by' },
      { parsed: 'parsed_issued_date', base: 'issued_date' }
    ];
    for (const r of reverse) {
      const q = `UPDATE TaskerCertifications SET ${r.base} = ${r.parsed} WHERE ${r.base} IS NULL AND ${r.parsed} IS NOT NULL`;
      const result = await executeQuery(q);
      console.log(`✅ Backfilled ${r.base} from ${r.parsed}. Rows affected:`, result.rowsAffected[0]);
    }

    console.log('🎉 Backfill complete');
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
})();
