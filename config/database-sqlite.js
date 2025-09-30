const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Đường dẫn đến file database SQLite
const dbPath = path.join(__dirname, '../database/homehelper.db');

// Tạo kết nối database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Lỗi kết nối SQLite:', err.message);
  } else {
    console.log('✅ Kết nối SQLite thành công!');
    console.log(`📊 Database: ${dbPath}`);
    
    // Tạo các bảng cần thiết
    createTables();
  }
});

// Hàm tạo các bảng cần thiết
function createTables() {
  // Tạo bảng cccd_verification
  const createCccdTable = `
    CREATE TABLE IF NOT EXISTS cccd_verification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cccd_number TEXT,
      full_name TEXT,
      date_of_birth TEXT,
      gender TEXT,
      nationality TEXT,
      place_of_origin TEXT,
      place_of_residence TEXT,
      issued_date TEXT,
      expiry_date TEXT,
      front_image_path TEXT,
      back_image_path TEXT,
      face_image_path TEXT,
      ocr_text_front TEXT,
      ocr_text_back TEXT,
      ocr_accuracy REAL DEFAULT 0.0,
      verification_status TEXT DEFAULT 'Pending',
      verified_at DATETIME,
      verified_by INTEGER,
      is_deleted BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `;

  db.run(createCccdTable, (err) => {
    if (err) {
      console.error('❌ Lỗi tạo bảng cccd_verification:', err.message);
    } else {
      console.log('✅ Bảng cccd_verification đã sẵn sàng');
    }
  });

  // Thêm các cột CCCD vào bảng users nếu chưa có
  db.all("PRAGMA table_info(users)", (e, rows) => {
    if (e) return console.error('❌ PRAGMA users error:', e.message);
    const cols = rows.map(r => r.name);
    
    if (!cols.includes('cccd_status')) {
      db.run("ALTER TABLE users ADD COLUMN cccd_status TEXT DEFAULT 'Pending'", (er) => {
        if (er) console.warn('⚠️ Thêm cột cccd_status thất bại (có thể đã tồn tại):', er.message);
        else console.log('➕ Đã thêm cột users.cccd_status');
      });
    }
    
    if (!cols.includes('cccd_verified_at')) {
      db.run("ALTER TABLE users ADD COLUMN cccd_verified_at DATETIME", (er) => {
        if (er) console.warn('⚠️ Thêm cột cccd_verified_at thất bại (có thể đã tồn tại):', er.message);
        else console.log('➕ Đã thêm cột users.cccd_verified_at');
      });
    }
    
    if (!cols.includes('cccd_verified_by')) {
      db.run("ALTER TABLE users ADD COLUMN cccd_verified_by INTEGER", (er) => {
        if (er) console.warn('⚠️ Thêm cột cccd_verified_by thất bại (có thể đã tồn tại):', er.message);
        else console.log('➕ Đã thêm cột users.cccd_verified_by');
      });
    }
  });
}

// Hàm kết nối database
async function connectDB() {
  return new Promise((resolve, reject) => {
    db.get("SELECT 1", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

// Hàm đóng kết nối
async function closeDB() {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) {
        console.error('❌ Lỗi đóng kết nối database:', err.message);
      } else {
        console.log('🔌 Đã đóng kết nối database');
      }
      resolve();
    });
  });
}

// Hàm thực thi query SELECT
async function executeQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Hàm thực thi query INSERT/UPDATE/DELETE
async function executeNonQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ 
          changes: this.changes,
          lastID: this.lastID 
        });
      }
    });
  });
}

module.exports = {
  connectDB,
  closeDB,
  executeQuery,
  executeNonQuery,
  db
};