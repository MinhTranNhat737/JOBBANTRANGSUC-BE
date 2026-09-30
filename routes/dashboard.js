// ── Dashboard / Stats Routes cho DB BANPHUKIEN ───────────────
const router = require('express').Router();
const pool = require('../db');

// GET /api/dashboard/stats - Thống kê tổng quan
router.get('/stats', async (req, res) => {
  try {
    const productCount = await pool.query('SELECT COUNT(*) FROM products');
    const orderCount = await pool.query('SELECT COUNT(*) FROM orders');
    const pendingOrders = await pool.query("SELECT COUNT(*) FROM orders WHERE status = 'pending'");
    const revenueResult = await pool.query(
      "SELECT COALESCE(SUM(total_amount), 0)::bigint AS total FROM orders WHERE status IN ('paid','completed')"
    );
    const customerCount = await pool.query('SELECT COUNT(*) FROM customers');
    const ctvCount = await pool.query('SELECT COUNT(*) FROM customers WHERE is_ctv = true');
    const stockResult = await pool.query('SELECT COALESCE(SUM(quantity), 0)::int AS total_stock FROM products');

    const recentOrders = await pool.query(`
      SELECT o.id, o.code, o.status, o.total_amount, o.created_at, o.shipping_name, o.payment_method
      FROM orders o
      ORDER BY o.created_at DESC
      LIMIT 5
    `);

    const topProducts = await pool.query(`
      SELECT p.name, p.sku, SUM(oi.quantity)::int AS total_sold, SUM(oi.unit_price * oi.quantity)::bigint AS revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 5
    `);

    res.json({
      products: {
        total: parseInt(productCount.rows[0].count),
        totalStock: parseInt(stockResult.rows[0].total_stock || 0),
      },
      orders: {
        total: parseInt(orderCount.rows[0].count),
        pending: parseInt(pendingOrders.rows[0].count),
      },
      revenue: {
        total: parseInt(revenueResult.rows[0].total),
      },
      customers: {
        total: parseInt(customerCount.rows[0].count),
        ctv: parseInt(ctvCount.rows[0].count),
      },
      recentOrders: recentOrders.rows,
      topProducts: topProducts.rows,
    });
  } catch (err) {
    console.error('GET /api/dashboard/stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
