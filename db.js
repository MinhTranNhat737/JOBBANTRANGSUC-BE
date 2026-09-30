const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '182311',
  database: process.env.DB_NAME || 'BANPHUKIEN',
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL connected to', process.env.DB_NAME || 'BANPHUKIEN'))
  .catch((err) => console.error('❌ PostgreSQL connection error:', err.message));

module.exports = pool;
