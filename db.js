const { Pool } = require('pg');
require('dotenv').config();

// Hỗ trợ DATABASE_URL (Heroku Postgres, Supabase, Neon) hoặc các biến rời rạc khi chạy local
const isCloudDatabase = Boolean(process.env.DATABASE_URL);

const poolConfig = isCloudDatabase
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        // Heroku Postgres sử dụng self-signed cert nên cần rejectUnauthorized: false
        rejectUnauthorized: false,
      },
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '182311',
      database: process.env.DB_NAME || 'BANPHUKIEN',
    };

const pool = new Pool(poolConfig);

// Test connection on startup & run safe migrations
pool.query('SELECT NOW()')
  .then(async () => {
    const target = isCloudDatabase ? 'Heroku DATABASE_URL (Cloud)' : (process.env.DB_NAME || 'BANPHUKIEN');
    console.log('✅ PostgreSQL connected to', target);

    try {
      await pool.query(`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email VARCHAR(200);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image VARCHAR(500);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size VARCHAR(50);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_slug VARCHAR(200);
        ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
        ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'paid', 'shipping', 'delivered', 'completed', 'cancelled'));
      `);
      console.log('✅ DB tables verified with extra columns and status constraint updated');
    } catch (migErr) {
      console.warn('⚠️ Safe migration note:', migErr.message);
    }
  })
  .catch((err) => console.error('❌ PostgreSQL connection error:', err.message));

module.exports = pool;
