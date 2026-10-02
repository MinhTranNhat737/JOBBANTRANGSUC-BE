require('dotenv').config();
const pool = require('../db');

async function main() {
  const orders = await pool.query(
    `SELECT id, code, customer_id, customer_email, shipping_name, shipping_phone, total_amount,
            status, payment_method, payment_gateway, payment_status, transaction_id, paid_at, created_at, updated_at
     FROM orders ORDER BY created_at DESC LIMIT 10`,
  );
  const logs = await pool.query(
    `SELECT id, order_id, product_name, type, change_qty, previous_qty, new_qty, created_at
     FROM inventory_logs ORDER BY created_at DESC LIMIT 10`,
  );
  const users = await pool.query(
    `SELECT id, username, email, role, is_active FROM users
     WHERE LOWER(email) IN (SELECT LOWER(customer_email) FROM orders WHERE customer_email IS NOT NULL)`,
  );
  console.log(JSON.stringify({ orders: orders.rows, users: users.rows, inventoryLogs: logs.rows }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exit(1);
});
