// ══════════════════════════════════════════════════════════════
// Inventory Routes - Quản lý Kho hàng & Xuất Nhập tồn
// ══════════════════════════════════════════════════════════════
const router = require('express').Router();
const pool = require('../db');

// Tự động khởi tạo bảng inventory_logs nếu chưa có
async function initInventoryTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_logs (
        id SERIAL PRIMARY KEY,
        product_id INTEGER,
        product_name VARCHAR(255),
        product_sku VARCHAR(100),
        order_id VARCHAR(50),
        type VARCHAR(50) NOT NULL,
        change_qty INTEGER NOT NULL,
        previous_qty INTEGER,
        new_qty INTEGER,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.warn('Init inventory_logs table warning:', err.message);
  }
}
initInventoryTable();

// 1. GET /api/inventory - Lấy danh sách tồn kho & thống kê
router.get('/', async (req, res) => {
  try {
    const { status, category, search } = req.query;
    let where = [];
    let params = [];
    let i = 1;

    if (search) {
      where.push(`(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.slug ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    if (category) {
      where.push(`(c.slug = $${i} OR c.name ILIKE $${i})`);
      params.push(category);
      i++;
    }

    if (status === 'out_of_stock') {
      where.push(`p.quantity <= 0`);
    } else if (status === 'in_stock') {
      where.push(`p.quantity > 0`);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const query = `
      SELECT 
        p.id, p.sku, p.name, p.slug, p.quantity, p.sale_price, p.import_price, p.status, p.updated_at,
        c.name AS category_name, c.slug AS category_slug,
        b.name AS brand_name,
        COALESCE(
          json_agg(
            json_build_object('id', pi.id, 'url', pi.url, 'is_primary', pi.is_primary)
            ORDER BY pi.is_primary DESC, pi.sort_order ASC
          ) FILTER (WHERE pi.id IS NOT NULL), '[]'
        ) AS images
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      ${whereClause}
      GROUP BY p.id, c.id, b.id
      ORDER BY p.quantity ASC, p.id ASC
    `;

    const result = await pool.query(query, params);

    // Tính thống kê tổng kho (Luxury: > 0 là Còn hàng sẵn sàng, = 0 là Hết hàng)
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*)::int AS total_products,
        COALESCE(SUM(quantity), 0)::int AS total_units,
        COUNT(CASE WHEN quantity <= 0 THEN 1 END)::int AS out_of_stock_count,
        COUNT(CASE WHEN quantity > 0 THEN 1 END)::int AS in_stock_count
      FROM products
    `);

    res.json({
      products: result.rows,
      stats: statsResult.rows[0] || {
        total_products: 0,
        total_units: 0,
        out_of_stock_count: 0,
        in_stock_count: 0,
      },
    });
  } catch (err) {
    console.error('GET /api/inventory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /api/inventory/dispatch - Xuất kho cho đơn hàng & chuyển sang "shipping"
router.post('/dispatch', async (req, res) => {
  const client = await pool.connect();
  try {
    const { orderId, note } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Thiếu mã đơn hàng orderId' });
    }

    await client.query('BEGIN');

    // 1. Tìm đơn hàng
    const rawId = String(orderId).trim();
    const cleanId = rawId.replace(/^#/, '');
    const isNum = /^\d+$/.test(cleanId);

    const orderRes = await client.query(
      isNum
        ? 'SELECT * FROM orders WHERE id = $1 OR code = $2 OR code = $3 LIMIT 1'
        : 'SELECT * FROM orders WHERE code = $1 OR code = $2 LIMIT 1',
      isNum ? [parseInt(cleanId), rawId, `#${cleanId}`] : [rawId, `#${cleanId}`]
    );

    let order = orderRes.rows[0];

    // Lấy items của đơn từ DB hoặc từ payload
    let orderItems = [];
    if (order) {
      const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      orderItems = itemsRes.rows;
    }

    const itemsToProcess = (req.body.items && req.body.items.length > 0)
      ? req.body.items
      : orderItems;

    const dispatchedProducts = [];

    // 2. Trừ tồn kho cho từng sản phẩm trong đơn
    for (const it of itemsToProcess) {
      const qty = parseInt(it.quantity || 1);
      let foundProduct = null;

      // Tìm theo product_id
      if (it.product_id) {
        const pRes = await client.query('SELECT * FROM products WHERE id = $1', [parseInt(it.product_id)]);
        if (pRes.rows.length > 0) foundProduct = pRes.rows[0];
      }

      // Nếu chưa thấy, tìm theo slug hoặc tên
      if (!foundProduct && it.slug) {
        const pRes = await client.query('SELECT * FROM products WHERE slug = $1 LIMIT 1', [it.slug]);
        if (pRes.rows.length > 0) foundProduct = pRes.rows[0];
      }

      if (!foundProduct && it.name) {
        const pRes = await client.query('SELECT * FROM products WHERE name ILIKE $1 LIMIT 1', [`%${it.name.trim()}%`]);
        if (pRes.rows.length > 0) foundProduct = pRes.rows[0];
      }

      if (foundProduct) {
        const prevQty = foundProduct.quantity || 0;
        const newQty = Math.max(0, prevQty - qty);

        // Cập nhật tồn kho
        await client.query(
          'UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2',
          [newQty, foundProduct.id]
        );

        // Ghi log xuất kho
        await client.query(
          `INSERT INTO inventory_logs 
            (product_id, product_name, product_sku, order_id, type, change_qty, previous_qty, new_qty, note)
           VALUES ($1, $2, $3, $4, 'dispatch_order', $5, $6, $7, $8)`,
          [
            foundProduct.id,
            foundProduct.name,
            foundProduct.sku,
            rawId,
            -qty,
            prevQty,
            newQty,
            note || `Xuất kho giao cho đơn hàng ${rawId}`,
          ]
        );

        dispatchedProducts.push({
          id: foundProduct.id,
          name: foundProduct.name,
          sku: foundProduct.sku,
          deducted: qty,
          previousStock: prevQty,
          currentStock: newQty,
          isOutOfStock: newQty <= 0,
        });
      }
    }

    // 3. Cập nhật trạng thái đơn hàng thành 'shipping' (Đang giao)
    if (order) {
      await client.query(
        "UPDATE orders SET status = 'shipping', updated_at = NOW() WHERE id = $1",
        [order.id]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Đã xuất kho thành công cho đơn hàng ${rawId} và chuyển trạng thái sang "Đang giao"`,
      orderId: rawId,
      dispatchedProducts,
      status: 'shipping',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/inventory/dispatch error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// 3. POST /api/inventory/adjust - Nhập thêm hàng hoặc chỉnh sửa số lượng tồn
router.post('/adjust', async (req, res) => {
  try {
    const { productId, change = 0, newQuantity, type = 'import', note } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'Thiếu productId' });
    }

    const pRes = await pool.query('SELECT * FROM products WHERE id = $1', [parseInt(productId)]);
    if (pRes.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }

    const product = pRes.rows[0];
    const prevQty = product.quantity || 0;
    let finalQty = prevQty;

    if (newQuantity !== undefined) {
      finalQty = Math.max(0, parseInt(newQuantity));
    } else {
      finalQty = Math.max(0, prevQty + parseInt(change));
    }

    const diff = finalQty - prevQty;

    await pool.query('UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2', [
      finalQty,
      product.id,
    ]);

    // Ghi log
    await pool.query(
      `INSERT INTO inventory_logs 
        (product_id, product_name, product_sku, type, change_qty, previous_qty, new_qty, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        product.id,
        product.name,
        product.sku,
        type,
        diff,
        prevQty,
        finalQty,
        note || (diff > 0 ? `Nhập thêm +${diff} sản phẩm vào kho` : `Điều chỉnh kho ${diff} sản phẩm`),
      ]
    );

    res.json({
      success: true,
      message: `Đã cập nhật tồn kho cho "${product.name}": ${prevQty} ➜ ${finalQty}`,
      product: {
        id: product.id,
        name: product.name,
        previousStock: prevQty,
        currentStock: finalQty,
        isOutOfStock: finalQty <= 0,
      },
    });
  } catch (err) {
    console.error('POST /api/inventory/adjust error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/inventory/logs - Lấy lịch sử xuất - nhập kho
router.get('/logs', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await pool.query(
      `SELECT * FROM inventory_logs ORDER BY created_at DESC LIMIT $1`,
      [parseInt(limit)]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error('GET /api/inventory/logs error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
