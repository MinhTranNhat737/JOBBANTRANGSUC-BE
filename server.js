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
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
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

// ── Start ────────────────────────────────────────────────
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
