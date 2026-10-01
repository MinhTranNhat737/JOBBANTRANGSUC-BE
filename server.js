// ══════════════════════════════════════════════════════════
// ACCESSORY SHOP - Backend API Server
// Express.js + PostgreSQL (node-postgres)
// ══════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────
// Hỗ trợ cấu hình CORS linh hoạt khi deploy lên Heroku
const rawCorsOrigin = process.env.CORS_ORIGIN;
let corsOptions = { credentials: true };
if (rawCorsOrigin) {
  if (rawCorsOrigin === '*') {
    corsOptions.origin = true;
  } else {
    const origins = rawCorsOrigin.split(',').map((o) => o.trim());
    corsOptions.origin = origins.length === 1 ? origins[0] : origins;
  }
} else {
  corsOptions.origin = ['http://localhost:3000', 'http://127.0.0.1:3000'];
}
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log requests (dev)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));

// ── Health check ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const pool = require('./db');
  try {
    const result = await pool.query('SELECT NOW() AS time');
    res.json({ status: 'ok', database: 'connected', time: result.rows[0].time });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// ── 404 ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} không tồn tại` });
});

// ── Error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Lỗi server nội bộ' });
});

// ── Start (v4) ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🚀 ACCESSORY SHOP API Server                   ║
║  Running on: http://localhost:${PORT}              ║
║  Database:   ${process.env.DB_NAME || 'BANPHUKIEN'}                 ║
╚══════════════════════════════════════════════════╝

API Endpoints:
  GET    /api/health              Health check
  GET    /api/products            Danh sách sản phẩm
  GET    /api/products/:slug      Chi tiết sản phẩm
  POST   /api/products            Tạo sản phẩm
  PUT    /api/products/:id        Cập nhật sản phẩm
  DELETE /api/products/:id        Xóa sản phẩm
  POST   /api/products/:id/images Thêm ảnh sản phẩm
  GET    /api/categories          Danh mục
  GET    /api/brands              Thương hiệu
  GET    /api/customers           Khách hàng
  GET    /api/orders              Đơn hàng
  POST   /api/orders              Tạo đơn hàng
  PATCH  /api/orders/:id/status   Cập nhật trạng thái
  POST   /api/auth/login          Đăng nhập admin
  GET    /api/dashboard/stats     Thống kê tổng quan
  `);
});
