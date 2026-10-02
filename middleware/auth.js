const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Yêu cầu đăng nhập' });
  }
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not configured');
    return res.status(503).json({ error: 'Dịch vụ xác thực chưa được cấu hình' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'thuc-luxury-api',
    });
    next();
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ quản trị viên được phép thực hiện thao tác này' });
  }
  next();
}

module.exports = { verifyToken, requireAdmin };
