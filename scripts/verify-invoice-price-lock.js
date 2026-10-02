require('dotenv').config();
const pool = require('../db');

async function main() {
  const item = await pool.query(
    `SELECT oi.id, oi.unit_price, p.sale_price, o.code
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     ORDER BY oi.id DESC LIMIT 1`,
  );
  if (!item.rows[0]) throw new Error('No order item available for verification');

  const client = await pool.connect();
  let locked = false;
  let productChangeKeepsInvoice = false;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE order_items SET unit_price = unit_price + 1 WHERE id = $1', [item.rows[0].id]);
  } catch (error) {
    locked = /immutable|đơn giá/i.test(error.message);
  } finally {
    await client.query('ROLLBACK');
  }

  if (item.rows[0].sale_price !== null) {
    try {
      await client.query('BEGIN');
      await client.query('UPDATE products SET sale_price = sale_price + 1 WHERE id = (SELECT product_id FROM order_items WHERE id = $1)', [item.rows[0].id]);
      const snapshot = await client.query('SELECT unit_price FROM order_items WHERE id = $1', [item.rows[0].id]);
      productChangeKeepsInvoice = String(snapshot.rows[0].unit_price) === String(item.rows[0].unit_price);
    } finally {
      await client.query('ROLLBACK');
    }
  }
  client.release();

  console.log(JSON.stringify({
    order: item.rows[0].code,
    invoiceUnitPrice: item.rows[0].unit_price,
    currentProductPrice: item.rows[0].sale_price,
    invoicePriceLocked: locked,
    productPriceChangeKeepsOldInvoice: productChangeKeepsInvoice,
  }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exit(1);
});
