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
      where.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.slug ILIKE $${i} OR p.description ILIKE $${i} OR b.name ILIKE $${i} OR c.name ILIKE $${i})`);
      params.push(`%${search.trim()}%`);
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
      sizes,
      badge,
      images,
      image,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Tên sản phẩm là bắt buộc' });

    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const finalSku = sku || `SP${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await pool.query(
      `INSERT INTO products 
        (sku, name, slug, description, category_id, brand_id, quantity, import_price, sale_price, status, qc_status, note, sizes, badge)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        Array.isArray(sizes) ? sizes : null,
        badge || null,
      ]
    );

    const newProd = result.rows[0];

    // Lưu ảnh nếu có
    if (Array.isArray(images) && images.length > 0) {
      for (let idx = 0; idx < images.length; idx++) {
        const item = images[idx];
        const url = typeof item === 'string' ? item : item.url;
        const isPrimary = typeof item === 'object' && item.is_primary !== undefined ? Boolean(item.is_primary) : (idx === 0);
        if (url && url.trim()) {
          await pool.query(
            'INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES ($1, $2, $3, $4)',
            [newProd.id, url.trim(), isPrimary, idx]
          );
        }
      }
    } else if (typeof image === 'string' && image.trim()) {
      await pool.query(
        'INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES ($1, $2, true, 0)',
        [newProd.id, image.trim()]
      );
    }

    res.status(201).json(newProd);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:idOrSlug - Cập nhật sản phẩm & hình ảnh
router.put('/:idOrSlug', async (req, res) => {
  try {
    const isId = /^\d+$/.test(req.params.idOrSlug);
    let productId;
    if (isId) {
      productId = parseInt(req.params.idOrSlug);
    } else {
      const pFind = await pool.query('SELECT id FROM products WHERE slug = $1', [req.params.idOrSlug]);
      if (pFind.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      productId = pFind.rows[0].id;
    }

    const { images, image } = req.body;
    const allowedFields = [
      'sku', 'name', 'slug', 'description', 'category_id', 'brand_id',
      'quantity', 'import_price', 'sale_price', 'status', 'qc_status', 'note',
      'sizes', 'badge'
    ];
    let updates = [];
    let params = [];
    let idx = 1;

    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        let val = req.body[f];
        if (f === 'sizes') {
          val = Array.isArray(val) ? val : null;
        } else if (f === 'category_id' || f === 'brand_id' || f === 'quantity') {
          val = val !== null && val !== '' ? parseInt(val) : null;
        } else if (f === 'import_price' || f === 'sale_price') {
          val = val !== null && val !== '' ? parseFloat(val) : null;
        }
        updates.push(`"${f}" = $${idx++}`);
        params.push(val);
      }
    }
    updates.push(`updated_at = NOW()`);
    params.push(productId);

    let result;
    if (updates.length > 1) {
      const updateQuery = `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
      result = await pool.query(updateQuery, params);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }

    // Cập nhật danh sách ảnh nếu được truyền lên
    if (Array.isArray(images) && images.length > 0) {
      await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      for (let idx = 0; idx < images.length; idx++) {
        const item = images[idx];
        const url = typeof item === 'string' ? item : item.url;
        const isPrimary = typeof item === 'object' && item.is_primary !== undefined ? Boolean(item.is_primary) : (idx === 0);
        if (url && url.trim()) {
          await pool.query(
            'INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES ($1, $2, $3, $4)',
            [productId, url.trim(), isPrimary, idx]
          );
        }
      }
    } else if (typeof image === 'string' && image.trim()) {
      await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
      await pool.query(
        'INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES ($1, $2, true, 0)',
        [productId, image.trim()]
      );
    }

    // Lấy lại dữ liệu đầy đủ kèm images
    const updatedQuery = `
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
      WHERE p.id = $1
      GROUP BY p.id, c.id, b.id
    `;
    const fullResult = await pool.query(updatedQuery, [productId]);
    res.json(fullResult.rows[0] || result.rows[0]);
  } catch (err) {
    console.error('PUT /api/products error:', err);
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
