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
        COALESCE(c.full_name, o.shipping_name) AS customer_name,
        COALESCE(c.email, o.customer_email) AS customer_email,
        COALESCE(c.phone, o.shipping_phone) AS customer_phone,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'product_id', oi.product_id, 'name', oi.name,
              'unit_price', oi.unit_price, 'quantity', oi.quantity,
              'image', oi.image, 'size', oi.size, 'product_slug', oi.product_slug
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
      ? `SELECT o.*, COALESCE(c.full_name, o.shipping_name) AS customer_name, COALESCE(c.email, o.customer_email) AS customer_email, COALESCE(c.phone, o.shipping_phone) AS customer_phone 
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = $1 OR o.code = $2`
      : `SELECT o.*, COALESCE(c.full_name, o.shipping_name) AS customer_name, COALESCE(c.email, o.customer_email) AS customer_email, COALESCE(c.phone, o.shipping_phone) AS customer_phone 
         FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.code = $1 OR o.code = $2`;

    const params = isNum ? [parseInt(raw), raw] : [raw, `#${raw.replace('#', '')}`];
    const orderResult = await pool.query(query, params);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Đơn hàng không tồn tại' });
    }

    const order = orderResult.rows[0];

    const itemsResult = await pool.query(
      `SELECT oi.*, p.sku, COALESCE(oi.product_slug, p.slug) AS product_slug 
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
      customer_email,
      payment_method = 'cod',
      shipping_name,
      shipping_phone,
      shipping_addr,
      note,
      items = [],
    } = req.body;

    let orderCode = code ? String(code).trim() : null;

    // Kiểm tra xem mã đơn này đã tồn tại trong database chưa (tránh trùng lặp / double submit)
    if (orderCode) {
      const existing = await client.query('SELECT id FROM orders WHERE code = $1', [orderCode]);
      if (existing.rows.length > 0) {
        // Đơn hàng đã tồn tại, hoàn tất transaction và trả về đơn đã có (idempotency - chống sinh đơn đôi)
        await client.query('COMMIT');
        const existingOrder = await pool.query(
          `SELECT o.*, 
            COALESCE(c.full_name, o.shipping_name) AS customer_name,
            COALESCE(c.email, o.customer_email) AS customer_email,
            COALESCE(c.phone, o.shipping_phone) AS customer_phone,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', oi.id, 'product_id', oi.product_id, 'name', oi.name,
                  'unit_price', oi.unit_price, 'quantity', oi.quantity,
                  'image', oi.image, 'size', oi.size, 'product_slug', oi.product_slug
                )
              ) FILTER (WHERE oi.id IS NOT NULL), '[]'
            ) AS items
           FROM orders o
           LEFT JOIN customers c ON o.customer_id = c.id
           LEFT JOIN order_items oi ON oi.order_id = o.id
           WHERE o.id = $1
           GROUP BY o.id, c.id`,
          [existing.rows[0].id]
        );
        return res.status(200).json(existingOrder.rows[0]);
      }
    }

    // Nếu không có mã truyền lên, tự động sinh mã mới dạng #XXXX tăng dần
    if (!orderCode) {
      const maxRes = await client.query(`
        SELECT code FROM orders 
        WHERE code ~ '^#[0-9]+$' 
        ORDER BY LENGTH(code) DESC, code DESC 
        LIMIT 1
      `);
      let nextNum = 1001;
      if (maxRes.rows.length > 0) {
        const lastCode = maxRes.rows[0].code;
        const parsed = parseInt(lastCode.replace(/\D/g, ''), 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }
      orderCode = `#${nextNum}`;
    }

    // Tính tổng tiền
    let total_amount = 0;
    if (items && items.length > 0) {
      total_amount = items.reduce((sum, it) => sum + (parseFloat(it.unit_price || it.price || 0) * (it.quantity || 1)), 0);
    }

    // 1. Xác định customer_id hợp lệ (tránh vi phạm Foreign Key REFERENCES customers(id))
    let validCustomerId = null;
    if (customer_id && !isNaN(parseInt(customer_id, 10))) {
      const cCheck = await client.query('SELECT id FROM customers WHERE id = $1', [parseInt(customer_id, 10)]);
      if (cCheck.rows.length > 0) {
        validCustomerId = cCheck.rows[0].id;
      }
    }
    // Nếu chưa tìm thấy theo ID, đối soát theo email hoặc số điện thoại trong bảng customers
    if (!validCustomerId && (customer_email || shipping_phone)) {
      const cFind = await client.query(
        `SELECT id FROM customers 
         WHERE (LOWER(email) = LOWER($1) AND $1 IS NOT NULL AND $1 <> '') 
            OR (phone = $2 AND $2 IS NOT NULL AND $2 <> '') 
         LIMIT 1`,
        [customer_email ? customer_email.trim() : null, shipping_phone ? shipping_phone.trim() : null]
      );
      if (cFind.rows.length > 0) {
        validCustomerId = cFind.rows[0].id;
      } else if (shipping_name && (customer_email || shipping_phone)) {
        // Tự động thêm khách hàng mới vào bảng customers để liên kết đơn hàng
        try {
          const newCust = await client.query(
            `INSERT INTO customers (full_name, email, phone, address, is_ctv) 
             VALUES ($1, $2, $3, $4, false) 
             RETURNING id`,
            [
              shipping_name.trim(),
              customer_email ? customer_email.trim().toLowerCase() : null,
              shipping_phone ? shipping_phone.trim() : null,
              shipping_addr || null,
            ]
          );
          validCustomerId = newCust.rows[0].id;
        } catch (cErr) {
          console.warn('Auto create customer warning:', cErr.message);
        }
      }
    }

    // Insert đơn hàng với customer_id an toàn tuyệt đối
    const orderResult = await client.query(
      `INSERT INTO orders 
        (code, customer_id, customer_email, status, payment_method, total_amount, shipping_name, shipping_phone, shipping_addr, note)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        orderCode,
        validCustomerId,
        customer_email || null,
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
        let prodId = null;
        if (item.product_id && !isNaN(parseInt(item.product_id, 10))) {
          const pCheck = await client.query('SELECT id FROM products WHERE id = $1', [parseInt(item.product_id, 10)]);
          if (pCheck.rows.length > 0) {
            prodId = pCheck.rows[0].id;
          }
        }

        const itemSlug = item.slug || item.product_slug || null;
        // Nếu chưa có prodId nhưng có slug, tra cứu id trong bảng products
        if (!prodId && itemSlug) {
          const pRes = await client.query('SELECT id FROM products WHERE slug = $1 LIMIT 1', [itemSlug]);
          if (pRes.rows.length > 0) {
            prodId = pRes.rows[0].id;
          }
        }

        const itemImage = item.image || null;
        const itemSize = item.size || null;
        const unitPrice = parseFloat(item.unit_price || item.price || 0) || 0;
        const quantity = parseInt(item.quantity || 1, 10) || 1;

        try {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, image, size, product_slug)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              order.id,
              prodId,
              item.name || 'Sản phẩm',
              unitPrice,
              quantity,
              itemImage,
              itemSize,
              itemSlug,
            ]
          );
        } catch (itemErr) {
          // Fallback nếu cột image / size chưa có
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              order.id,
              prodId,
              item.name || 'Sản phẩm',
              unitPrice,
              quantity,
            ]
          );
        }

        if (prodId) {
          await client.query(
            'UPDATE products SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE id = $2',
            [quantity, prodId]
          );
        }
      }
    }

    await client.query('COMMIT');

    // Lấy lại đơn hàng đầy đủ
    const fullOrder = await pool.query(
      `SELECT o.*, 
        COALESCE(c.full_name, o.shipping_name) AS customer_name,
        COALESCE(c.email, o.customer_email) AS customer_email,
        COALESCE(c.phone, o.shipping_phone) AS customer_phone,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'product_id', oi.product_id, 'name', oi.name,
              'unit_price', oi.unit_price, 'quantity', oi.quantity,
              'image', oi.image, 'size', oi.size, 'product_slug', oi.product_slug
            )
          ) FILTER (WHERE oi.id IS NOT NULL), '[]'
        ) AS items
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id, c.id`,
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

// GET /api/orders/fix-constraint - Tự động sửa ràng buộc status
router.get('/fix-constraint', async (req, res) => {
  try {
    const constrBefore = await pool.query("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'orders'::regclass");
    await pool.query("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check");
    await pool.query("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'paid', 'shipping', 'delivered', 'completed', 'cancelled'))");
    const constrAfter = await pool.query("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'orders'::regclass");
    res.json({ success: true, before: constrBefore.rows, after: constrAfter.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:idOrCode/status - Cập nhật trạng thái đơn
router.patch('/:idOrCode/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'paid', 'shipping', 'delivered', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ', valid: validStatuses });
    }

    const raw = req.params.idOrCode;
    const isNum = /^\d+$/.test(raw);

    const query = isNum
      ? 'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 OR code = $3 RETURNING *'
      : 'UPDATE orders SET status = $1, updated_at = NOW() WHERE code = $2 OR code = $3 RETURNING *';

    const params = isNum ? [status, parseInt(raw), raw] : [status, raw, `#${raw.replace('#', '')}`];
    
    let result;
    try {
      result = await pool.query(query, params);
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('orders_status_check')) {
        // Tự động gỡ bỏ ràng buộc cũ và cập nhật ràng buộc mới
        await pool.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check');
        await pool.query("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'paid', 'shipping', 'delivered', 'completed', 'cancelled'))");
        result = await pool.query(query, params);
      } else {
        throw dbErr;
      }
    }

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
