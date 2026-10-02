// ── Categories Routes cho DB BANPHUKIEN ────────────────────
const router = require('express').Router();
const pool = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// GET /api/categories - Lấy tất cả danh mục (kèm số lượng sản phẩm)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
        COUNT(p.id)::int AS product_count,
        pc.name AS parent_name
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_id = pc.id
      GROUP BY c.id, pc.name
      ORDER BY c.sort_order, c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories/:slugOrId
router.get('/:slugOrId', async (req, res) => {
  try {
    const param = req.params.slugOrId;
    const isNum = /^\d+$/.test(param);
    const query = isNum ? 'SELECT * FROM categories WHERE id = $1' : 'SELECT * FROM categories WHERE slug = $1';
    const result = await pool.query(query, [isNum ? parseInt(param) : param]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Danh mục không tồn tại' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/categories
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, slug, parent_id, sort_order = 0 } = req.body;
    if (!name) return res.status(400).json({ error: 'Tên danh mục là bắt buộc' });
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const result = await pool.query(
      'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, finalSlug, parent_id ? parseInt(parent_id) : null, parseInt(sort_order)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/categories/:id
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, slug, parent_id, sort_order } = req.body;
    const result = await pool.query(
      `UPDATE categories 
       SET name = COALESCE($1, name), 
           slug = COALESCE($2, slug), 
           parent_id = COALESCE($3, parent_id), 
           sort_order = COALESCE($4, sort_order) 
       WHERE id = $5 RETURNING *`,
      [name, slug, parent_id ? parseInt(parent_id) : null, sort_order !== undefined ? parseInt(sort_order) : null, parseInt(req.params.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({ message: 'Đã xóa danh mục', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
