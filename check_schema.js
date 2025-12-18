
const { getPool, sql } = require('./config/database');
require('dotenv').config();

async function checkSchema() {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'Bookings'
    `);
        console.table(result.recordset);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkSchema();
