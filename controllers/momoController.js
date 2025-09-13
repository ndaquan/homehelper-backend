// controllers/momoController.js
const axios = require('axios');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');

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
const BASE_ENDPOINT = MOMO_ENDPOINT?.replace(/\/+$/,'') || 'https://payment.momo.vn';

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

// Tùy DB của bạn: cộng tiền ví nội bộ sau khi success
const creditWallet = async (user_id, amount) => {
  // TODO: thay bằng UPDATE thực tế theo schema Users/Wallets của bạn.
  // Ví dụ:
  // const pool = await getPool();
  // await pool.request()
  //   .input('user_id', sql.NVarChar(64), user_id)
  //   .input('amount', sql.BigInt, amount)
  //   .query(`UPDATE dbo.Users SET balance = ISNULL(balance,0) + @amount WHERE user_id=@user_id`);
  return true;
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

    const orderId = `TOPUP_${user_id}_${Date.now()}`;
    const requestId = `REQ_${Date.now()}`;

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
      { timeout: 15000 }
    );

    // Trả cho FE link thanh toán (payUrl/qrCodeUrl)
    return res.json({
      payUrl: momoRes.data?.payUrl || momoRes.data?.deeplink,
      qrCodeUrl: momoRes.data?.qrCodeUrl,
      orderId
    });
  } catch (err) {
    // Nếu MoMo call fail, cân nhắc markFailed (tùy bạn muốn giữ pending để retry hay không)
    return res.status(500).json({ error: 'create_failed', detail: err.message });
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

    if (Number(data.resultCode) === 0) {
      const ok = await Transaction.markSuccess({
        order_id: data.orderId,
        trans_id: String(data.transId || ''),
        pay_type: data.payType || null,
        message: data.message || null,
        result_code: 0,
        signature: data.signature || null
      });
      if (ok) {
        // Idempotent: markSuccess WHERE status <> 'success' nên cộng ví 1 lần
        await creditWallet(tx.user_id, tx.amount);
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
    if (ok) await creditWallet(tx.user_id, tx.amount);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
