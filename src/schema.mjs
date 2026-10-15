import { migrate } from './migrations.mjs';
export function initialize(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES(1);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin','inventory','finance','shipping','support')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0),
      cost INTEGER NOT NULL CHECK(cost>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock), low_stock INTEGER NOT NULL DEFAULT 5,
      weight REAL NOT NULL CHECK(weight>0), width REAL NOT NULL CHECK(width>0), height REAL NOT NULL CHECK(height>0),
      length REAL NOT NULL CHECK(length>0), color TEXT NOT NULL, icon TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS carts(user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=99), PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL,
      postal_code TEXT NOT NULL, options TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
      subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, total INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0,
      address TEXT NOT NULL, shipping_service TEXT NOT NULL, tracking_code TEXT, tracking_url TEXT, label_id TEXT,
      label_url TEXT, shipping_data TEXT, preference_id TEXT, payment_url TEXT, payment_id TEXT,
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, reserved_until TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL, quantity INTEGER NOT NULL,
      weight REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, length REAL NOT NULL,
      PRIMARY KEY(order_id,product_id));
    CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      status TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL, reason TEXT NOT NULL, reference TEXT, actor_id TEXT REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, order_id TEXT REFERENCES orders(id), type TEXT NOT NULL,
      amount INTEGER NOT NULL, description TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      entity_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status,reserved_until);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  migrate(db);
  db.exec(`CREATE TABLE IF NOT EXISTS categories(name TEXT PRIMARY KEY COLLATE NOCASE);
    INSERT OR IGNORE INTO categories(name) SELECT DISTINCT category FROM products;`);
  db.exec("INSERT OR IGNORE INTO categories(name) VALUES('Boné'),('Camiseta'),('Moletom'),('Shape');");
  return db;
}
