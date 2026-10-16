// Migraciones incrementales: se ejecutan en una transacción y conservan los datos de la versión anterior.
function migrateV2(db) {
  const current=db.prepare('SELECT MAX(version) v FROM schema_version').get().v;
  if(current>=2)return;
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=2){return;}
    db.exec(`
      ALTER TABLE products ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE products ADD COLUMN fiscal TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE order_items ADD COLUMN fiscal TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN coupon_code TEXT;
      CREATE TABLE media(id TEXT PRIMARY KEY, data BLOB NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
      CREATE TABLE coupons(code TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
        value INTEGER NOT NULL CHECK(value>0), min_subtotal INTEGER NOT NULL DEFAULT 0,
        max_discount INTEGER, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL, per_user_limit INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL);
      CREATE TABLE coupon_uses(order_id TEXT PRIMARY KEY REFERENCES orders(id), code TEXT NOT NULL REFERENCES coupons(code),
        user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('reserved','used','released')));
      CREATE INDEX idx_coupon_uses ON coupon_uses(code,user_id,status);
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
      INSERT INTO schema_version VALUES(2);
    `);
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try {apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

function migrateV3(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=3)return;
    db.exec("ALTER TABLE products ADD COLUMN size TEXT NOT NULL DEFAULT ''; INSERT INTO schema_version VALUES(3);");
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

function migrateV4(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=4)return;
    // Las primeras bases se crearon antes de que existiera la tabla de categorías.
    db.exec('CREATE TABLE IF NOT EXISTS categories(name TEXT PRIMARY KEY COLLATE NOCASE);');
    if(!db.prepare('PRAGMA table_info(categories)').all().some(column=>column.name==='image_id')) {
      db.exec('ALTER TABLE categories ADD COLUMN image_id TEXT REFERENCES media(id);');
    }
    db.exec('INSERT INTO schema_version VALUES(4);');
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

function migrateV5(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=5)return;
    db.exec('ALTER TABLE products ADD COLUMN deleted_at TEXT; INSERT INTO schema_version VALUES(5);');
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

export function migrate(db) {
  migrateV2(db);
  migrateV3(db);
  migrateV4(db);
  migrateV5(db);
}
