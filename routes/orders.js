// ── Orders Routes cho DB BANPHUKIEN ───────────────────────
const router = require('express').Router();
const pool = require('../db');

// GET /api/orders - Lấy tất cả đơn hàng (filter, phân trang)
router.get('/', async (req, res) => {
  try {
    const { status, customer_id, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = [];
    let params = [];
    let i = 1;

    if (status) {
      where.push(`o.status = $${i++}`);
      params.push(status);
    }
    if (customer_id) {
      where.push(`o.customer_id = $${i++}`);
      params.push(parseInt(customer_id));
    }
    if (search) {
      where.push(`(o.code ILIKE $${i} OR o.shipping_name ILIKE $${i} OR o.shipping_phone ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM orders o ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const query = `
      SELECT o.*, 
        c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'product_id', oi.product_id, 'name', oi.name,
              'unit_price', oi.unit_price, 'quantity', oi.quantity
            )
          ) FILTER (WHERE oi.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${whereClause}
      GROUP BY o.id, c.id
      ORDER BY o.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      orders: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:idOrCode - Lấy chi tiết đơn theo ID (int) hoặc code (string)
router.get('/:idOrCode', async (req, res) => {
  try {
    const raw = req.params.idOrCode;
    const isNum = /^\d+$/.test(raw);

    const query = isNum
      ? `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone 
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = $1 OR o.code = $2`
      : `SELECT o.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone 
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.code = $1 OR o.code = $2`;

    const params = isNum ? [parseInt(raw), raw] : [raw, `#${raw.replace('#', '')}`];
    const orderResult = await pool.query(query, params);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }

    const order = orderResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT oi.*, p.sku, p.slug AS product_slug 
       FROM order_items oi 
       LEFT JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id = $1`,
      [order.id]
    );
    order.items = itemsResult.rows;

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders - Tạo đơn hàng mới
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      code,
      customer_id,
      payment_method = 'cod',
      shipping_name,
      shipping_phone,
      shipping_addr,
      note,
      items = [],
    } = req.body;

    const orderCode = code || `DH${Date.now().toString().slice(-8)}`;

    // Tính tổng tiền
    let total_amount = 0;
    if (items && items.length > 0) {
      total_amount = items.reduce((sum, it) => sum + (parseFloat(it.unit_price || it.price || 0) * (it.quantity || 1)), 0);
    }

    const orderResult = await client.query(
      `INSERT INTO orders 
        (code, customer_id, status, payment_method, total_amount, shipping_name, shipping_phone, shipping_addr, note)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        orderCode,
        customer_id ? parseInt(customer_id) : null,
        payment_method,
        total_amount,
        shipping_name || null,
        shipping_phone || null,
        shipping_addr || null,
        note || null,
      ]
    );

    const order = orderResult.rows[0];

    // Thêm các món hàng & giảm tồn kho
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            order.id,
            item.product_id ? parseInt(item.product_id) : null,
            item.name,
            parseFloat(item.unit_price || item.price || 0),
            parseInt(item.quantity || 1),
          ]
        );

        if (item.product_id) {
          await client.query(
            'UPDATE products SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE id = $2',
            [parseInt(item.quantity || 1), parseInt(item.product_id)]
          );
        }
      }
    }

    await client.query('COMMIT');

    // Lấy lại đơn hàng đầy đủ
    const fullOrder = await pool.query(
      `SELECT o.*, 
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'product_id', oi.product_id, 'name', oi.name,
              'unit_price', oi.unit_price, 'quantity', oi.quantity
            )
          ) FILTER (WHERE oi.id IS NOT NULL), '[]'
        ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [order.id]
    );

    res.status(201).json(fullOrder.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/orders error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/orders/:idOrCode/status - Cập nhật trạng thái đơn
router.patch('/:idOrCode/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'paid', 'shipping', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ', valid: validStatuses });
    }

    const raw = req.params.idOrCode;
    const isNum = /^\d+$/.test(raw);

    const query = isNum
      ? 'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 OR code = $3 RETURNING *'
      : 'UPDATE orders SET status = $1, updated_at = NOW() WHERE code = $2 OR code = $3 RETURNING *';

    const params = isNum ? [status, parseInt(raw), raw] : [status, raw, `#${raw.replace('#', '')}`];
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }

    const order = result.rows[0];

    // Nếu hủy đơn thì hoàn lại tồn kho
    if (status === 'cancelled') {
      const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      for (const it of items.rows) {
        if (it.product_id) {
          await pool.query(
            'UPDATE products SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2',
            [it.quantity, it.product_id]
          );
        }
      }
    }

    res.json(order);
  } catch (err) {
    console.error('PATCH /api/orders/:id/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id, code', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    res.json({ message: 'Đã xóa đơn hàng', deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
