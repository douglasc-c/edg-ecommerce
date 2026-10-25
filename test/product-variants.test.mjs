import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {database} from '../src/db.mjs';
import {migrate} from '../src/migrations.mjs';
import {commerce} from '../src/commerce.mjs';
import {providers} from '../src/providers.mjs';
import {now} from '../src/security.mjs';
import {hash} from '../src/security.mjs';
import {configuration,createApp} from '../src/server.mjs';

const config=configuration({COMMERCE_MODE:'demo',APP_URL:'http://localhost:3000'});
const base={sku:'PRINT-1',name:'Camiseta Original',description:'Una estampa, varios colores y tallas',
  category:'Camiseta',sizes:['S','L'],price:2500,cost:1000,low_stock:2,
  weight:.5,width:20,height:5,length:25,color:'#f0f0f0',icon:'◇'};
const destination={name:'Cliente',phone:'41999999999',document:'12345678901',postal_code:'80010000',
  street:'Calle A',number:'10',district:'Centro',city:'Curitiba',state:'PR'};
const combination=(color_name,size,stock=0,extra={})=>({color_name,color_hex:color_name==='Negro'?'#111111':'#ffffff',size,stock,image_ids:[],...extra});

function addUser(db,role,suffix=role){
  const user={id:randomUUID(),name:suffix,email:`${suffix}@example.test`,role};
  db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(user.id,user.name,user.email,'unused',role,now());
  return user;
}
function fixture(t,{legacy=false,stock=0,variants}={}){
  const db=database(':memory:');t.after(()=>db.close());
  const admin=addUser(db,'admin'),user=addUser(db,'customer'),other=addUser(db,'customer','other');
  const shop=commerce(db,config,providers(config));
  const p=shop.saveProduct(admin,{...base,...(legacy?{}:{variants:variants||[
    combination('Negro','S',3),combination('Negro','L',2),combination('Blanco','L',1)]})});
  if(stock)shop.stock(admin,p.id,stock,'Recuento anterior a la migración');
  return {db,shop,admin,user,other,p};
}
const product=f=>f.shop.products(true).find(p=>p.id===f.p.id);
const variant=(f,color,size)=>product(f).variants.find(v=>v.color_name===color&&v.size===size);
const save=(f,variants,changes={})=>f.shop.saveProduct(f.admin,{...base,...changes,variants},f.p.id);
const editable=v=>({id:v.id,sku:v.sku,color_name:v.color_name,color_hex:v.color_hex,size:v.size,
  stock:v.stock,price_override:v.price_override,low_stock:v.low_stock,active:!!v.active,image_ids:v.image_ids||[]});
async function checkout(f,user=f.user){
  const quote=await f.shop.quote(user,destination.postal_code);
  return f.shop.checkout(user,{quote_id:quote.id,service_id:quote.options[0].id,address:destination},randomUUID());
}
const approved=(order,id='late')=>({id,external_reference:order.id,status:'approved',
  transaction_amount:order.total/100,currency_id:'BRL'});

test('cada combinación tiene SKU y saldo propios y el total del producto es una suma',t=>{
  const f=fixture(t),p=product(f);
  assert.equal(p.variants_enabled,true);
  assert.equal(p.stock,6);assert.equal(p.available,6);assert.equal(p.reserved,0);
  assert.equal(p.unallocated_stock,0);
  assert.equal(new Set(p.variants.map(v=>v.id)).size,3);
  assert.equal(new Set(p.variants.map(v=>v.sku)).size,3);
  assert.ok(p.variants.every(v=>v.sku.length>0));
  f.shop.variantStock(f.admin,p.id,variant(f,'Negro','L').id,4,'Reposición de negro L');
  assert.equal(variant(f,'Negro','L').stock,6);
  assert.equal(variant(f,'Negro','S').stock,3);
  assert.equal(variant(f,'Blanco','L').stock,1);
  assert.equal(product(f).stock,10);
  assert.throws(()=>f.shop.stock(f.admin,p.id,1,'Entrada ambigua'),e=>e.status===409||e.status===400);
  const movements=f.shop.movements().filter(m=>m.reason==='Reposición de negro L');
  assert.equal(movements.length,1);assert.equal(movements[0].variant_id,variant(f,'Negro','L').id);
});

test('los avisos de reposición respetan el umbral de cada variación y sus reservas',async t=>{
  const f=fixture(t,{variants:[
    combination('Negro','S',5,{low_stock:1}),combination('Negro','L',3,{low_stock:4}),combination('Blanco','L',2,{low_stock:0}),
  ]});
  let dashboard=f.shop.dashboard(f.admin);
  assert.equal(dashboard.metrics.low_stock,1);
  assert.equal(dashboard.alerts[0].variant_id,variant(f,'Negro','L').id);
  const s=variant(f,'Negro','S');
  save(f,product(f).variants.map(v=>({...editable(v),low_stock:v.id===s.id?5:v.low_stock})),{low_stock:999});
  dashboard=f.shop.dashboard(f.admin);
  assert.equal(dashboard.metrics.low_stock,2);
  assert.deepEqual(new Set(dashboard.alerts.map(v=>v.variant_id)),new Set([s.id,variant(f,'Negro','L').id]));
  assert.equal(variant(f,'Blanco','L').low_stock,0);
  f.shop.setCart(f.user,f.p.id,2,variant(f,'Blanco','L').id);await checkout(f);
  assert.equal(f.shop.dashboard(f.admin).metrics.low_stock,3);
});

test('la conversión conserva todo el saldo y elimina carritos que no identificaban talla',t=>{
  const f=fixture(t,{legacy:true,stock:9});
  f.shop.setCart(f.user,f.p.id,2);
  const migrated=save(f,[combination('Negro','S',4),combination('Negro','L',3),combination('Blanco','L',2)]);
  assert.equal(migrated.stock,9);assert.equal(migrated.available,9);assert.equal(migrated.unallocated_stock,0);
  assert.equal(f.db.prepare('SELECT stock,reserved FROM products WHERE id=?').get(f.p.id).stock,0);
  assert.equal(f.shop.cart(f.user.id).items.length,0);
  assert.equal(migrated.variants.reduce((sum,v)=>sum+v.stock,0),9);
  assert.throws(()=>f.shop.setCart(f.user,f.p.id,1),e=>e.status===400||e.status===409);
});

test('una distribución incompleta o excesiva revierte producto, existencias y auditoría',t=>{
  const f=fixture(t,{legacy:true,stock:9});
  const before=product(f),audits=f.shop.audits().length;
  for(const quantity of [8,10]){
    assert.throws(()=>save(f,[combination('Negro','S',quantity)],{name:'No debe guardarse'}),e=>e.status===400||e.status===409);
    assert.deepEqual(product(f),before);
    assert.equal(f.shop.audits().length,audits);
  }
});

test('la conversión espera a liberar reservas y no modifica el pedido histórico',async t=>{
  const f=fixture(t,{legacy:true,stock:5});
  f.shop.setCart(f.user,f.p.id,2);const order=await checkout(f);
  const before=f.shop.order(order.id),p=product(f);
  assert.throws(()=>save(f,[combination('Negro','S',5)]),e=>e.status===409);
  assert.deepEqual(product(f),p);assert.deepEqual(f.shop.order(order.id),before);
  f.shop.cancel(f.user,order.id);
  save(f,[combination('Negro','S',5)]);
  assert.equal(product(f).stock,5);
  assert.deepEqual(f.shop.order(order.id).items,before.items);
});

test('combinaciones duplicadas, SKU repetidos y tallas inválidas se rechazan atómicamente',t=>{
  const f=fixture(t),before=product(f);
  const current=before.variants.map(editable);
  const invalid=[
    [...current,combination(' Negro ','S',0)],
    [combination('Rojo','S',0,{sku:'SAME'}),combination('Rojo','L',0,{sku:'SAME'})],
    [...current,combination('Rojo','XS',0)],
    [...current,combination('Rojo','S',-1)],
    [...current,combination('Rojo','S',1.5)],
  ];
  for(const variants of invalid){
    assert.throws(()=>save(f,variants),e=>e.status===400||e.status===409);
    assert.deepEqual(product(f),before);
  }
  assert.throws(()=>f.shop.saveProduct(f.admin,{...base,sku:'OTHER',variants:[combination('Negro','S',1,{sku:current[0].sku})]}),e=>e.status===409);
});

test('el carrito conserva dos tallas del mismo producto como líneas independientes',async t=>{
  const f=fixture(t),s=variant(f,'Negro','S'),l=variant(f,'Negro','L');
  f.shop.setCart(f.user,f.p.id,2,s.id);f.shop.setCart(f.user,f.p.id,1,l.id);
  let cart=f.shop.cart(f.user.id);
  assert.equal(cart.items.length,2);assert.equal(cart.subtotal,7500);
  assert.deepEqual(new Set(cart.items.map(i=>i.variant_id)),new Set([s.id,l.id]));
  assert.deepEqual(new Set(cart.items.map(i=>i.selected_size)),new Set(['S','L']));
  assert.ok(cart.items.every(i=>i.selected_color==='Negro'));
  f.shop.setCart(f.user,f.p.id,0,s.id);
  cart=f.shop.cart(f.user.id);assert.equal(cart.items.length,1);assert.equal(cart.items[0].variant_id,l.id);
  f.shop.setCart(f.user,f.p.id,2,s.id);
  const order=await checkout(f);
  assert.equal(order.items.length,2);
  assert.equal(variant(f,'Negro','S').reserved,2);assert.equal(variant(f,'Negro','L').reserved,1);
  f.shop.demoPay(f.user,order.id);
  assert.equal(variant(f,'Negro','S').stock,1);assert.equal(variant(f,'Negro','L').stock,1);
  assert.equal(variant(f,'Blanco','L').stock,1);assert.equal(product(f).reserved,0);
});

test('la cotización distingue variaciones aun cuando el precio y la cantidad coinciden',async t=>{
  const f=fixture(t),s=variant(f,'Negro','S'),l=variant(f,'Negro','L');
  f.shop.setCart(f.user,f.p.id,1,s.id);
  const quote=await f.shop.quote(f.user,destination.postal_code);
  f.shop.setCart(f.user,f.p.id,0,s.id);f.shop.setCart(f.user,f.p.id,1,l.id);
  await assert.rejects(f.shop.checkout(f.user,{quote_id:quote.id,service_id:quote.options[0].id,address:destination},randomUUID()),e=>e.status===409);
  assert.equal(product(f).reserved,0);
});

test('las reservas de una variación impiden sobreventa sin bloquear otra talla',async t=>{
  const f=fixture(t),l=variant(f,'Negro','L'),s=variant(f,'Negro','S');
  f.shop.setCart(f.user,f.p.id,2,l.id);await checkout(f);
  assert.throws(()=>f.shop.setCart(f.other,f.p.id,1,l.id),e=>e.status===409);
  assert.throws(()=>f.shop.variantStock(f.admin,f.p.id,l.id,-1,'Salida indebida'),e=>e.status===409);
  f.shop.setCart(f.other,f.p.id,1,s.id);
  assert.equal(f.shop.cart(f.other.id).items[0].variant_id,s.id);
  assert.equal(variant(f,'Negro','L').stock,2);
});

test('dos compradores con cotizaciones previas disputan la última unidad y solo uno reserva',async t=>{
  const f=fixture(t),last=variant(f,'Blanco','L'),attempts=[];
  for(const user of [f.user,f.other]){
    f.shop.setCart(user,f.p.id,1,last.id);
    const quote=await f.shop.quote(user,destination.postal_code);
    attempts.push({user,input:{quote_id:quote.id,service_id:quote.options[0].id,address:destination}});
  }
  const results=await Promise.allSettled(attempts.map(({user,input})=>f.shop.checkout(user,input,randomUUID())));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  assert.equal(variant(f,'Blanco','L').reserved,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
});

test('cancelación y vencimiento liberan solo la reserva de su variación una vez',async t=>{
  const f=fixture(t),s=variant(f,'Negro','S'),l=variant(f,'Negro','L');
  f.shop.setCart(f.user,f.p.id,2,s.id);const cancelled=await checkout(f);
  f.shop.setCart(f.other,f.p.id,1,l.id);const expired=await checkout(f,f.other);
  f.shop.cancel(f.user,cancelled.id);
  assert.equal(variant(f,'Negro','S').reserved,0);assert.equal(variant(f,'Negro','L').reserved,1);
  f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',expired.id);
  f.shop.expire();f.shop.expire();
  assert.equal(product(f).reserved,0);assert.equal(product(f).stock,6);
});

test('un pago tardío no consume saldo de otra talla y requiere revisión si falta la comprada',async t=>{
  const f=fixture(t),l=variant(f,'Negro','L');
  f.shop.setCart(f.user,f.p.id,2,l.id);const order=await checkout(f);
  f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',order.id);f.shop.expire();
  f.shop.variantStock(f.admin,f.p.id,l.id,-2,'Salida tras vencimiento');
  const paid=f.shop.applyPayment(approved(order));
  assert.equal(paid.status,'payment_review');assert.equal(variant(f,'Negro','S').stock,3);
  assert.equal(variant(f,'Negro','L').stock,0);
  await f.shop.refund(f.admin,order.id);
  assert.equal(product(f).stock,4);
});

test('el reembolso repone la combinación exacta y es idempotente',async t=>{
  const f=fixture(t),l=variant(f,'Negro','L');
  f.shop.setCart(f.user,f.p.id,2,l.id);const order=await checkout(f);
  f.shop.demoPay(f.user,order.id);assert.equal(variant(f,'Negro','L').stock,0);
  await f.shop.refund(f.admin,order.id);
  f.shop.applyPayment({...approved(order,`demo-${order.id}`),status:'refunded',transaction_amount_refunded:order.total/100});
  assert.equal(variant(f,'Negro','L').stock,2);assert.equal(product(f).stock,6);
  assert.equal(f.shop.ledger().reduce((sum,row)=>sum+row.amount,0),0);
});

test('el reembolso de un pedido anterior vuelve al saldo pendiente y su reparto no crea unidades',async t=>{
  const f=fixture(t,{legacy:true,stock:8});
  f.shop.setCart(f.user,f.p.id,2);const order=await checkout(f);f.shop.demoPay(f.user,order.id);
  save(f,[combination('Negro','S',3),combination('Negro','L',3)]);
  await f.shop.refund(f.admin,order.id);
  const p=product(f),s=variant(f,'Negro','S');
  assert.equal(p.stock,8);assert.equal(p.unallocated_stock,2);
  assert.equal(p.variants.reduce((sum,v)=>sum+v.stock,0),6);
  const before=product(f);
  assert.throws(()=>f.shop.allocateVariants(f.admin,f.p.id,[{variant_id:s.id,quantity:3}],'Reparto inválido'),e=>e.status===400||e.status===409);
  assert.deepEqual(product(f),before);
  f.shop.allocateVariants(f.admin,f.p.id,[{variant_id:s.id,quantity:2}],'Clasificación de devolución histórica');
  assert.equal(product(f).stock,8);assert.equal(product(f).unallocated_stock,0);assert.equal(variant(f,'Negro','S').stock,5);
  assert.deepEqual(f.shop.order(order.id).items,order.items);
});

test('editar el catálogo no sobrescribe saldos y retirar una variación exige saldo cero',t=>{
  const f=fixture(t),before=product(f),entries=before.variants.map(editable);
  assert.throws(()=>save(f,entries.map((v,i)=>({...v,stock:i? v.stock:999}))),e=>e.status===400||e.status===409);
  assert.deepEqual(product(f),before);
  assert.throws(()=>save(f,entries.slice(1)),e=>e.status===409);
  assert.deepEqual(product(f),before);
  const s=variant(f,'Negro','S');
  f.shop.variantStock(f.admin,f.p.id,s.id,-s.stock,'Retirar modelo sin existencias');
  save(f,product(f).variants.filter(v=>v.id!==s.id).map(editable));
  assert.ok(!product(f).variants.some(v=>v.id===s.id));
  assert.throws(()=>f.shop.setCart(f.user,f.p.id,1,s.id),e=>e.status===400||e.status===404||e.status===409);
});

test('quitar una talla pausa sus variaciones y conserva saldos, reservas e historial',async t=>{
  const f=fixture(t),s=variant(f,'Negro','S');
  f.shop.setCart(f.user,f.p.id,1,s.id);const order=await checkout(f);
  const paused=save(f,product(f).variants.map(v=>({...editable(v),active:v.size!=='S'})),{sizes:['L']});
  const pausedS=paused.variants.find(v=>v.id===s.id);
  assert.equal(pausedS.stock,3);assert.equal(pausedS.reserved,1);assert.ok(!pausedS.active);
  assert.deepEqual(paused.sizes,['L']);
  const before=product(f);
  assert.throws(()=>save(f,before.variants.map(v=>({...editable(v),active:true})),{sizes:['L']}),e=>e.status===400||e.status===409);
  assert.deepEqual(product(f),before);
  f.shop.saveProduct(f.admin,{...base,name:'Nombre actualizado',sizes:['L']},f.p.id);
  assert.deepEqual(product(f).sizes,['L']);
  assert.deepEqual(f.shop.order(order.id).items,order.items);
  f.shop.demoPay(f.user,order.id);
  assert.equal(variant(f,'Negro','S').stock,2);assert.equal(variant(f,'Negro','S').reserved,0);
  save(f,product(f).variants.map(v=>({...editable(v),active:true})),{sizes:['S','L']});
  assert.ok(variant(f,'Negro','S').active);
});

test('el pedido conserva SKU, color, talla y precio originales tras editar metadatos',async t=>{
  const f=fixture(t,{variants:[combination('Negro','S',2,{sku:'ORIGINAL-S',price_override:3900})]});
  const s=variant(f,'Negro','S');
  f.shop.setCart(f.user,f.p.id,1,s.id);const order=await checkout(f);
  assert.equal(order.items[0].sku,'ORIGINAL-S');assert.equal(order.items[0].price,3900);
  assert.equal(order.items[0].selected_color,'Negro');assert.equal(order.items[0].selected_size,'S');
  save(f,product(f).variants.map(v=>({...editable(v),sku:'UPDATED-S',price_override:4500,color_hex:'#222222'})));
  assert.deepEqual(f.shop.order(order.id).items,order.items);
  assert.equal(f.shop.cart(f.user.id).items.length,0);
});

test('las fotos por color y el precio específico llegan a la tienda y a la línea del carrito',t=>{
  const f=fixture(t),black=hash('black variant photo'),white=hash('white variant photo');
  for(const id of [black,white])f.db.prepare('INSERT INTO media(id,data,actor_id,created_at) VALUES(?,?,?,?)').run(id,Buffer.from('fixture'),f.admin.id,now());
  save(f,product(f).variants.map(v=>({...editable(v),image_ids:[v.color_name==='Negro'?black:white],price_override:v.size==='S'?3100:null})));
  const pub=f.shop.products().find(p=>p.id===f.p.id);
  assert.deepEqual(pub.variants.filter(v=>v.color_name==='Negro').map(v=>v.images),[[`/media/${black}.jpg`],[`/media/${black}.jpg`]]);
  assert.deepEqual(pub.variants.find(v=>v.color_name==='Blanco').images,[`/media/${white}.jpg`]);
  const s=variant(f,'Negro','S');f.shop.setCart(f.user,f.p.id,1,s.id);
  const line=f.shop.cart(f.user.id).items[0];
  assert.equal(line.price,3100);assert.equal(line.sku,s.sku);assert.deepEqual(line.images,[`/media/${black}.jpg`]);
});

test('devolver una variación retirada mantiene las unidades visibles como pendientes de clasificar',async t=>{
  const f=fixture(t,{variants:[combination('Negro','S',1),combination('Blanco','L',1)]}),s=variant(f,'Negro','S');
  f.shop.setCart(f.user,f.p.id,1,s.id);const order=await checkout(f);f.shop.demoPay(f.user,order.id);
  save(f,product(f).variants.filter(v=>v.id!==s.id).map(editable));
  await f.shop.refund(f.admin,order.id);
  assert.equal(product(f).stock,2);assert.equal(product(f).unallocated_stock,1);
  assert.equal(variant(f,'Blanco','L').stock,1);
  assert.ok(!product(f).variants.some(v=>v.id===s.id));
  assert.deepEqual(f.shop.order(order.id).items,order.items);
});

test('HTTP: ajustar y distribuir variaciones exige sesión, permiso de inventario, origen y CSRF',async t=>{
  const f=fixture(t),app=createApp({db:f.db,config,runtime:'worker'}),s=variant(f,'Negro','S');
  const auth=user=>{
    const token=randomUUID(),csrf=randomUUID();
    f.db.prepare('INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(hash(token),user.id,csrf,new Date(Date.now()+60000).toISOString());
    return {cookie:`edg_session=${token}`,'x-csrf-token':csrf};
  };
  const request=async(path,body,headers={})=>{
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{url:path,method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{origin:config.url,'content-type':'application/json',...headers}});
    let status=200,data;
    const res={headersSent:false,setHeader(){},writeHead(code){status=code;this.headersSent=true;},end(value){data=JSON.parse(Buffer.from(value).toString());}};
    await app.handler(req,res);return {status,data};
  };
  const stockPath=`/api/admin/products/${f.p.id}/variants/${s.id}/stock`,allocationPath=`/api/admin/products/${f.p.id}/variants/allocate`;
  const adminHeaders=auth(f.admin),customerHeaders=auth(f.user),body={delta:1,reason:'Reposición autorizada'};
  assert.equal((await request(stockPath,body)).status,401);
  assert.equal((await request(stockPath,body,customerHeaders)).status,403);
  assert.equal((await request(allocationPath,{allocations:[],reason:'Reparto indebido'},customerHeaders)).status,403);
  assert.equal((await request(stockPath,body,{cookie:adminHeaders.cookie})).status,403);
  assert.equal((await request(stockPath,body,{...adminHeaders,origin:'https://other.example'})).status,403);
  assert.equal((await request(stockPath,body,adminHeaders)).status,200);
  assert.equal(variant(f,'Negro','S').stock,4);
});

for(const useTransactionSync of [false,true]){
  test(`la migración v8 conserva carritos, pedidos y reservas antiguos y se repite (${useTransactionSync?'Durable Object':'Node SQLite'})`,t=>{
    const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
    sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('./fixtures/schema-v7.sql',import.meta.url),'utf8'));
    const user=addUser(sql,'customer');
    sql.prepare('INSERT INTO products(id,sku,name,description,category,price,cost,stock,reserved,weight,width,height,length,color,icon,created_at,size,sizes) VALUES(?,?,?,?,?,?,?,10,2,.5,10,10,10,?,?,?, ?,?)')
      .run('legacy','OLD-SKU','Producto histórico','Histórico','Camiseta',2000,500,'#111111','◇',now(),'S','["S","L"]');
    sql.prepare('INSERT INTO carts VALUES(?,?,?)').run(user.id,'legacy',1);
    sql.prepare("INSERT INTO orders(id,number,user_id,status,subtotal,shipping,total,address,shipping_service,idempotency_key,request_hash,reserved_until,created_at,updated_at) VALUES(?,1001,?,'awaiting_payment',4000,0,4000,?,?,?,?,'2099-01-01',?,?)")
      .run('old-order',user.id,JSON.stringify(destination),'{}','old-idempotency','hash',now(),now());
    sql.prepare('INSERT INTO order_items(order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length) VALUES(?,?,?,?,?,?,2,.5,10,10,10)')
      .run('old-order','legacy','OLD-SKU','Producto histórico',2000,500);
    sql.prepare('INSERT INTO movements(product_id,quantity,reason,created_at) VALUES(?,10,?,?)').run('legacy','Entrada histórica',now());
    const tables=['products','carts','orders','order_items','movements'];
    const before=Object.fromEntries(tables.map(table=>[table,sql.prepare(`SELECT * FROM ${table}`).all().map(r=>({...r}))]));
    const db=useTransactionSync?{exec:q=>sql.exec(q),prepare:q=>sql.prepare(q),transactionSync(fn){sql.exec('BEGIN IMMEDIATE');try{const result=fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}}:sql;
    migrate(db);migrate(db);
    for(const table of tables){
      const rows=sql.prepare(`SELECT * FROM ${table}`).all();
      assert.equal(rows.length,before[table].length);
      assert.deepEqual(rows.map(row=>Object.fromEntries(Object.keys(before[table][0]).map(key=>[key,row[key]]))),before[table],table);
    }
    assert.equal(sql.prepare('SELECT MAX(version) version FROM schema_version').get().version,10);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=8').get().n,1);
    assert.equal(sql.prepare('SELECT variants_enabled FROM products').get().variants_enabled,0);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM product_variants').get().n,0);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
    const shop=commerce(db,config,providers(config));
    shop.cancel(user,'old-order');assert.equal(sql.prepare('SELECT reserved FROM products').get().reserved,0);
  });
}
