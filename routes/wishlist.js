const router = require('express').Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.slug, p.name, p.sale_price, pi.url AS image
       FROM wishlists w
       JOIN products p ON p.id = w.product_id
       LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
       WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
      [req.user.sub],
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { productId, slug } = req.body;
    const product = await pool.query(
      'SELECT id FROM products WHERE id = $1 OR slug = $2 LIMIT 1',
      [Number(productId) || 0, String(slug || '')],
    );
    if (!product.rows[0]) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    await pool.query(
      'INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.sub, product.rows[0].id],
    );
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:slugOrId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM wishlists w USING products p
       WHERE w.product_id = p.id AND w.user_id = $1
         AND (p.slug = $2 OR p.id::text = $2)`,
      [req.user.sub, req.params.slugOrId],
    );
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
