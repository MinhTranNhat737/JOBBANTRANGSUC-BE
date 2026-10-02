const { Resend } = require('resend');

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({
    from: process.env.EMAIL_FROM || 'THUC LUXURY <onboarding@resend.dev>',
    to, subject, html,
  });
}

const shell = (title, content) => `<!doctype html><html><body style="background:#111;color:#eee;font-family:Arial;padding:32px"><div style="max-width:600px;margin:auto;border:1px solid #444;padding:32px"><h1 style="letter-spacing:4px">THUC LUXURY</h1><h2>${title}</h2>${content}<p style="color:#aaa;margin-top:32px">Email tự động, vui lòng không trả lời.</p></div></body></html>`;

function sendPasswordReset(to, name, url) {
  return sendEmail({ to, subject: 'Đặt lại mật khẩu THUC LUXURY', html: shell('Đặt lại mật khẩu', `<p>Xin chào ${name || ''},</p><p>Liên kết có hiệu lực 30 phút.</p><p><a style="color:#d4af37" href="${url}">Đặt lại mật khẩu</a></p>`) });
}
function sendOrderConfirmation(order) {
  return sendEmail({ to: order.customer_email, subject: `Xác nhận đơn ${order.code}`, html: shell('Đã nhận đơn hàng', `<p>Đơn <b>${order.code}</b> đã được tiếp nhận.</p><p>Tổng tiền: <b>${Number(order.total_amount).toLocaleString('vi-VN')}đ</b></p>`) });
}
function sendOrderStatus(order, label) {
  return sendEmail({ to: order.customer_email, subject: `${order.code}: ${label}`, html: shell('Cập nhật đơn hàng', `<p>Đơn <b>${order.code}</b> hiện ở trạng thái: <b>${label}</b>.</p>`) });
}

module.exports = { sendEmail, sendPasswordReset, sendOrderConfirmation, sendOrderStatus };
