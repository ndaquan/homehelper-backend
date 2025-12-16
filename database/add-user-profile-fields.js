const sql = require("mssql");
require("dotenv").config();

// Cấu hình kết nối SQL Server
const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'HomeHelperDB6',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'Hieu12345',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

console.log('🔧 Thêm các cột profile vào bảng users...');
console.log('📊 Database:', dbConfig.database);

async function addProfileFields() {
  try {
    // Kết nối database
    await sql.connect(dbConfig);
    console.log('✅ Kết nối SQL Server thành công!');

    // Kiểm tra các cột hiện có trong bảng users
    const checkColumnsQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'users' AND COLUMN_NAME IN ('date_of_birth', 'bio', 'avatar_url')
    `;

    const result = await sql.query(checkColumnsQuery);
    const existingColumns = result.recordset.map(row => row.COLUMN_NAME);
    
    console.log('📋 Các cột profile hiện có trong users:', existingColumns);

    // Thêm cột date_of_birth nếu chưa có
    if (!existingColumns.includes('date_of_birth')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD date_of_birth DATE NULL
        `);
        console.log('➕ Đã thêm cột users.date_of_birth');
      } catch (err) {
        console.log('⚠️ Cột date_of_birth có thể đã tồn tại:', err.message);
      }
    } else {
      console.log('ℹ️ Cột date_of_birth đã tồn tại');
    }

    // Thêm cột bio nếu chưa có
    if (!existingColumns.includes('bio')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD bio NVARCHAR(500) NULL
        `);
        console.log('➕ Đã thêm cột users.bio');
      } catch (err) {
        console.log('⚠️ Cột bio có thể đã tồn tại:', err.message);
      }
    } else {
      console.log('ℹ️ Cột bio đã tồn tại');
    }

    // Thêm cột avatar_url nếu chưa có
    if (!existingColumns.includes('avatar_url')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD avatar_url NVARCHAR(500) NULL
        `);
        console.log('➕ Đã thêm cột users.avatar_url');
      } catch (err) {
        console.log('⚠️ Cột avatar_url có thể đã tồn tại:', err.message);
      }
    } else {
      console.log('ℹ️ Cột avatar_url đã tồn tại');
    }

    // Kiểm tra cấu trúc cuối cùng
    const finalCheckQuery = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'users' 
      AND COLUMN_NAME IN ('date_of_birth', 'bio', 'avatar_url', 'name', 'email', 'phone')
      ORDER BY COLUMN_NAME
    `;

    const finalResult = await sql.query(finalCheckQuery);
    
    console.log('\n🔍 Cấu trúc các cột profile trong users:');
    finalResult.recordset.forEach(row => {
      const length = row.CHARACTER_MAXIMUM_LENGTH ? `(${row.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`  ${row.COLUMN_NAME}: ${row.DATA_TYPE}${length} ${row.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    console.log('\n🎉 Hoàn tất thêm các cột profile vào bảng users!');
    console.log('📝 Các cột đã được thêm:');
    console.log('  - date_of_birth (DATE): Ngày sinh');
    console.log('  - bio (NVARCHAR(500)): Giới thiệu về bản thân');
    console.log('  - avatar_url (NVARCHAR(500)): URL ảnh đại diện');

  } catch (error) {
    console.error('❌ Lỗi:', error.message);
    console.error(error);
  } finally {
    await sql.close();
    console.log('🔌 Đã đóng kết nối database');
  }
}

// Chạy script
addProfileFields();

