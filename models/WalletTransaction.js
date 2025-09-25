const sql = require('mssql');
const { getPool } = require('../config/database');

const addTransaction = async ({ user_id, amount, type, purpose, related_id, note }) => {
  const pool = await getPool();
  await pool.request()
    .input('user_id', sql.Int, user_id)
    .input('amount', sql.BigInt, amount)
    .input('type', sql.NVarChar, type)       // 'credit' hoặc 'debit'
    .input('purpose', sql.NVarChar, purpose) // 'topup'
    .input('related_id', sql.NVarChar, related_id || null)
    .input('note', sql.NVarChar, note || null)
    .query(`
      INSERT INTO WalletTransactions (user_id, amount, type, purpose, related_id, note)
      VALUES (@user_id, @amount, @type, @purpose, @related_id, @note)
    `);
  return true;
};

// Tính balance bằng SUM
const getBalance = async (user_id) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('user_id', sql.Int, user_id)
    .query(`
      SELECT 
        ISNULL(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END), 0) AS balance
      FROM WalletTransactions
      WHERE user_id=@user_id
    `);
  return result.recordset[0].balance;
};

// Lấy lịch sử ví (gần nhất trước)
const getHistory = async (user_id, limit = 20) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('user_id', sql.Int, user_id)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) *
      FROM WalletTransactions
      WHERE user_id=@user_id
      ORDER BY created_at DESC
    `);
  return result.recordset;
};

module.exports = { addTransaction, getBalance, getHistory };
