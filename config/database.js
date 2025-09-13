const sql = require('mssql');
require('dotenv').config();

// Cấu hình kết nối SQL Server
const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'HomeHelperDB',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'Minh123',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: true,
    trustServerCertificate: false
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 300000
  }
};

// Tạo pool kết nối
let pool = null;

// Hàm tạo pool mới
function createPool() {
  if (pool) {
    try {
      pool.close();
    } catch (err) {
      console.error('Lỗi đóng pool cũ:', err);
    }
  }
  
  pool = new sql.ConnectionPool(dbConfig);
  
  pool.on('error', (err) => {
    console.error('Database connection error:', err);
  });
  
  return pool;
}

// Hàm kết nối database
async function connectDB() {
  try {
    if (!pool) {
      pool = createPool();
    }
    
    await pool.connect();
    console.log('✅ Kết nối SQL Server thành công!');
    console.log(`📊 Database: ${dbConfig.database}`);
    console.log(`🌐 Server: ${dbConfig.server}`);
    return pool;
  } catch (error) {
    console.error('❌ Lỗi kết nối database:', error);
    throw error;
  }
}

// Hàm đóng kết nối
async function closeDB() {
  try {
    await pool.close();
    console.log('🔌 Đã đóng kết nối database');
  } catch (error) {
    console.error('❌ Lỗi đóng kết nối database:', error);
  }
}

// Hàm thực thi query
async function executeQuery(query, params = []) {
  try {
    // Đảm bảo pool đã kết nối
    if (!pool || !pool.connected) {
      console.log('🔄 Pool chưa kết nối, đang kết nối lại...');
      await connectDB();
    }
    
    const request = pool.request();
    
    // Bind parameters nếu có
    params.forEach((param, index) => {
      request.input(`param${index + 1}`, param);
    });
    
    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error('❌ Lỗi thực thi query:', error);
    throw error;
  }
}

// Hàm thực thi stored procedure
async function executeStoredProcedure(procName, params = []) {
  try {
    const request = pool.request();
    
    // Bind parameters nếu có
    params.forEach((param, index) => {
      request.input(`param${index + 1}`, param);
    });
    
    const result = await request.execute(procName);
    return result;
  } catch (error) {
    console.error('❌ Lỗi thực thi stored procedure:', error);
    throw error;
  }
}

module.exports = {
  connectDB,
  closeDB,
  executeQuery,
  executeStoredProcedure,
  pool
};
