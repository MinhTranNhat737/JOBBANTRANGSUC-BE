require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('../db');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const userResult = await pool.query(
    'SELECT id, email, role, full_name FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1',
    [email],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error('Customer account not found');
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m', algorithm: 'HS256', issuer: 'thuc-luxury-api' },
  );
  const response = await fetch('http://localhost:3001/api/orders?limit=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  console.log(JSON.stringify({ status: response.status, total: data.pagination?.total, orders: data.orders?.map((order) => ({ code: order.code, status: order.status, email: order.customer_email })) }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exit(1);
});
