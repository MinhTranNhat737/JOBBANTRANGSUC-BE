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
      password: process.env.DB_PASSWORD || '',
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
        ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway VARCHAR(50);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'pending';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(200);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
        UPDATE orders
        SET payment_gateway = CASE
              WHEN LOWER(payment_method) LIKE '%sepay%' THEN 'sepay'
              WHEN LOWER(payment_method) LIKE '%momo%' THEN 'momo'
              ELSE payment_gateway
            END,
            payment_status = 'paid',
            paid_at = COALESCE(paid_at, updated_at, NOW())
        WHERE payment_status <> 'paid'
          AND status IN ('paid', 'confirmed', 'shipping', 'delivered', 'completed')
          AND (LOWER(payment_method) LIKE '%sepay%' OR LOWER(payment_method) LIKE '%momo%');
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image VARCHAR(500);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size VARCHAR(50);
        ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_slug VARCHAR(200);
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id BIGSERIAL PRIMARY KEY,
          token_hash CHAR(64) UNIQUE NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_reset_tokens_expiry ON password_reset_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS wishlists (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, product_id)
        );
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
        ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'confirmed', 'paid', 'shipping', 'delivered', 'completed', 'cancelled'));
        CREATE OR REPLACE FUNCTION prevent_order_item_price_change()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
            RAISE EXCEPTION 'Order item unit price is immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_order_item_price_immutable ON order_items;
        CREATE TRIGGER trg_order_item_price_immutable
        BEFORE UPDATE ON order_items
        FOR EACH ROW EXECUTE FUNCTION prevent_order_item_price_change();

        CREATE OR REPLACE FUNCTION prevent_order_total_change()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
            RAISE EXCEPTION 'Order total amount is immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_order_total_immutable ON orders;
        CREATE TRIGGER trg_order_total_immutable
        BEFORE UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION prevent_order_total_change();
      `);
      console.log('✅ DB tables verified with extra columns and status constraint updated');
    } catch (migErr) {
      console.warn('⚠️ Safe migration note:', migErr.message);
    }
  })
  .catch((err) => console.error('❌ PostgreSQL connection error:', err.message));

module.exports = pool;
