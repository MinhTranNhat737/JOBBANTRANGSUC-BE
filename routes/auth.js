// ── Auth Routes (Admin Login) ──────────────────────────────
const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');

// POST /api/auth/login - Đăng nhập (admin, staff, customer)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập email/username và mật khẩu' });
    }

    const query = `
      SELECT u.*, c.phone, c.address 
      FROM users u 
      LEFT JOIN customers c ON LOWER(u.email) = LOWER(c.email) 
      WHERE (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1) OR c.phone = $1)
        AND u.is_active = true
      LIMIT 1
    `;

    const result = await pool.query(query, [username.trim()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị khóa' });
    }

    const user = result.rows[0];

    // Check password with bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mật khẩu không chính xác' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { password_hash, ...safeUser } = user;
    res.json({ message: 'Đăng nhập thành công', user: safeUser });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register - Đăng ký tài khoản mới (lưu vào cả users & customers)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, full_name, phone, address, role = 'customer' } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (họ tên, email, mật khẩu)' });
    }

    const finalUsername = (username || email.split('@')[0] || `user_${Date.now()}`).trim();

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 1. Insert vào users table
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active) 
       VALUES ($1, $2, $3, $4, $5, true) 
       RETURNING id, username, email, full_name, role, created_at`,
      [finalUsername, email.toLowerCase().trim(), password_hash, full_name.trim(), role]
    );

    const newUser = result.rows[0];

    // 2. Đồng thời insert vào customers table
    try {
      await pool.query(
        `INSERT INTO customers (full_name, email, phone, address, is_ctv) 
         VALUES ($1, $2, $3, $4, false)`,
        [full_name.trim(), email.toLowerCase().trim(), phone || null, address || null]
      );
    } catch (e) {
      console.warn('Customer table insert warning:', e.message);
    }

    res.status(201).json({
      message: 'Đăng ký thành công',
      user: {
        ...newUser,
        phone: phone || null,
        address: address || null,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Tên đăng nhập hoặc email này đã tồn tại trong hệ thống' });
    }
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/auth/users - Lấy danh sách tài khoản
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, full_name, role, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
