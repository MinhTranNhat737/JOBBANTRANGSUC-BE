// ── Customers Routes cho DB BANPHUKIEN ─────────────────────
const router = require('express').Router();
const pool = require('../db');

// GET /api/customers - Lấy tất cả khách hàng
router.get('/', async (req, res) => {
  try {
    const { is_ctv, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = [];
    let params = [];
    let i = 1;

    if (is_ctv !== undefined) {
      where.push(`c.is_ctv = $${i++}`);
      params.push(is_ctv === 'true');
    }
    if (search) {
      where.push(`(c.full_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM customers c ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const query = `
      SELECT c.*, 
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::bigint AS total_spent
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);
    res.json({
      customers: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('GET /api/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Khách hàng không tồn tại' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers
router.post('/', async (req, res) => {
  try {
    const { full_name, email, phone, address, is_ctv = false } = req.body;
    if (!full_name) return res.status(400).json({ error: 'Họ tên là bắt buộc' });

    const result = await pool.query(
      `INSERT INTO customers (full_name, email, phone, address, is_ctv)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [full_name, email || null, phone || null, address || null, Boolean(is_ctv)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/:id
router.put('/:id', async (req, res) => {
  try {
    const { full_name, email, phone, address, is_ctv } = req.body;
    const result = await pool.query(
      `UPDATE customers 
       SET full_name = COALESCE($1, full_name), 
           email = COALESCE($2, email), 
           phone = COALESCE($3, phone), 
           address = COALESCE($4, address),
           is_ctv = COALESCE($5, is_ctv)
       WHERE id = $6 RETURNING *`,
      [full_name, email, phone, address, is_ctv !== undefined ? Boolean(is_ctv) : null, parseInt(req.params.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
