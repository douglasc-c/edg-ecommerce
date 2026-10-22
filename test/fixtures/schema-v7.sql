-- Frozen pre-variant schema: migration regression fixture.
CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('customer','admin','inventory','finance','shipping','support')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE products(id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0),
      cost INTEGER NOT NULL CHECK(cost>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock), low_stock INTEGER NOT NULL DEFAULT 5,
      weight REAL NOT NULL CHECK(weight>0), width REAL NOT NULL CHECK(width>0), height REAL NOT NULL CHECK(height>0),
      length REAL NOT NULL CHECK(length>0), color TEXT NOT NULL, icon TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', fiscal TEXT NOT NULL DEFAULT '{}', size TEXT NOT NULL DEFAULT '', deleted_at TEXT, sizes TEXT NOT NULL DEFAULT '[]');
CREATE TABLE carts(user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=99), PRIMARY KEY(user_id,product_id));
CREATE TABLE quotes(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL,
      postal_code TEXT NOT NULL, options TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE orders(id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
      subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, total INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0,
      address TEXT NOT NULL, shipping_service TEXT NOT NULL, tracking_code TEXT, tracking_url TEXT, label_id TEXT,
      label_url TEXT, shipping_data TEXT, preference_id TEXT, payment_url TEXT, payment_id TEXT,
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, reserved_until TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, discount INTEGER NOT NULL DEFAULT 0, coupon_code TEXT, UNIQUE(user_id,idempotency_key));
CREATE TABLE order_items(order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, cost INTEGER NOT NULL, quantity INTEGER NOT NULL,
      weight REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, length REAL NOT NULL, fiscal TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(order_id,product_id));
CREATE TABLE order_events(id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      status TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE movements(id INTEGER PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL, reason TEXT NOT NULL, reference TEXT, actor_id TEXT REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE ledger(id INTEGER PRIMARY KEY, order_id TEXT REFERENCES orders(id), type TEXT NOT NULL,
      amount INTEGER NOT NULL, description TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE audit(id INTEGER PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      entity_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE media(id TEXT PRIMARY KEY, data BLOB NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE coupons(code TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
        value INTEGER NOT NULL CHECK(value>0), min_subtotal INTEGER NOT NULL DEFAULT 0,
        max_discount INTEGER, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL, per_user_limit INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL);
CREATE TABLE coupon_uses(order_id TEXT PRIMARY KEY REFERENCES orders(id), code TEXT NOT NULL REFERENCES coupons(code),
        user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('reserved','used','released')));
CREATE TABLE local_secrets(name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE email_outbox(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        recipient TEXT NOT NULL, subject TEXT NOT NULL, encrypted TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt TEXT NOT NULL, expires_at TEXT NOT NULL, sent_at TEXT, last_error TEXT, created_at TEXT NOT NULL);
CREATE TABLE invoices(order_id TEXT PRIMARY KEY REFERENCES orders(id), ref TEXT NOT NULL UNIQUE,
        environment TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, invoice_key TEXT,
        number TEXT, series TEXT, xml_url TEXT, pdf_url TEXT, message TEXT,
        cancel_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE categories(name TEXT PRIMARY KEY COLLATE NOCASE, image_id TEXT REFERENCES media(id));
CREATE TABLE europe_quotes(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),
        payload TEXT NOT NULL,options TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE europe_shipments(id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,order_reference TEXT,
        quote_id TEXT NOT NULL UNIQUE REFERENCES europe_quotes(id),environment TEXT NOT NULL,
        status TEXT NOT NULL,destination TEXT NOT NULL,parcel TEXT NOT NULL,service TEXT NOT NULL,
        price INTEGER NOT NULL CHECK(price>=0),currency TEXT NOT NULL CHECK(currency='EUR'),
        provider_shipment_id TEXT UNIQUE,provider_parcel_id TEXT,tracking_code TEXT,tracking_url TEXT,
        last_event_at TEXT,last_error TEXT,request_hash TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE europe_shipment_events(id INTEGER PRIMARY KEY,
        shipment_id TEXT NOT NULL REFERENCES europe_shipments(id),event_key TEXT UNIQUE,
        status TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX idx_orders_user ON orders(user_id,created_at);
CREATE INDEX idx_orders_expiry ON orders(status,reserved_until);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_coupon_uses ON coupon_uses(code,user_id,status);
CREATE INDEX idx_europe_shipments_created ON europe_shipments(created_at);
CREATE INDEX idx_europe_shipments_parcel ON europe_shipments(provider_parcel_id);
INSERT INTO schema_version(version) VALUES (1),(2),(3),(4),(5),(6),(7);
