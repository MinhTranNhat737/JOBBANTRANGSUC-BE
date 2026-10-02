// ── Auth Routes (Admin Login) ──────────────────────────────
const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');
const { sendPasswordReset } = require('../services/email');

// POST /api/auth/login - Đăng nhập (admin, staff, customer)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập email/username và mật khẩu' });
    }

    const query = `
      SELECT u.id, u.username, u.email, u.password_hash, u.full_name, u.role, u.is_active, u.created_at,
             c.phone, c.address, c.id AS customer_id
      FROM users u 
      LEFT JOIN customers c ON LOWER(u.email) = LOWER(c.email) 
      WHERE (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1) OR c.phone = $1)
        AND u.is_active = true
      ORDER BY c.updated_at DESC NULLS LAST
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
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ error: 'JWT_SECRET chưa được cấu hình' });
    }
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256', issuer: 'thuc-luxury-api' }
    );
    res.json({ message: 'Đăng nhập thành công', token, user: safeUser });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register - Đăng ký tài khoản mới (lưu vào cả users & customers)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, full_name, phone, address } = req.body;
    const role = 'customer';

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

    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ error: 'JWT_SECRET is not configured' });
    }
    const token = jwt.sign(
      { sub: newUser.id, email: newUser.email, role: newUser.role, name: newUser.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256', issuer: 'thuc-luxury-api' }
    );

    res.status(201).json({
      token,
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


// GET /api/auth/me - Lấy thông tin tài khoản hiện tại kèm SĐT và địa chỉ
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active, u.last_login_at, u.created_at,
              c.phone, c.address, c.id AS customer_id
       FROM users u 
       LEFT JOIN customers c ON LOWER(u.email) = LOWER(c.email) 
       WHERE u.id = $1
       ORDER BY c.updated_at DESC NULLS LAST
       LIMIT 1`,
      [req.user.sub]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    const row = result.rows[0];
    res.json({
      id: row.id,
      username: row.username,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      phone: row.phone || '',
      address: row.address || '',
      is_active: row.is_active,
      last_login_at: row.last_login_at,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('GET /api/auth/me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile - Cập nhật thông tin thành viên (Họ tên, Số điện thoại, Địa chỉ nhận hàng)
router.put('/profile', verifyToken, async (req, res) => {
  try {
    let userId = null;
    let userEmail = null;

    // Xác thực token nếu có
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ['HS256'],
          issuer: 'thuc-luxury-api',
        });
        userId = decoded.sub;
        userEmail = decoded.email;
      } catch (e) {
        // Fallback sang body
      }
    }

    const { name, full_name, phone, address, email, userId: bodyUserId } = req.body;
    const finalName = (name || full_name || '').trim();
    const finalPhone = (phone || '').trim();
    const finalAddress = (address || '').trim();
    const finalEmail = (userEmail || email || '').trim().toLowerCase();
    const finalUserId = userId || bodyUserId;

    if (!finalEmail && !finalUserId) {
      return res.status(400).json({ error: 'Không xác định được tài khoản cần cập nhật' });
    }

    // 1. Cập nhật users table
    let updatedUser = null;
    if (finalUserId) {
      const uRes = await pool.query(
        `UPDATE users 
         SET full_name = COALESCE(NULLIF($1, ''), full_name),
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, username, email, full_name, role, created_at`,
        [finalName, finalUserId]
      );
      if (uRes.rows[0]) updatedUser = uRes.rows[0];
    } else if (finalEmail) {
      const uRes = await pool.query(
        `UPDATE users 
         SET full_name = COALESCE(NULLIF($1, ''), full_name),
             updated_at = NOW()
         WHERE LOWER(email) = LOWER($2)
         RETURNING id, username, email, full_name, role, created_at`,
        [finalName, finalEmail]
      );
      if (uRes.rows[0]) updatedUser = uRes.rows[0];
    }

    const targetEmail = finalEmail || updatedUser?.email;

    // 2. Cập nhật hoặc chèn mới vào customers table (UPSERT theo email)
    let updatedCustomer = null;
    if (targetEmail) {
      const cRes = await pool.query(
        `INSERT INTO customers (full_name, email, phone, address, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (email) 
         DO UPDATE SET 
           full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name),
           phone = EXCLUDED.phone,
           address = EXCLUDED.address,
           updated_at = NOW()
         RETURNING *`,
        [finalName || updatedUser?.full_name || 'Khách hàng', targetEmail, finalPhone, finalAddress]
      );
      updatedCustomer = cRes.rows[0];
    }

    res.json({
      message: 'Cập nhật thông tin thành công',
      user: {
        id: String(updatedUser?.id || finalUserId || updatedCustomer?.id),
        name: updatedCustomer?.full_name || updatedUser?.full_name || finalName,
        email: targetEmail,
        phone: updatedCustomer?.phone || finalPhone,
        address: updatedCustomer?.address || finalAddress,
      },
    });
  } catch (err) {
    console.error('PUT /api/auth/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const generic = { message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.' };
  if (!email) return res.status(400).json({ error: 'Email là bắt buộc' });
  const result = await pool.query('SELECT id, full_name, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [email]);
  if (!result.rows[0]) return res.json(generic);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at < NOW()', [result.rows[0].id]);
  await pool.query("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')", [tokenHash, result.rows[0].id]);
  const resetUrl = `${process.env.SITE_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
  await sendPasswordReset(email, result.rows[0].full_name, resetUrl);
  res.json(generic);
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Token và mật khẩu tối thiểu 8 ký tự là bắt buộc' });
  const hash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE', [hash]);
    if (!found.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Liên kết không hợp lệ hoặc đã hết hạn' }); }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, found.rows[0].user_id]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [found.rows[0].id]);
    await client.query('COMMIT');
    res.json({ message: 'Mật khẩu đã được cập nhật' });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

router.get('/users', verifyToken, requireAdmin, async (req, res) => {
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
