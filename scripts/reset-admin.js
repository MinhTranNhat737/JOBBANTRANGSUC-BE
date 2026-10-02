require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');

async function main() {
  const [username, email, password] = process.argv.slice(2);
  if (!username || !email || !password || password.length < 8) {
    throw new Error('Usage: node scripts/reset-admin.js <username> <email> <password-min-8-chars>');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username, email],
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, LOWER($2), $3, $4, 'admin', true)
       RETURNING id, username, email, full_name, role, is_active`,
      [username, email, passwordHash, 'THUC LUXURY Admin'],
    );
    await client.query('COMMIT');

    const valid = await bcrypt.compare(password, passwordHash);
    console.log(JSON.stringify({ user: result.rows[0], passwordVerified: valid }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
