// ── Products Routes cho DB BANPHUKIEN ─────────────────────
const router = require('express').Router();
const pool = require('../db');

// GET /api/products - Lấy tất cả sản phẩm (filter theo category_id, brand_id, status, search, phân trang)
router.get('/', async (req, res) => {
  try {
    const { category, brand, status, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let where = [];
    let params = [];
    let i = 1;

    if (category) {
      if (/^\d+$/.test(category)) {
        where.push(`p.category_id = $${i++}`);
        params.push(parseInt(category));
      } else {
        where.push(`c.slug = $${i++}`);
        params.push(category);
      }
    }
    if (brand) {
      if (/^\d+$/.test(brand)) {
        where.push(`p.brand_id = $${i++}`);
        params.push(parseInt(brand));
      } else {
        where.push(`b.slug = $${i++}`);
        params.push(brand);
      }
    }
    if (status) {
      where.push(`p.status = $${i++}`);
      params.push(status);
    }
    if (search) {
      where.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.slug ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Count total
    const countQuery = `
      SELECT COUNT(*) FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Fetch products with category, brand and images
    const query = `
      SELECT 
        p.*,
        c.name AS category_name, c.slug AS category_slug,
        b.name AS brand_name, b.slug AS brand_slug,
        COALESCE(
          json_agg(
            json_build_object('id', pi.id, 'url', pi.url, 'sort_order', pi.sort_order, 'is_primary', pi.is_primary)
            ORDER BY pi.is_primary DESC, pi.sort_order ASC
          ) FILTER (WHERE pi.id IS NOT NULL), '[]'
        ) AS images
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      ${whereClause}
      GROUP BY p.id, c.id, b.id
      ORDER BY p.id ASC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    res.json({
      products: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:slugOrId - Chi tiết sản phẩm
router.get('/:slugOrId', async (req, res) => {
  try {
    const param = req.params.slugOrId;
    const isId = /^\d+$/.test(param);

    const whereCondition = isId ? 'p.id = $1' : 'p.slug = $1 OR p.sku = $1';

    const query = `
      SELECT 
        p.*,
        c.name AS category_name, c.slug AS category_slug,
        b.name AS brand_name, b.slug AS brand_slug,
        COALESCE(
          json_agg(
            json_build_object('id', pi.id, 'url', pi.url, 'sort_order', pi.sort_order, 'is_primary', pi.is_primary)
            ORDER BY pi.is_primary DESC, pi.sort_order ASC
          ) FILTER (WHERE pi.id IS NOT NULL), '[]'
        ) AS images
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE ${whereCondition}
      GROUP BY p.id, c.id, b.id
    `;

    const result = await pool.query(query, [isId ? parseInt(param) : param]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products - Tạo sản phẩm mới
router.post('/', async (req, res) => {
  try {
    const {
      sku,
      name,
      slug,
      description,
      category_id,
      brand_id,
      quantity = 0,
      import_price,
      sale_price,
      ctv_price,
      status = 'active',
      qc_status,
      note,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Tên sản phẩm là bắt buộc' });

    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const finalSku = sku || `SP${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await pool.query(
      `INSERT INTO products 
        (sku, name, slug, description, category_id, brand_id, quantity, import_price, sale_price, status, qc_status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        finalSku,
        name,
        finalSlug,
        description || null,
        category_id ? parseInt(category_id) : null,
        brand_id ? parseInt(brand_id) : null,
        parseInt(quantity || 0),
        import_price ? parseFloat(import_price) : null,
        sale_price ? parseFloat(sale_price) : null,
        status,
        qc_status || null,
        note || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id - Cập nhật sản phẩm
router.put('/:id', async (req, res) => {
  try {
    const {
      sku,
      name,
      slug,
      description,
      category_id,
      brand_id,
      quantity,
      import_price,
      sale_price,
      status,
      qc_status,
      note,
    } = req.body;

    const result = await pool.query(
      `UPDATE products 
       SET sku = COALESCE($1, sku),
           name = COALESCE($2, name),
           slug = COALESCE($3, slug),
           description = COALESCE($4, description),
           category_id = COALESCE($5, category_id),
           brand_id = COALESCE($6, brand_id),
           quantity = COALESCE($7, quantity),
           import_price = COALESCE($8, import_price),
           sale_price = COALESCE($9, sale_price),
           status = COALESCE($10, status),
           qc_status = COALESCE($11, qc_status),
           note = COALESCE($12, note),
           updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        sku,
        name,
        slug,
        description,
        category_id ? parseInt(category_id) : null,
        brand_id ? parseInt(brand_id) : null,
        quantity !== undefined ? parseInt(quantity) : null,
        import_price !== undefined ? parseFloat(import_price) : null,
        sale_price !== undefined ? parseFloat(sale_price) : null,
        status,
        qc_status,
        note,
        parseInt(req.params.id),
      ]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// DELETE /api/products/:id - Xóa sản phẩm
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({ message: 'Đã xóa sản phẩm', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
