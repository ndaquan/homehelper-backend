
const { getPool, sql } = require('./config/database');
require('dotenv').config();

async function debugSOS() {
    try {
        const pool = await getPool();
        const taskerId = 3; // From prompt context

        console.log(`--- Checking Variants for Tasker ${taskerId} ---`);
        const taskerVariants = await pool.request()
            .input('tid', sql.Int, taskerId)
            .query(`
        SELECT tsv.*, sv.variant_name, s.name as service_name, s.service_id 
        FROM TaskerServiceVariants tsv
        JOIN ServiceVariants sv ON tsv.variant_id = sv.variant_id
        JOIN Services s ON sv.service_id = s.service_id
        WHERE tsv.tasker_id = @tid
      `);
        console.table(taskerVariants.recordset);

        console.log(`\n--- Checking Recent SOS Bookings ---`);
        const sosBookings = await pool.request()
            .query(`
        SELECT TOP 5 booking_id, customer_id, tasker_id, variant_id, status, type, sos_expires_at, booking_time 
        FROM Bookings 
        WHERE type = 'SOS' 
        ORDER BY booking_time DESC
      `);
        // console.table(sosBookings.recordset);

        if (sosBookings.recordset.length > 0) {
            const lastBooking = sosBookings.recordset[0];
            console.log(`\n--- Analyzing Match for Booking #${lastBooking.booking_id} ---`);

            // Get Service ID for the booking's variant
            const bookingVariantRes = await pool.request()
                .input('vid', sql.Int, lastBooking.variant_id)
                .query('SELECT service_id, variant_name FROM ServiceVariants WHERE variant_id = @vid');
            const bookingServiceId = bookingVariantRes.recordset[0]?.service_id;

            console.log(`Booking Variant ID: ${lastBooking.variant_id}`);
            console.log(`Booking Service ID: ${bookingServiceId}`);

            // Check if tasker has ANY variant with this service_id
            const isServiceMatch = taskerVariants.recordset.some(v => v.service_id === bookingServiceId);

            console.log(`Tasker Has Service Match? ${isServiceMatch ? 'YES' : 'NO'}`);
            console.log(`Booking Status: ${lastBooking.status}`);
            console.log(`Booking Tasker ID: ${lastBooking.tasker_id}`);
            console.log(`Expires At: ${lastBooking.sos_expires_at}`);
            console.log(`Current Time: ${new Date().toISOString()}`);
        }

    } catch (err) {
        console.error('Debug Error:', err);
    } finally {
        process.exit();
    }
}

debugSOS();
