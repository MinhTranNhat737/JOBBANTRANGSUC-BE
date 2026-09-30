// ── Telegram Notification Service ──────────────────────────
function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN').format(amount || 0) + '₫';
}

async function sendTelegramAlert(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('ℹ️ Telegram Notification skipped (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set)');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('⚠️ Telegram send failed:', data.description);
      return false;
    }
    console.log('✅ Telegram alert sent successfully');
    return true;
  } catch (err) {
    console.warn('⚠️ Telegram notification error:', err.message);
    return false;
  }
}

function buildPaymentSuccessAlert(order, paymentDetail) {
  return `
👑 <b>THANH TOÁN THÀNH CÔNG - THUC LUXURY</b> 👑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 <b>Mã đơn:</b> <code>${order.id || order.code}</code>
⚡ <b>Trạng thái:</b> ✅ ĐÃ THANH TOÁN
💳 <b>Cổng thanh toán:</b> ${paymentDetail}
💰 <b>Tổng tiền:</b> <b>${formatVND(order.total || order.total_amount)}</b>
👤 <b>Khách hàng:</b> ${order.customer_name || 'Khách vãng lai'}
📞 <b>SĐT:</b> ${order.customer_phone || 'N/A'}
📍 <b>Địa chỉ:</b> ${order.customer_address || 'N/A'}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

module.exports = {
  sendTelegramAlert,
  buildPaymentSuccessAlert,
  formatVND,
};
