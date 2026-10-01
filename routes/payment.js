// ══════════════════════════════════════════════════════════════
// Payment Routes - MoMo & SePay (VietQR) cho DB BANPHUKIEN
// ══════════════════════════════════════════════════════════════
const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db');
const { sendTelegramAlert, buildPaymentSuccessAlert } = require('../services/telegram');

const getPaymentConfig = () => ({
  momo: {
    partnerCode: process.env.MOMO_PARTNER_CODE || 'MOMO',
    accessKey: process.env.MOMO_ACCESS_KEY || 'F8BBA842ECF85',
    secretKey: process.env.MOMO_SECRET_KEY || 'K951B6PE1waDMi640xX08PD3vg6EkVlz',
    endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
  },
  sepay: {
    bankCode: process.env.SEPAY_BANK_CODE || 'MBBank',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '090123456789',
    accountName: process.env.SEPAY_ACCOUNT_NAME || 'CONG TY TNHH TRANG SUC LEGEND',
    template: process.env.SEPAY_TEMPLATE || 'compact2',
  },
  siteUrl: process.env.SITE_URL || 'http://localhost:3000',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3001',
});

// Helper: Tìm đơn hàng theo id (int) hoặc code (string như DH... hoặc #1089)
async function findOrder(identifier) {
  if (!identifier) return null;
  const raw = String(identifier).trim();
  const digits = raw.replace(/\D/g, '');

  // 1. Thử tìm theo code chính xác hoặc id int
  if (/^\d+$/.test(raw)) {
    const res = await pool.query(
      'SELECT * FROM orders WHERE id = $1 OR code = $2 OR code = $3 LIMIT 1',
      [parseInt(raw), raw, `#${raw}`]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  // 2. Tìm theo code string
  const resCode = await pool.query(
    'SELECT * FROM orders WHERE code = $1 OR code = $2 OR code ILIKE $3 LIMIT 1',
    [raw, `#${digits}`, `%${digits}%`]
  );
  return resCode.rows[0] || null;
}

// Helper: Cập nhật đơn thành đã thanh toán
async function markOrderAsPaid(order, gateway, transactionId, gatewayName) {
  const paymentMethod = gateway === 'momo' ? 'Ví MoMo' : `Chuyển khoản SePay (${gatewayName || 'VietQR'})`;

  await pool.query(
    `UPDATE orders 
     SET status = 'paid', payment_method = $1, updated_at = NOW() 
     WHERE id = $2`,
    [paymentMethod, order.id]
  );

  // Gửi Telegram alert
  sendTelegramAlert(buildPaymentSuccessAlert({
    id: order.code || order.id,
    total: order.total_amount,
    customer_name: order.shipping_name,
    customer_phone: order.shipping_phone,
    customer_address: order.shipping_addr,
  }, `${paymentMethod} (Mã GD: ${transactionId})`)).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// 1. MOMO PAYMENT
// ─────────────────────────────────────────────────────────────

// POST /api/payment/momo/create
router.post('/momo/create', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Thiếu orderId' });

    const order = await findOrder(orderId);
    if (!order) return res.status(404).json({ error: `Không tìm thấy đơn hàng ${orderId}` });

    const config = getPaymentConfig();
    const { partnerCode, accessKey, secretKey, endpoint } = config.momo;
    const amount = Math.round(parseFloat(order.total_amount || 0));

    const momoOrderId = `${(order.code || order.id).toString().replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
    const requestId = momoOrderId;
    const orderInfo = `Thanh toan don hang ${order.code || order.id}`;
    const redirectUrl = `${config.siteUrl}/order-success?id=${encodeURIComponent(order.code || order.id)}&payment=momo`;
    const ipnUrl = `${config.backendUrl}/api/payment/momo/ipn`;
    const requestType = 'captureWallet';
    const extraData = Buffer.from(JSON.stringify({ orderId: order.code || order.id })).toString('base64');

    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${momoOrderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');

    const requestBody = {
      partnerCode,
      partnerName: 'LEGEND Fine Jewelry',
      storeId: 'LegendJewelryStore',
      requestId,
      amount,
      orderId: momoOrderId,
      orderInfo,
      redirectUrl,
      ipnUrl,
      lang: 'vi',
      extraData,
      requestType,
      signature,
    };

    try {
      const momoRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await momoRes.json();
      if (data && data.payUrl) {
        return res.json(data);
      }
    } catch (momoErr) {
      console.warn('⚠️ Gọi API MoMo lỗi, dùng fallback sandbox:', momoErr.message);
    }

    // Fallback Sandbox QR
    const mockQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=2|99|0901234567|LEGEND|orders@legend.vn|0|0|${amount}|${order.code || order.id}|transfer_myqr`;
    return res.json({
      partnerCode,
      orderId: momoOrderId,
      requestId,
      amount,
      responseTime: Date.now(),
      message: 'Thành công (MoMo Sandbox Mode)',
      resultCode: 0,
      payUrl: redirectUrl,
      qrCodeUrl: mockQrUrl,
      deeplink: `momo://app?action=pay&amount=${amount}&orderId=${order.code || order.id}`,
    });
  } catch (err) {
    console.error('MoMo create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/momo/ipn
router.post('/momo/ipn', async (req, res) => {
  try {
    const payload = req.body;
    console.log('🔔 MoMo IPN Received:', payload);

    let orderId = '';
    if (payload.extraData) {
      try {
        const parsed = JSON.parse(Buffer.from(payload.extraData, 'base64').toString('utf-8'));
        orderId = parsed.orderId;
      } catch {}
    }

    if (!orderId && payload.orderId) {
      const match = payload.orderId.match(/^([^_]+)/);
      orderId = match ? match[1] : payload.orderId;
    }

    if (!orderId) return res.status(400).json({ message: 'Missing orderId' });

    if (payload.resultCode !== 0) {
      return res.json({ message: `MoMo resultCode: ${payload.resultCode}` });
    }

    const order = await findOrder(orderId);
    if (!order) return res.status(404).json({ message: `Không tìm thấy đơn ${orderId}` });

    await markOrderAsPaid(order, 'momo', payload.transId || Date.now(), 'Ví MoMo');

    return res.status(200).json({
      success: true,
      message: `Đã xác nhận MoMo cho đơn hàng ${order.code || order.id}`,
      orderId: order.code || order.id,
      transId: payload.transId,
    });
  } catch (err) {
    console.error('MoMo IPN error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. SEPAY VIETQR PAYMENT
// ─────────────────────────────────────────────────────────────

// GET /api/payment/sepay/info/:orderId
router.get('/sepay/info/:orderId', async (req, res) => {
  try {
    const order = await findOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: `Không tìm thấy đơn hàng ${req.params.orderId}` });

    const config = getPaymentConfig();
    const { bankCode, accountNumber, accountName, template } = config.sepay;
    const description = (order.code || `DH${order.id}`).replace(/[^a-zA-Z0-9]/g, '');
    const amount = Math.round(parseFloat(order.total_amount || 0));

    const qrUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(accountNumber)}&bank=${encodeURIComponent(
      bankCode
    )}&amount=${amount}&des=${encodeURIComponent(description)}&template=${template}`;

    res.json({
      orderId: order.id,
      code: order.code,
      bankCode,
      accountNumber,
      accountName,
      amount,
      description,
      qrUrl,
    });
  } catch (err) {
    console.error('SePay info error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/sepay/webhook
router.post('/sepay/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('🔔 SePay Webhook Received:', body);

    const content = body.transactionContent || body.body || '';
    const amountIn = parseInt(body.amountIn || 0);

    let matchedCode = null;
    const thucMatch = content.match(/THUC\s*(\d+)/i);
    const dhMatch = content.match(/DH\s*(\d+)/i);
    const legendMatch = content.match(/LEGEND\s*(\d+)/i);
    const numMatch = content.match(/#?(\d{4,})/);

    if (thucMatch) matchedCode = thucMatch[1];
    else if (dhMatch) matchedCode = `DH${dhMatch[1]}`;
    else if (legendMatch) matchedCode = legendMatch[1];
    else if (numMatch) matchedCode = numMatch[1];

    if (!matchedCode) {
      return res.json({ success: false, message: 'Không tìm thấy mã đơn trong nội dung' });
    }

    const order = await findOrder(matchedCode);
    if (!order) {
      return res.json({ success: false, message: `Không tìm thấy đơn khớp với mã ${matchedCode}` });
    }

    const reference = body.referenceNumber || `SEP-${body.id || Date.now()}`;
    await markOrderAsPaid(order, 'sepay', reference, body.gateway || 'VietQR');

    return res.json({
      success: true,
      message: `Đã xác nhận thanh toán đơn hàng ${order.code || order.id} số tiền ${amountIn}đ`,
      orderId: order.id,
      code: order.code,
      amountIn,
      reference,
    });
  } catch (err) {
    console.error('SePay webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. CHECK PAYMENT STATUS (POLLING CHO FRONTEND)
// ─────────────────────────────────────────────────────────────

// GET /api/payment/check/:orderId
router.get('/check/:orderId', async (req, res) => {
  try {
    const order = await findOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Đơn hàng không tồn tại' });

    let isPaid = order.status === 'paid' || order.status === 'completed';

    // NẾU CHƯA PAID: Tự động kiểm tra SePay Transactions API
    // Giúp tự động duyệt đơn ngay cả trên Localhost mà không cần ngrok webhook
    if (!isPaid && process.env.SEPAY_API_TOKEN) {
      try {
        const token = process.env.SEPAY_API_TOKEN;
        const accNum = process.env.SEPAY_ACCOUNT_NUMBER || '0363132364';
        const sepayRes = await fetch(
          `https://my.sepay.vn/userapi/transactions/list?account_number=${accNum}&limit=15`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (sepayRes.ok) {
          const sepayData = await sepayRes.json();
          const txs = sepayData.transactions || [];
          const digits = (order.code || `${order.id}`).replace(/\D/g, '');
          const orderAmount = Math.round(parseFloat(order.total_amount || 0));

          const matchTx = txs.find((t) => {
            const content = (t.transaction_content || '').toUpperCase();
            const amountIn = Math.round(parseFloat(t.amount_in || 0));
            const hasCode =
              digits &&
              (content.includes(`THUC${digits}`) ||
                content.includes(`DH${digits}`) ||
                content.includes(`LEGEND${digits}`) ||
                content.includes(digits));
            return hasCode && amountIn >= orderAmount;
          });

          if (matchTx) {
            console.log(
              `✅ Phát hiện giao dịch SePay khớp đơn ${order.code || order.id} qua SePay API:`,
              matchTx.reference_number
            );
            await markOrderAsPaid(
              order,
              'sepay',
              matchTx.reference_number || matchTx.id,
              matchTx.bank_brand_name || 'MBBank'
            );
            isPaid = true;
          }
        }
      } catch (checkErr) {
        console.warn('SePay API poll warning:', checkErr.message);
      }
    }

    res.json({
      orderId: order.id,
      code: order.code,
      isPaid,
      status: isPaid ? 'paid' : order.status,
      paymentMethod: order.payment_method,
      totalAmount: order.total_amount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
