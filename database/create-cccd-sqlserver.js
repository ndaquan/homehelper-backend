const sql = require("mssql");
require("dotenv").config();

// Cấu hình kết nối SQL Server
const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'HomeHelperDB3',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '123456789',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

console.log('🔧 Tạo bảng cccd_verification trong SQL Server...');
console.log('📊 Database:', dbConfig.database);

async function createCccdTable() {
  try {
    // Kết nối database
    await sql.connect(dbConfig);
    console.log('✅ Kết nối SQL Server thành công!');

    // Tạo bảng cccd_verification (không có foreign key)
    const createTableQuery = `
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='cccd_verification' AND xtype='U')
      CREATE TABLE cccd_verification (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        cccd_number NVARCHAR(20),
        full_name NVARCHAR(255),
        date_of_birth DATE,
        gender NVARCHAR(10),
        nationality NVARCHAR(100),
        place_of_origin NVARCHAR(500),
        place_of_residence NVARCHAR(500),
        issued_date DATE,
        expiry_date DATE,
        front_image_path NVARCHAR(500),
        back_image_path NVARCHAR(500),
        face_image_path NVARCHAR(500),
        ocr_text_front NTEXT,
        ocr_text_back NTEXT,
        ocr_accuracy DECIMAL(5,2) DEFAULT 0.0,
        verification_status NVARCHAR(20) DEFAULT 'Pending',
        verified_at DATETIME,
        verified_by INT,
        is_deleted BIT DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE()
      )
    `;

    await sql.query(createTableQuery);
    console.log('✅ Bảng cccd_verification đã được tạo!');

    // Kiểm tra và thêm các cột CCCD vào bảng users
    const checkUserColumnsQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'users' AND COLUMN_NAME IN ('cccd_status', 'cccd_verified_at', 'cccd_verified_by')
    `;

    const result = await sql.query(checkUserColumnsQuery);
    const existingColumns = result.recordset.map(row => row.COLUMN_NAME);
    
    console.log('📋 Các cột CCCD hiện có trong users:', existingColumns);

    // Thêm cột cccd_status nếu chưa có
    if (!existingColumns.includes('cccd_status')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD cccd_status NVARCHAR(20) DEFAULT 'Pending'
        `);
        console.log('➕ Đã thêm cột users.cccd_status');
      } catch (err) {
        console.log('⚠️ Cột cccd_status có thể đã tồn tại:', err.message);
      }
    }

    // Thêm cột cccd_verified_at nếu chưa có
    if (!existingColumns.includes('cccd_verified_at')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD cccd_verified_at DATETIME
        `);
        console.log('➕ Đã thêm cột users.cccd_verified_at');
      } catch (err) {
        console.log('⚠️ Cột cccd_verified_at có thể đã tồn tại:', err.message);
      }
    }

    // Thêm cột cccd_verified_by nếu chưa có
    if (!existingColumns.includes('cccd_verified_by')) {
      try {
        await sql.query(`
          ALTER TABLE users 
          ADD cccd_verified_by INT
        `);
        console.log('➕ Đã thêm cột users.cccd_verified_by');
      } catch (err) {
        console.log('⚠️ Cột cccd_verified_by có thể đã tồn tại:', err.message);
      }
    }

    // Kiểm tra cấu trúc cuối cùng
    const finalCheckQuery = `
      SELECT 
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME IN ('cccd_verification', 'users')
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `;

    const finalResult = await sql.query(finalCheckQuery);
    
    console.log('\n🔍 Cấu trúc cuối cùng:');
    console.log('📋 Bảng cccd_verification:');
    finalResult.recordset
      .filter(row => row.TABLE_NAME === 'cccd_verification')
      .forEach(row => {
        console.log(`  ${row.COLUMN_NAME}: ${row.DATA_TYPE} ${row.IS_NULLABLE === 'NO' ? 'NOT NULL' : ''}`);
      });

    console.log('\n📋 Bảng users (các cột CCCD):');
    finalResult.recordset
      .filter(row => row.TABLE_NAME === 'users' && 
        (row.COLUMN_NAME.includes('cccd') || row.COLUMN_NAME === 'name' || row.COLUMN_NAME === 'id'))
      .forEach(row => {
        console.log(`  ${row.COLUMN_NAME}: ${row.DATA_TYPE} ${row.IS_NULLABLE === 'NO' ? 'NOT NULL' : ''}`);
      });

    // Kiểm tra xem có dữ liệu nào trong cccd_verification không
    const checkDataQuery = `SELECT COUNT(*) as count FROM cccd_verification`;
    const dataResult = await sql.query(checkDataQuery);
    console.log(`\n📊 Số bản ghi trong cccd_verification: ${dataResult.recordset[0].count}`);

    console.log('\n🎉 Hoàn tất tạo bảng CCCD trong SQL Server!');
    console.log('📝 Hướng dẫn test:');
    console.log('1. Khởi động backend: npm start');
    console.log('2. Truy cập: http://localhost:3000/account');
    console.log('3. Chọn tab "Xác minh CCCD"');
    console.log('4. Nhập thông tin và upload ảnh');
    console.log('5. Kiểm tra SQL Server Management Studio để xem dữ liệu');

  } catch (error) {
    console.error('❌ Lỗi:', error.message);
  } finally {
    await sql.close();
    console.log('🔌 Đã đóng kết nối database');
  }
}

// Chạy script
createCccdTable();