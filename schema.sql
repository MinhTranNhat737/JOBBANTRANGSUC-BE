-- ================================================================
-- LEGEND JEWELRY - PostgreSQL Schema
-- Chạy file này trong pgAdmin hoặc psql để tạo database + tables
-- ================================================================

-- Tạo database (chạy trong psql hoặc pgAdmin SQL Editor khi connect vào postgres)
-- CREATE DATABASE legend_jewelry;

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: categories
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: products
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(200) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category_slug VARCHAR(50) REFERENCES categories(slug),
  price INTEGER NOT NULL DEFAULT 0,
  compare_at_price INTEGER,
  image VARCHAR(500),
  badge VARCHAR(20),
  stock INTEGER NOT NULL DEFAULT 0,
  sizes TEXT[], -- PostgreSQL array cho sizes
  material VARCHAR(300),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: customers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  password_hash VARCHAR(200) NOT NULL DEFAULT '123456',
  total_orders INTEGER DEFAULT 0,
  total_spent BIGINT DEFAULT 0,
  joined_at TIMESTAMP DEFAULT NOW(),
  last_order_at TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: orders
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(20) PRIMARY KEY,
  customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_email VARCHAR(200),
  customer_phone VARCHAR(20),
  customer_address TEXT,
  total BIGINT NOT NULL DEFAULT 0,
  shipping_fee INTEGER DEFAULT 30000,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT,
  payment_method VARCHAR(50),
  payment_gateway VARCHAR(20),
  payment_status VARCHAR(20) DEFAULT 'pending',
  transaction_id VARCHAR(100),
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: order_items
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(20) REFERENCES orders(id) ON DELETE CASCADE,
  product_slug VARCHAR(200),
  name VARCHAR(200) NOT NULL,
  image VARCHAR(500),
  size VARCHAR(20),
  quantity INTEGER NOT NULL DEFAULT 1,
  price INTEGER NOT NULL DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: order_timeline
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_timeline (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR(20) REFERENCES orders(id) ON DELETE CASCADE,
  date TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(200) NOT NULL,
  note TEXT
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: brands
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- BẢNG: users (Admin & Staff)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

-- Tài khoản admin mặc định: admin / admin123
INSERT INTO users (username, email, password_hash, full_name, role)
VALUES ('admin', 'admin@legend.vn', '$2a$10$rQeG9VzU80KzYhTqR71X..vP0kPqYp5X4Y1Gj3X9lT0L2O1S2Z7aW', 'Quản trị viên', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- INDEXES cho performance
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_slug);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_timeline_order ON order_timeline(order_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

