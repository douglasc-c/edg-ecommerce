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

function migrateV6(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=6)return;
    db.exec(`
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
      CREATE INDEX idx_europe_shipments_created ON europe_shipments(created_at);
      CREATE INDEX idx_europe_shipments_parcel ON europe_shipments(provider_parcel_id);
      INSERT INTO schema_version VALUES(6);
    `);
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

function migrateV7(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=7)return;
    db.exec("ALTER TABLE products ADD COLUMN sizes TEXT NOT NULL DEFAULT '[]';");
    const update=db.prepare('UPDATE products SET sizes=? WHERE id=?');
    for(const product of db.prepare("SELECT id,size FROM products WHERE size!=''").all()) {
      update.run(JSON.stringify([product.size]),product.id);
    }
    db.exec('INSERT INTO schema_version VALUES(7);');
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

// La reserva histórica permanece en products hasta asignar expresamente su saldo.
function migrateV8(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=8)return;
    db.exec(`
      ALTER TABLE products ADD COLUMN variants_enabled INTEGER NOT NULL DEFAULT 0 CHECK(variants_enabled IN (0,1));
      CREATE TABLE product_variants(
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), sku TEXT NOT NULL UNIQUE,
        color_name TEXT NOT NULL, color_key TEXT NOT NULL, color_hex TEXT NOT NULL, size TEXT NOT NULL DEFAULT '',
        price_override INTEGER CHECK(price_override IS NULL OR price_override>0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock),
        low_stock INTEGER NOT NULL DEFAULT 5 CHECK(low_stock>=0),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        images TEXT NOT NULL DEFAULT '[]', deleted_at TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_variant_combination ON product_variants(product_id,color_key,size) WHERE deleted_at IS NULL;
      CREATE INDEX idx_variants_product ON product_variants(product_id);
      CREATE TABLE carts_v8(user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=99),variant_key TEXT NOT NULL DEFAULT '',
        variant_id TEXT REFERENCES product_variants(id),PRIMARY KEY(user_id,product_id,variant_key),
        CHECK(variant_key=COALESCE(variant_id,'')));
      INSERT INTO carts_v8(user_id,product_id,quantity) SELECT user_id,product_id,quantity FROM carts;
      DROP TABLE carts;
      ALTER TABLE carts_v8 RENAME TO carts;
      CREATE TABLE order_items_v8(order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),
        sku TEXT NOT NULL,name TEXT NOT NULL,price INTEGER NOT NULL,cost INTEGER NOT NULL,quantity INTEGER NOT NULL,
        weight REAL NOT NULL,width REAL NOT NULL,height REAL NOT NULL,length REAL NOT NULL,fiscal TEXT NOT NULL DEFAULT '{}',
        variant_key TEXT NOT NULL DEFAULT '',variant_id TEXT REFERENCES product_variants(id),
        selected_color TEXT NOT NULL DEFAULT '',selected_size TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(order_id,product_id,variant_key),CHECK(variant_key=COALESCE(variant_id,'')));
      INSERT INTO order_items_v8(order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length,fiscal)
        SELECT order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length,fiscal FROM order_items;
      DROP TABLE order_items;
      ALTER TABLE order_items_v8 RENAME TO order_items;
      ALTER TABLE movements ADD COLUMN variant_id TEXT REFERENCES product_variants(id);
      ALTER TABLE movements ADD COLUMN selected_color TEXT NOT NULL DEFAULT '';
      ALTER TABLE movements ADD COLUMN selected_size TEXT NOT NULL DEFAULT '';
      INSERT INTO schema_version VALUES(8);
    `);
  };
  if(db.transactionSync)return db.transactionSync(apply);
  db.exec('BEGIN IMMEDIATE');
  try{apply();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}

function migrateV9(db) {
  const apply=()=>{
    if(db.prepare('SELECT MAX(version) v FROM schema_version').get().v>=9)return;
    db.exec(`
      ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'BRL' CHECK(currency IN ('BRL','EUR'));
      ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'mercadopago' CHECK(payment_method IN ('mercadopago','bank_transfer','stripe'));
      ALTER TABLE orders ADD COLUMN payment_environment TEXT NOT NULL DEFAULT 'live' CHECK(payment_environment IN ('test','live'));
      ALTER TABLE orders ADD COLUMN bank_transfer_details TEXT;
      INSERT INTO schema_version VALUES(9);
    `);
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
  migrateV6(db);
  migrateV7(db);
  migrateV8(db);
  migrateV9(db);
}
