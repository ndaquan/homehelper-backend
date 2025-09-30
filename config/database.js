const sql = require("mssql");
require("dotenv").config();

// Cấu hình kết nối SQL Server
const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'HomeHelperDB',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '123456789',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: false, // Nếu dùng Azure thì để true
    trustServerCertificate: true // Cho phép self-signed cert
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 300000,
  },
};

// Tạo pool kết nối
let pool = null;

// Hàm tạo pool mới
function createPool() {
  if (pool) { try { pool.close(); } catch(e){} }
  pool = new sql.ConnectionPool(dbConfig);
  pool.on('error', (err) => console.error('Database connection error:', err));
  return pool;
}

// Hàm kết nối database
async function connectDB() {
  try {
    if (!pool) pool = createPool();
    if (!pool.connected) await pool.connect();
    console.log('✅ Kết nối SQL Server thành công!');
    return pool;
  } catch (e) {
    console.error('❌ Lỗi kết nối database:', e);
    throw e;
  }
}

async function getPool() {
  if (pool && pool.connected) return pool;
  return await connectDB();
}

// Hàm đóng kết nối
async function closeDB() {
  try {
    await pool.close();
    console.log("🔌 Đã đóng kết nối database");
  } catch (error) {
    console.error("❌ Lỗi đóng kết nối database:", error);
  }
}

// Hàm thực thi query
async function executeQuery(query, params = {}) {
  try {
    // Đảm bảo pool đã kết nối
    if (!pool || !pool.connected) {
      console.log("🔄 Pool chưa kết nối, đang kết nối lại...");
      await connectDB();
    }

    const request = pool.request();

    // Bind parameters nếu có (hỗ trợ cả object và array)
    if (Array.isArray(params)) {
      params.forEach((param, index) => {
        request.input(`param${index + 1}`, param);  
      });
    } else if (typeof params === 'object' && params !== null) {
      Object.entries(params).forEach(([key, value]) => {
        request.input(key, value);
      });
    }

    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error("❌ Lỗi thực thi query:", error);
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
    console.error("❌ Lỗi thực thi stored procedure:", error);
    throw error;
  }
}

// Hàm thực thi query INSERT/UPDATE/DELETE
async function executeNonQuery(query, params = {}) {
  try {
    // Đảm bảo pool đã được khởi tạo
    if (!pool) {
      await connectDB();
    }
    
    const request = pool.request();

    // Bind parameters nếu có
    Object.entries(params).forEach(([key, value]) => {
      request.input(key, value);
    });

    const result = await request.query(query);
    
    // Lấy IDENTITY value từ SCOPE_IDENTITY()
    const identityResult = await request.query('SELECT SCOPE_IDENTITY() as id');
    const insertId = identityResult.recordset && identityResult.recordset.length > 0 
      ? identityResult.recordset[0].id 
      : null;
    
    return {
      changes: result.rowsAffected[0],
      insertId: insertId
    };
  } catch (error) {
    console.error("❌ Lỗi thực thi non-query:", error);
    throw error;
  }
}

module.exports = {
  connectDB,
  closeDB,
  executeQuery,
  executeNonQuery,
  executeStoredProcedure,
  getPool,   // ✅ export
  sql,
  pool
};
