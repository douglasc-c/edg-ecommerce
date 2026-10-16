import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { database } from '../src/db.mjs';
import { initialize } from '../src/schema.mjs';
import { migrate } from '../src/migrations.mjs';
import { commerce } from '../src/commerce.mjs';
import { providers } from '../src/providers.mjs';
import { configuration, createApp } from '../src/server.mjs';
import { hash, now } from '../src/security.mjs';

const config=configuration({COMMERCE_MODE:'demo',APP_URL:'http://localhost:3000'});
const address={name:'Cliente de prueba',phone:'41999999999',document:'12345678901',
  postal_code:'80010000',street:'Calle de prueba',number:'10',district:'Centro',city:'Curitiba',state:'PR'};

function fixture(t) {
  const db=database(':memory:');
  t.after(()=>db.close());
  const users=Object.fromEntries(['admin','inventory','customer','support'].map(role=>{
    const user={id:randomUUID(),name:role,email:`${role}@example.test`,role};
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(user.id,user.name,user.email,'unused',role,now());
    return [role,user];
  }));
  const shop=commerce(db,config,providers(config));
  const input={sku:'DELETE-1',name:'Tabla de prueba',description:'Producto que conserva su historial',
    category:'Prueba',price:10000,cost:3000,low_stock:2,weight:.5,width:10,height:10,length:10,
    color:'#334455',icon:'◇'};
  const product=shop.saveProduct(users.admin,input);
  shop.stock(users.admin,product.id,10,'Existencias iniciales');
  return {db,shop,product,input,...users};
}

function product(f) {return f.db.prepare('SELECT * FROM products WHERE id=?').get(f.product.id);}
function audits(f) {return f.db.prepare('SELECT * FROM audit ORDER BY id').all();}
function state(f) {
  return {products:f.db.prepare('SELECT * FROM products ORDER BY id').all(),
    carts:f.db.prepare('SELECT * FROM carts ORDER BY user_id,product_id').all(),
    categories:f.shop.categories(),audit:audits(f),
    movements:f.db.prepare('SELECT * FROM movements ORDER BY id').all()};
}

async function buy(f,quantity=2) {
  f.shop.setCart(f.customer,f.product.id,quantity);
  const quote=await f.shop.quote(f.customer,address.postal_code);
  return f.shop.checkout(f.customer,{quote_id:quote.id,service_id:quote.options[0].id,address},randomUUID());
}

async function request(app,path,{method='GET',body,headers={}}={}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{origin:config.url,'content-type':'application/json',...headers}});
  const result={status:200,headers:{}};
  const res={headersSent:false,
    setHeader(name,value) {result.headers[name.toLowerCase()]=value;},
    writeHead(status,values) {
      result.status=status;
      for(const [name,value] of Object.entries(values))this.setHeader(name,value);
      this.headersSent=true;
    },
    end(value) {result.data=value===undefined?null:JSON.parse(Buffer.from(value).toString());}
  };
  await app.handler(req,res);
  return result;
}

function authentication(f,user) {
  const raw=randomUUID(),csrf=randomUUID();
  f.db.prepare('INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES(?,?,?,?)')
    .run(hash(raw),user.id,csrf,new Date(Date.now()+60000).toISOString());
  return {cookie:`edg_session=${raw}`,'x-csrf-token':csrf};
}

test('excluir un producto lo retira del catálogo y de todos los carritos, conservando existencias e historial',t=>{
  const f=fixture(t);
  f.shop.setCart(f.customer,f.product.id,2);
  f.shop.setCart(f.admin,f.product.id,1);
  const before=product(f),movements=f.shop.movements(),previousAudits=audits(f).length;
  f.shop.deleteProduct(f.admin,f.product.id);
  assert.ok(product(f).deleted_at);
  assert.equal(product(f).stock,before.stock);
  assert.equal(product(f).reserved,before.reserved);
  assert.deepEqual(f.shop.products(),[]);
  assert.deepEqual(f.shop.products(true),[]);
  for(const user of [f.customer,f.admin])assert.deepEqual(f.shop.cart(user.id),{items:[],subtotal:0});
  assert.deepEqual(f.shop.movements(),movements);
  const deletionAudits=audits(f).slice(previousAudits);
  assert.equal(deletionAudits.length,1);
  assert.equal(deletionAudits[0].actor_id,f.admin.id);
  assert.equal(deletionAudits[0].entity_id,f.product.id);
  assert.equal(deletionAudits[0].action,'product.delete');
});

test('un producto excluido no admite nuevas compras, edición, reactivación ni ajustes de existencias',async t=>{
  const f=fixture(t);
  f.shop.setCart(f.customer,f.product.id,2);
  const quote=await f.shop.quote(f.customer,address.postal_code);
  f.shop.deleteProduct(f.admin,f.product.id);
  const before=state(f);
  assert.throws(()=>f.shop.setCart(f.customer,f.product.id,1),error=>error.status===404);
  assert.throws(()=>f.shop.saveProduct(f.admin,{...f.input,category:'Categoría accidental',active:true},f.product.id),
    error=>error.status===404);
  assert.throws(()=>f.shop.stock(f.admin,f.product.id,2,'Intento después de excluir'),error=>error.status===404);
  await assert.rejects(f.shop.quote(f.customer,address.postal_code),error=>error.status===400||error.status===409);
  await assert.rejects(f.shop.checkout(f.customer,{quote_id:quote.id,service_id:quote.options[0].id,address},randomUUID()),
    error=>error.status===400||error.status===409);
  assert.deepEqual(state(f),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
});

test('excluir durante la consulta al transportista impide guardar una cotización obsoleta',async t=>{
  const f=fixture(t),provider=providers(config),quote=provider.quote.bind(provider);
  let started,finish;
  const waiting=new Promise(resolve=>{started=resolve;});
  provider.quote=async(...args)=>{
    const options=await quote(...args);
    started();
    return new Promise(resolve=>{finish=()=>resolve(options);});
  };
  const shop=commerce(f.db,config,provider);
  shop.setCart(f.customer,f.product.id,2);
  const pending=shop.quote(f.customer,address.postal_code);
  await waiting;
  f.shop.deleteProduct(f.admin,f.product.id);
  const rejected=assert.rejects(pending,error=>error.status===400||error.status===409);
  finish();
  await rejected;
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quotes').get().n,0);
  assert.deepEqual(shop.cart(f.customer.id),{items:[],subtotal:0});
});

test('las categorías con productos activos o inactivos no se pueden excluir',t=>{
  const f=fixture(t);
  let before=state(f);
  assert.throws(()=>f.shop.deleteCategory(f.admin,'Prueba'),error=>error.status===409);
  assert.deepEqual(state(f),before);
  f.shop.saveProduct(f.admin,{...f.input,active:false},f.product.id);
  before=state(f);
  assert.throws(()=>f.shop.deleteCategory(f.admin,'prueba'),error=>error.status===409);
  assert.deepEqual(state(f),before);
});

test('la categoría se puede excluir después de sus productos sin reaparecer al inicializar',t=>{
  const f=fixture(t);
  f.shop.deleteProduct(f.admin,f.product.id);
  const before=audits(f).length;
  f.shop.deleteCategory(f.admin,'Prueba');
  assert.ok(!f.shop.categories().some(row=>row.name==='Prueba'));
  assert.equal(product(f).category,'Prueba');
  const entry=audits(f).slice(before);
  assert.equal(entry.length,1);
  assert.equal(entry[0].action,'category.delete');
  assert.equal(entry[0].actor_id,f.admin.id);
  initialize(f.db);
  initialize(f.db);
  assert.ok(!f.shop.categories().some(row=>row.name==='Prueba'));
  assert.equal(f.db.prepare('SELECT name FROM categories WHERE name=?').get('Prueba'),undefined);
  for(const row of f.shop.categories())f.shop.deleteCategory(f.admin,row.name);
  initialize(f.db);
  assert.deepEqual(f.shop.categories(),[]);
});

test('un identificador inexistente no escribe auditoría ni modifica el catálogo',t=>{
  const f=fixture(t),before=state(f);
  assert.throws(()=>f.shop.deleteProduct(f.admin,randomUUID()),error=>error.status===404);
  assert.throws(()=>f.shop.deleteCategory(f.admin,'Inexistente'),error=>error.status===404);
  assert.deepEqual(state(f),before);
});

test('un fallo al registrar la auditoría revierte la exclusión del producto y de la categoría',t=>{
  const f=fixture(t);
  f.shop.setCart(f.customer,f.product.id,2);
  f.shop.saveCategory(f.admin,{name:'Vacía'});
  const before=state(f);
  f.db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.throws(()=>f.shop.deleteProduct(f.admin,f.product.id),/audit unavailable/);
  assert.deepEqual(state(f),before);
  assert.throws(()=>f.shop.deleteCategory(f.admin,'Vacía'),/audit unavailable/);
  assert.deepEqual(state(f),before);
});

test('los pedidos reservados se pueden pagar y reembolsar después de excluir el producto',async t=>{
  const f=fixture(t),order=await buy(f),items=f.shop.order(order.id).items;
  assert.equal(product(f).reserved,2);
  f.shop.deleteProduct(f.admin,f.product.id);
  assert.equal(product(f).reserved,2);
  assert.equal(product(f).stock,10);
  assert.deepEqual(f.shop.order(order.id,f.customer).items,items);
  const paid=f.shop.demoPay(f.customer,order.id);
  assert.equal(paid.status,'paid');
  assert.equal(product(f).reserved,0);
  assert.equal(product(f).stock,8);
  assert.equal(f.shop.ledger().reduce((sum,row)=>sum+row.amount,0),order.total);
  assert.ok(f.shop.movements().some(row=>row.product_id===f.product.id&&row.quantity===-2&&row.reference===order.id));
  const refunded=await f.shop.refund(f.admin,order.id);
  assert.equal(refunded.status,'refunded');
  assert.equal(product(f).stock,10);
  assert.equal(product(f).reserved,0);
  assert.ok(product(f).deleted_at);
  assert.deepEqual(f.shop.order(order.id).items,items);
  assert.equal(f.shop.ledger().reduce((sum,row)=>sum+row.amount,0),0);
  assert.deepEqual(f.shop.products(),[]);
});

for(const action of ['cancel','expire']) {
  test(`un pedido ${action==='cancel'?'cancelado':'caducado'} libera las reservas de un producto excluido`,async t=>{
    const f=fixture(t),order=await buy(f);
    f.shop.deleteProduct(f.admin,f.product.id);
    if(action==='cancel')f.shop.cancel(f.customer,order.id);
    else {
      f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',order.id);
      f.shop.expire();
    }
    assert.equal(product(f).reserved,0);
    assert.equal(product(f).stock,10);
    assert.ok(product(f).deleted_at);
    assert.equal(f.shop.order(order.id).items[0].product_id,f.product.id);
  });
}

test('la migración v4 conserva productos, reservas e imágenes y se puede repetir',t=>{
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  const imageId=hash('legacy selected category');
  db.exec(`CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
    INSERT INTO schema_version VALUES(1),(2),(3),(4);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,category TEXT,stock INTEGER,reserved INTEGER);
    INSERT INTO products VALUES('legacy','Producto heredado','Heredada',10,2);
    CREATE TABLE categories(name TEXT PRIMARY KEY COLLATE NOCASE,image_id TEXT);
  `);
  db.prepare('INSERT INTO categories VALUES(?,?)').run('Heredada',imageId);
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('SELECT MAX(version) version FROM schema_version').get().version,5);
  assert.deepEqual({...db.prepare('SELECT * FROM products').get()},
    {id:'legacy',name:'Producto heredado',category:'Heredada',stock:10,reserved:2,deleted_at:null});
  assert.equal(db.prepare('SELECT image_id FROM categories').get().image_id,imageId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=5').get().n,1);
});

test('HTTP: excluir productos y categorías exige permiso de catálogo, sesión, origen y CSRF',async t=>{
  const f=fixture(t),app=createApp({db:f.db,config,runtime:'worker'}),path=`/api/admin/products/${f.product.id}`;
  const admin=authentication(f,f.admin),inventory=authentication(f,f.inventory);
  const categoryRequest={method:'DELETE',body:{name:'Prueba'}};
  assert.equal((await request(app,path,{method:'DELETE'})).status,401);
  assert.equal((await request(app,'/api/admin/categories',categoryRequest)).status,401);
  for(const user of [f.customer,f.support]) {
    const headers=authentication(f,user);
    assert.equal((await request(app,path,{method:'DELETE',headers})).status,403);
    assert.equal((await request(app,'/api/admin/categories',{...categoryRequest,headers})).status,403);
  }
  for(const headers of [{cookie:admin.cookie},{...admin,origin:'https://other.example.test'}]) {
    assert.equal((await request(app,path,{method:'DELETE',headers})).status,403);
    assert.equal((await request(app,'/api/admin/categories',{...categoryRequest,headers})).status,403);
  }
  assert.equal((await request(app,'/api/admin/categories',{...categoryRequest,headers:admin})).status,409);
  assert.ok(!product(f).deleted_at);
  assert.equal((await request(app,path,{method:'DELETE',headers:inventory})).status,200);
  assert.deepEqual((await request(app,'/api/products')).data,[]);
  assert.deepEqual((await request(app,'/api/admin/products',{headers:admin})).data,[]);
  assert.equal((await request(app,'/api/admin/categories',{...categoryRequest,headers:admin})).status,200);
  assert.ok(!(await request(app,'/api/categories')).data.some(row=>row.name==='Prueba'));
  assert.equal((await request(app,'/api/admin/categories',{...categoryRequest,headers:admin})).status,404);
});
