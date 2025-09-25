const sql = require('mssql');
const { getPool } = require('../config/database');

const insertPending = async (tx) => {
  const pool = await getPool();
  const r = await pool.request()
    .input('order_id', sql.NVarChar(64), tx.order_id)
    .input('request_id', sql.NVarChar(64), tx.request_id || null)
    .input('user_id', sql.Int, tx.user_id)
    .input('amount', sql.Int, tx.amount)
    .input('status', sql.NVarChar(16), 'pending')
    .input('extra_data', sql.NVarChar(500), tx.extra_data || null)
    .input('signature', sql.NVarChar(256), tx.signature || null)
    .query(`
      INSERT INTO dbo.Transactions(order_id, request_id, user_id, amount, status, extra_data, signature)
      VALUES (@order_id, @request_id, @user_id, @amount, @status, @extra_data, @signature)
    `);
  return r.rowsAffected[0] === 1;
};

const markSuccess = async ({ order_id, trans_id, pay_type, message, result_code, signature }) => {
  const pool = await getPool();
  const r = await pool.request()
    .input('order_id', sql.NVarChar(64), order_id)
    .input('trans_id', sql.NVarChar(64), trans_id || null)
    .input('pay_type', sql.NVarChar(64), pay_type || null)
    .input('message', sql.NVarChar(255), message || null)
    .input('result_code', sql.Int, result_code ?? 0)
    .input('signature', sql.NVarChar(256), signature || null)
    .query(`
      UPDATE dbo.Transactions
      SET status = N'success',
          trans_id = @trans_id,
          pay_type = @pay_type,
          message = @message,
          result_code = @result_code,
          signature = @signature,
          paid_at = SYSUTCDATETIME(),
          updated_at = SYSUTCDATETIME()
      WHERE order_id = @order_id AND status <> N'success'
    `);
  return r.rowsAffected[0] === 1;
};

const markFailed = async ({ order_id, message, result_code, signature }) => {
  const pool = await getPool();
  const r = await pool.request()
    .input('order_id', sql.NVarChar(64), order_id)
    .input('message', sql.NVarChar(255), message || null)
    .input('result_code', sql.Int, result_code ?? -1)
    .input('signature', sql.NVarChar(256), signature || null)
    .query(`
      UPDATE dbo.Transactions
      SET status = N'failed',
          message = @message,
          result_code = @result_code,
          signature = @signature,
          updated_at = SYSUTCDATETIME()
      WHERE order_id = @order_id AND status = N'pending'
    `); 
  return r.rowsAffected[0] === 1;
};

const getByOrderId = async (order_id) => {
  const pool = await getPool();
  const r = await pool.request()
    .input('order_id', sql.NVarChar(64), order_id)
    .query(`SELECT TOP 1 * FROM dbo.Transactions WHERE order_id=@order_id`);
  return r.recordset[0] || null;
};

const getByUserPending = async (user_id) => {
  const pool = await getPool();
  const r = await pool.request()
    .input('user_id', sql.Int, user_id)
    .query(`SELECT TOP 1 * FROM dbo.Transactions WHERE user_id=@user_id AND status=N'pending' ORDER BY created_at DESC`);
  return r.recordset[0] || null;
};

module.exports = { insertPending, markSuccess, markFailed, getByOrderId, getByUserPending };