// ── Brands Routes cho DB BANPHUKIEN ────────────────────────
const router = require('express').Router();
const pool = require('../db');

// GET /api/brands
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, COUNT(p.id)::int AS product_count
      FROM brands b
      LEFT JOIN products p ON p.brand_id = b.id
      GROUP BY b.id
      ORDER BY b.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/brands error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brands/:slugOrId
router.get('/:slugOrId', async (req, res) => {
  try {
    const param = req.params.slugOrId;
    const isNum = /^\d+$/.test(param);
    const query = isNum ? 'SELECT * FROM brands WHERE id = $1' : 'SELECT * FROM brands WHERE slug = $1';
    const result = await pool.query(query, [isNum ? parseInt(param) : param]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Thương hiệu không tồn tại' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brands
router.post('/', async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên thương hiệu là bắt buộc' });
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const result = await pool.query(
      'INSERT INTO brands (name, slug) VALUES ($1, $2) RETURNING *',
      [name, finalSlug]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/brands/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, slug } = req.body;
    const result = await pool.query(
      'UPDATE brands SET name = COALESCE($1, name), slug = COALESCE($2, slug) WHERE id = $3 RETURNING *',
      [name, slug, parseInt(req.params.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/brands/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({ message: 'Đã xóa thương hiệu', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
