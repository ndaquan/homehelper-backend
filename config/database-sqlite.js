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
    
    // Tạo bảng users nếu chưa có
    createTables();
  }
});

// Hàm tạo các bảng cần thiết
function createTables() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'Customer',
      phone TEXT,
      cccd_status TEXT DEFAULT 'Pending',
      cccd_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.run(createUsersTable, (err) => {
    if (err) {
      console.error('❌ Lỗi tạo bảng users:', err.message);
    } else {
      console.log('✅ Bảng users đã sẵn sàng');
      // Bổ sung cột nếu DB cũ chưa có
      db.all("PRAGMA table_info(users)", (e, rows) => {
        if (e) return console.error('❌ PRAGMA users error:', e.message);
        const cols = rows.map(r => r.name);
        if (!cols.includes('cccd_status')) {
          db.run("ALTER TABLE users ADD COLUMN cccd_status TEXT DEFAULT 'Pending'", (er) => {
            if (er) console.warn('⚠️ Thêm cột cccd_status thất bại (có thể đã tồn tại):', er.message);
            else console.log('➕ Đã thêm cột users.cccd_status');
          });
        }
        if (!cols.includes('cccd_number')) {
          db.run("ALTER TABLE users ADD COLUMN cccd_number TEXT", (er2) => {
            if (er2) console.warn('⚠️ Thêm cột cccd_number thất bại (có thể đã tồn tại):', er2.message);
            else console.log('➕ Đã thêm cột users.cccd_number');
          });
        }
      });
    }
  });

  const createIdCardsTable = `
    CREATE TABLE IF NOT EXISTS id_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      dob TEXT,
      gender TEXT,
      nationality TEXT,
      place_of_origin TEXT,
      place_of_residence TEXT,
      issued_date TEXT,
      features TEXT,
      front_image_path TEXT,
      back_image_path TEXT,
      face_image_path TEXT,
      ocr_text_front TEXT,
      ocr_text_back TEXT,
      verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(number),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `;

  db.run(createIdCardsTable, (err) => {
    if (err) {
      console.error('❌ Lỗi tạo bảng id_cards:', err.message);
    } else {
      console.log('✅ Bảng id_cards đã sẵn sàng');
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

// Hàm thực thi query
async function executeQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve({ recordset: rows });
      }
    });
  });
}

// Hàm thực thi query trả về 1 row
async function executeQueryOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve({ recordset: [row] });
      }
    });
  });
}

// Hàm thực thi query insert/update/delete
async function executeNonQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ 
          rowsAffected: this.changes,
          insertId: this.lastID 
        });
      }
    });
  });
}

module.exports = {
  connectDB,
  closeDB,
  executeQuery,
  executeQueryOne,
  executeNonQuery,
  db
};











