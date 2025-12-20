// controllers/momoController.js
const axios = require('axios');
const crypto = require('crypto');
const sql = require('mssql');
const { getPool } = require('../config/database');

const Transaction = require('../models/Transaction');
const WalletTx = require('../models/WalletTransaction');

// ENV cần có:
// MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY
// MOMO_ENDPOINT (vd: https://test-payment.momo.vn)  <-- KHÔNG kèm /v2/gateway/api/create
// MOMO_REDIRECT_URL (vd: http://localhost:3000/payment-result)
// MOMO_IPN_URL (vd: https://xxxxx.ngrok-free.app/momo/ipn)
const {
  MOMO_PARTNER_CODE,
  MOMO_ACCESS_KEY,
  MOMO_SECRET_KEY,
  MOMO_ENDPOINT,
  MOMO_REDIRECT_URL,
  MOMO_IPN_URL,
  NODE_ENV
} = process.env;

const CREATE_PATH = '/v2/gateway/api/create';
const BASE_ENDPOINT = MOMO_ENDPOINT?.replace(/\/+$/, '') || 'https://payment.momo.vn';

const hmacSHA256 = (raw, secret) =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

const signCreate = (body) => {
  const raw = [
    `accessKey=${body.accessKey}`,
    `amount=${body.amount}`,
    `extraData=${body.extraData || ''}`,
    `ipnUrl=${body.ipnUrl}`,
    `orderId=${body.orderId}`,
    `orderInfo=${body.orderInfo}`,
    `partnerCode=${body.partnerCode}`,
    `redirectUrl=${body.redirectUrl}`,
    `requestId=${body.requestId}`,
    `requestType=${body.requestType}`,
  ].join('&');
  return hmacSHA256(raw, MOMO_SECRET_KEY);
};

const verifyIpnSignature = (payload) => {
  // Thứ tự khóa theo tài liệu IPN MoMo v2
  const {
    amount, extraData, message, orderId, orderInfo, orderType,
    partnerCode, payType, requestId, responseTime, resultCode, transId
  } = payload;

  const raw = [
    `accessKey=${MOMO_ACCESS_KEY}`,
    `amount=${amount}`,
    `extraData=${extraData || ''}`,
    `message=${message || ''}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo || ''}`,
    `orderType=${orderType || ''}`,
    `partnerCode=${partnerCode}`,
    `payType=${payType || ''}`,
    `requestId=${requestId}`,
    `responseTime=${responseTime}`,
    `resultCode=${resultCode}`,
    `transId=${transId}`,
  ].join('&');

  const expected = hmacSHA256(raw, MOMO_SECRET_KEY);
  return expected === payload.signature;
};

// POST /api/momo/create
exports.createMomoPayment = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    const user_id = req.user?.userId || req.user?.id || req.user?.user_id; // JWT của bạn
    if (!user_id) return res.status(401).json({ error: 'unauthorized' });

    const orderId = `NAPVI_${user_id}_${Date.now()}`;
    const requestId = `REQ_${Date.now()}`;

    // BỎ CHẶN: Cho phép tạo nhiều đơn pending (vì orderId đã có timestamp là duy nhất).
    // Việc này giúp user nếu lỡ đóng tab cũ có thể tạo link mới ngay lập tức.
    /*
    const existing = await Transaction.getByUserPending(user_id);
    if (existing) {
      return res.status(409).json({
        error: 'pending_exists',
        momo: {
          orderId: existing.order_id,
          status: existing.status,
          amount: existing.amount
        }
      });
    }
    */

    // Lưu pending trước để không mất dấu giao dịch
    await Transaction.insertPending({
      order_id: orderId,
      request_id: requestId,
      user_id,
      amount: Number(amount),
      extra_data: '',
      signature: null
    });

    const body = {
      partnerCode: MOMO_PARTNER_CODE,
      accessKey: MOMO_ACCESS_KEY,
      requestId,
      amount: String(amount),
      orderId,
      orderInfo: `Top-up ${user_id}`,
      redirectUrl: MOMO_REDIRECT_URL,
      ipnUrl: MOMO_IPN_URL,
      requestType: 'captureWallet',
      extraData: '',
      lang: 'vi',
    };

    const signature = signCreate(body);

    const momoRes = await axios.post(
      `${BASE_ENDPOINT}${CREATE_PATH}`,
      { ...body, signature },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    // Trả cho FE link thanh toán (payUrl/qrCodeUrl)
    return res.json({
      momo: {                   // ✅ bọc lại cho khớp FE
        payUrl: momoRes.data?.payUrl || momoRes.data?.deeplink,
        qrCodeUrl: momoRes.data?.qrCodeUrl,
        orderId,
        requestId
      }
    });
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;   // ← body từ MoMo (có resultCode/message)
    console.error('[MoMo create][ERROR]', status, data || err.message);

    return res.status(500).json({
      error: 'create_failed',
      detail: data || err.message
    });
  }
};

// POST /api/momo/ipn  (MoMo gọi S2S)
exports.momoIpn = async (req, res) => {
  try {
    const data = req.body || {};

    // Dev mode có thể cho phép bỏ verify để debug nhanh, Production thì bắt buộc verify
    const mustVerify = NODE_ENV === 'production';
    const isValid = verifyIpnSignature(data);
    if (mustVerify && !isValid) {
      await Transaction.markFailed({
        order_id: data.orderId,
        message: 'invalid_signature',
        result_code: -997,
        signature: data.signature || null
      });
      // Vẫn trả 200 để MoMo không retry quá nhiều
      return res.status(200).json({ resultCode: 0, message: 'acknowledged' });
    }

    const tx = await Transaction.getByOrderId(data.orderId);
    if (!tx) {
      await Transaction.markFailed({
        order_id: data.orderId,
        message: 'order_not_found',
        result_code: -998,
        signature: data.signature || null
      });
      return res.status(200).json({ resultCode: 0, message: 'acknowledged' });
    }

    if (Number(resultCode) === 0) {
      // ✅ CHUẨN HÓA SỐ TIỀN: Chia 1000 để khớp với UI (Ví dụ: nạp 10.000đ -> lưu 10)
      const uiAmount = Math.floor(Number(amount) / 1000);
      console.log(`[MoMo IPN] Normalized amount: ${amount} VND -> ${uiAmount}k`);

      const ok = await Transaction.markSuccess({
        order_id: orderId,
        trans_id: String(transId || ''),
        pay_type: payType || 'momo',
        message: message || 'Success',
        result_code: resultCode,
        signature: signature || null
      });

      if (ok) {
        // Ghi lịch sử ví
        await WalletTx.addTransaction({
          user_id: tx.user_id,
          amount: uiAmount, // Lưu giá trị đã chia
          type: 'credit',
          purpose: 'topup',
          related_id: orderId,
          note: `Nạp tiền MoMo (Số tiền nạp: ${amount}đ)`
        });
      }
    } else {
      await Transaction.markFailed({
        order_id: data.orderId,
        message: data.message || 'failed',
        result_code: Number(data.resultCode),
        signature: data.signature || null
      });
    }

    // Luôn ACK 200 cho MoMo
    return res.status(200).json({ resultCode: 0, message: 'acknowledged' });
  } catch (err) {
    // Dù lỗi nội bộ vẫn ACK để tránh retry bão
    return res.status(200).json({ resultCode: 0, message: 'acknowledged' });
  }
};

// POST /api/momo/dev/confirm  (CHỈ DEV) — dùng khi chưa có IPN public
exports.devConfirm = async (req, res) => {
  // ... (giữ nguyên logic cũ)
  try {
    if (NODE_ENV === 'production') return res.status(403).json({ error: 'forbidden' });
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'missing_orderId' });

    const tx = await Transaction.getByOrderId(orderId);
    if (!tx) return res.status(404).json({ error: 'not_found' });
    if (tx.status !== 'pending') return res.json({ ok: true, status: tx.status });

    const ok = await Transaction.markSuccess({
      order_id: orderId,
      trans_id: `DEV_${Date.now()}`,
      pay_type: 'dev',
      message: 'dev_confirm',
      result_code: 0,
      signature: null
    });
    if (ok) {
      await WalletTx.addTransaction({
        user_id: tx.user_id,
        amount: tx.amount,
        type: 'credit',
        purpose: 'topup',
        related_id: tx.order_id,
        note: 'Dev confirm nạp tiền'
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/momo/order/:orderId
exports.checkOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    let tx = await Transaction.getByOrderId(orderId);

    if (!tx) return res.status(404).json({ error: 'Giao dịch không tồn tại' });

    // Nếu đơn đã thành công hoặc thất bại rồi thì trả về luôn
    if (tx.status !== 'pending') {
      // For already processed transactions, return the stored amount (which should be uiAmount if processed by IPN/Query)
      // If the original tx.amount is in VND, we might need to normalize it here too for consistency.
      // Assuming tx.amount is already in the desired UI format if status is not pending.
      return res.json({ status: tx.status, amount: Math.floor(Number(tx.amount) / 1000) });
    }

    // Nếu vẫn đang pending, chủ động gọi sang MoMo để hỏi (Query Status)
    const requestId = `QUERY_${Date.now()}`;

    // Tạo chữ ký cho yêu cầu kiểm tra trạng thái (Query Status MoMo v2)
    // rawSignature: accessKey=$accessKey&orderId=$orderId&partnerCode=$partnerCode&requestId=$requestId
    const rawSignature = `accessKey=${MOMO_ACCESS_KEY}&orderId=${orderId}&partnerCode=${MOMO_PARTNER_CODE}&requestId=${requestId}`;
    const signature = crypto.createHmac('sha256', MOMO_SECRET_KEY).update(rawSignature).digest('hex');

    const queryBody = {
      partnerCode: MOMO_PARTNER_CODE,
      requestId,
      orderId,
      signature
    };

    console.log('[MoMo Query] Body:', queryBody);

    const momoRes = await axios.post(
      `${BASE_ENDPOINT}/v2/gateway/api/query`,
      queryBody,
      { timeout: 10000 }
    );

    const momoData = momoRes.data;
    console.log('[MoMo Query Status Response]', orderId, 'resultCode:', momoData.resultCode, 'message:', momoData.message);

    // Nếu MoMo báo thành công (resultCode = 0)
    if (Number(momoData.resultCode) === 0) {
      const realAmount = Number(momoData.amount || tx.amount);
      const uiAmount = Math.floor(realAmount / 1000);
      console.log(`[MoMo Sync] Normalized amount: ${realAmount} VND -> ${uiAmount}k`);

      // Cập nhật Database
      const ok = await Transaction.markSuccess({
        order_id: orderId,
        trans_id: String(momoData.transId || ''),
        pay_type: momoData.payType || 'momo',
        message: momoData.message || 'Sync from Query API',
        result_code: 0,
        signature: momoData.signature || null
      });

      if (ok) {
        console.log('[MoMo Sync] Update DB Success, adding wallet tx...');
        await WalletTx.addTransaction({
          user_id: tx.user_id,
          amount: uiAmount, // Lưu giá trị đã chia
          type: 'credit',
          purpose: 'topup',
          related_id: orderId,
          note: `Nạp tiền MoMo (Đã đồng bộ - ${realAmount}đ)`
        });
        return res.json({ status: 'success', amount: uiAmount });
      } else {
        console.log('[MoMo Sync] DB already updated or update failed');
        // Nếu không update được (có thể do đã success trước đó bởi IPN), 
        // lấy lại trạng thái mới nhất từ DB
        const updatedTx = await Transaction.getByOrderId(orderId);
        return res.json({ status: updatedTx.status, amount: Math.floor(Number(updatedTx.amount) / 1000) });
      }
    } else if ([1000, 9000, 7000].includes(Number(momoData.resultCode))) {
      // Các mã này nghĩa là vẫn đang chờ thanh toán
      return res.json({ status: 'pending', amount: tx.amount });
    } else {
      // Thất bại hoặc lỗi khác
      console.log('[MoMo Sync] Transaction failed according to MoMo');
      await Transaction.markFailed({
        order_id: orderId,
        message: momoData.message || 'failed',
        result_code: Number(momoData.resultCode)
      });
      return res.json({ status: 'failed', amount: tx.amount });
    }
  } catch (err) {
    console.error('[checkOrderStatus][Error]', err.response?.data || err.message);
    res.status(500).json({ error: 'Lỗi kiểm tra trạng thái đơn hàng' });
  }
};
