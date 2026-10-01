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

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => {
    const target = isCloudDatabase ? 'Heroku DATABASE_URL (Cloud)' : (process.env.DB_NAME || 'BANPHUKIEN');
    console.log('✅ PostgreSQL connected to', target);
  })
  .catch((err) => console.error('❌ PostgreSQL connection error:', err.message));

module.exports = pool;
