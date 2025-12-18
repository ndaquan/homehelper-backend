
const { getPool, sql } = require('./config/database');
require('dotenv').config();

// Helper for Haversine
const haversine = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function debugSOSRadius() {
    try {
        const pool = await getPool();
        const service_id = 1; // Example Service

        // User location (Da Nang center approx)
        const userLat = 16.061034;
        const userLng = 108.226947;

        // Test Case 1: Tasker (ID 3) - 3 Phan Tu, Da Nang (~5km) -> Should Match
        // Test Case 2: Tasker (ID 1) - Hue (~80km) -> Should NOT Match

        // Check Tasker 3 Address
        const t3Addr = await pool.request().query("SELECT * FROM Addresses WHERE user_id = 3");
        if (t3Addr.recordset[0]) {
            console.log(`Tasker 3 Address: ${t3Addr.recordset[0].lat}, ${t3Addr.recordset[0].lng}`);
        }

        console.log(`\n--- TEST 3: SOS Broadcast Query Logic ---`);
        console.log(`Searching for Service ${service_id}, Center: (${userLat}, ${userLng}), Radius: 15km`);

        let query = `
        SELECT DISTINCT tsv.tasker_id, a.lat, a.lng
        FROM TaskerServiceVariants tsv
        JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
        JOIN Addresses a ON tsv.tasker_id = a.user_id
        WHERE sv.service_id = @sId
          AND a.lat != 0 AND a.lng != 0
          AND (6371000 * 2 * ATN2(SQRT(
            SIN(RADIANS(a.lat - @lat)/2) * SIN(RADIANS(a.lat - @lat)/2) + 
            COS(RADIANS(@lat)) * COS(RADIANS(a.lat)) * 
            SIN(RADIANS(a.lng - @lng)/2) * SIN(RADIANS(a.lng - @lng)/2)
          ), SQRT(1 - (
            SIN(RADIANS(a.lat - @lat)/2) * SIN(RADIANS(a.lat - @lat)/2) + 
            COS(RADIANS(@lat)) * COS(RADIANS(a.lat)) * 
            SIN(RADIANS(a.lng - @lng)/2) * SIN(RADIANS(a.lng - @lng)/2)
          )))) <= 15000
    `;

        const result = await pool.request()
            .input('sId', sql.Int, service_id)
            .input('lat', sql.Float, userLat)
            .input('lng', sql.Float, userLng)
            .query(query);

        console.log('Matched Taskers:', result.recordset);

        if (result.recordset.some(r => r.tasker_id == 1)) {
            console.error('❌ FAILURE: Tasker 1 (Hue) matched despite being > 15km');
        } else {
            console.log('✅ SUCCESS: Tasker 1 (Hue) correctly excluded');
        }

        if (result.recordset.some(r => r.tasker_id == 3)) {
            console.log('✅ SUCCESS: Tasker 3 (Da Nang) correctly included');
        } else {
            console.warn('⚠️ WARNING: Tasker 3 not found (might not have service variants?)');
        }


    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

debugSOSRadius();
