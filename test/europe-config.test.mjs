import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { configuration,createApp } from '../src/server.mjs';
import { database } from '../src/db.mjs';
import { migrate } from '../src/migrations.mjs';
import { initializeLegacy } from './legacy-schema.mjs';
import { hash,now,HttpError } from '../src/security.mjs';

const base={APP_URL:'https://store.example.test',COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR'};
// Fixture de formato IBAN; los tests no envían transferencias ni llaman al banco.
const iban='ES9121000418450200051332';
const enabled={...base,EUROPE_CHECKOUT_ENABLED:'true',BANK_TRANSFER_IBAN:iban};

test('EUR permanece en catálogo sin una activación explícita y transferencia no exige Stripe',()=>{
  const closed=configuration(base);assert.equal(closed.europeCheckout.enabled,false);
  const open=configuration({...enabled,BANK_TRANSFER_IBAN:'es91 2100 0418 4502 0005 1332'});
  assert.equal(open.europeCheckout.enabled,true);assert.equal(open.europeCheckout.bank.iban,iban);
  assert.equal(open.europeCheckout.environment,'test');assert.equal(open.europeCheckout.transferHours,72);
  assert.equal(open.europeCheckout.bank.bank,'Banco Sabadell');assert.equal(open.stripe.enabled,false);
});

test('la activación exige IBAN completo y válido, EUR, catálogo y una reserva acotada',()=>{
  for(const changes of [
    {BANK_TRANSFER_IBAN:''},{BANK_TRANSFER_IBAN:'ES30 0081 0077 8700 0214'},
    {BANK_TRANSFER_IBAN:iban.slice(0,-1)+'3'},{STORE_CURRENCY:'BRL'},
    {COMMERCE_MODE:'demo'},{SHIPPING_PROVIDER:'melhorenvio'},
    {BANK_TRANSFER_RESERVATION_HOURS:'0'},{BANK_TRANSFER_RESERVATION_HOURS:'169'},
    {BANK_TRANSFER_RESERVATION_HOURS:'1.5'},{PAYMENT_ENVIRONMENT:'production'},
    {EUROPE_CHECKOUT_ENABLED:'yes'},{BANK_TRANSFER_BENEFICIARY:'Invalid\nBeneficiary'},
  ])assert.throws(()=>configuration({...enabled,...changes}),{status:500});
});

test('las claves de tarjeta son opcionales y nunca mezclan prueba con producción',()=>{
  assert.equal(configuration({...enabled,STRIPE_SECRET_KEY:'sk_test_fixture'}).stripe.enabled,false);
  const stripe=configuration({...enabled,STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'}).stripe;
  assert.equal(stripe.enabled,true);assert.equal(stripe.environment,'test');
  assert.equal(configuration({...enabled,PAYMENT_ENVIRONMENT:'live',STRIPE_SECRET_KEY:'rk_live_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'}).stripe.enabled,true);
  for(const changes of [
    {STRIPE_SECRET_KEY:'sk_live_fixture'},
    {PAYMENT_ENVIRONMENT:'live',STRIPE_SECRET_KEY:'sk_test_fixture'},
    {STRIPE_WEBHOOK_SECRET:'invalid-signature-key'},
  ])assert.throws(()=>configuration({...enabled,...changes}),{status:500});
});

function fixture(t,{stripeEnabled=true,checkoutEnabled=true}={}){
  const db=database(':memory:');t.after(()=>db.close());
  const config=configuration({...enabled,...(!checkoutEnabled?{EUROPE_CHECKOUT_ENABLED:'false'}:{}),...(stripeEnabled?{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'}:{})});
  const users={};
  for(const role of ['admin','finance','shipping','customer']){
    const id=randomUUID(),raw=randomUUID(),csrf=randomUUID();
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id,role,`${role}@example.test`,'unused',role,now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw),id,csrf,new Date(Date.now()+60000).toISOString());
    users[role]={cookie:`edg_session=${raw}`,'x-csrf-token':csrf};
  }
  let notification={type:'checkout.session.completed',data:{object:{id:'cs_test_fixture'}}};
  const counts={verified:0,retrieved:0,applied:0,refunds:0,confirmed:0};
  const stripe={
    verifyWebhook(headers,raw){counts.verified++;assert.equal(raw.toString(),'signed fixture');if(headers['stripe-signature']!=='valid')throw new HttpError(401,'Firma no válida.');return notification;},
    async retrieveSession(id){counts.retrieved++;assert.equal(id,'cs_test_fixture');return {id,payment_intent:'pi_fixture'};},
  };
  const app=createApp({db,config,stripe,runtime:'worker'});
  app.shop.applyStripeSession=async session=>{counts.applied++;assert.equal(session.id,'cs_test_fixture');};
  app.shop.applyStripeRefund=async(charge,paymentSession)=>{counts.refunds++;assert.equal(charge.id,'ch_fixture');counts.refundSession=paymentSession;};
  app.shop.confirmTransfer=()=>{counts.confirmed++;return {ok:true};};
  async function call(path,{method='GET',body,headers={},raw}={}){
    const bytes=raw??(body===undefined?null:Buffer.from(JSON.stringify(body)));
    const req=Readable.from(bytes?[bytes]:[]);
    Object.assign(req,{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{origin:config.url,'content-type':'application/json',...headers}});
    const result={status:200,headers:{}};
    const response={headersSent:false,setHeader(key,value){result.headers[key.toLowerCase()]=value;},
      writeHead(status,values){result.status=status;for(const [key,value]of Object.entries(values))this.setHeader(key,value);this.headersSent=true;},
      end(value){result.data=value?JSON.parse(Buffer.from(value).toString()):null;}};
    await app.handler(req,response);return result;
  }
  function stripeOrder(changes={}){
    const row={id:'order-fixture',number:1001,user_id:db.prepare("SELECT id FROM users WHERE role='customer'").get().id,
      status:'awaiting_payment',subtotal:1000,shipping:0,total:1000,address:'{}',shipping_service:'{}',
      idempotency_key:'fixture-key',request_hash:'fixture-hash',reserved_until:new Date(Date.now()+60000).toISOString(),
      created_at:now(),updated_at:now(),currency:'EUR',payment_method:'stripe',payment_environment:'test',
      preference_id:'cs_test_fixture',payment_id:'pi_fixture',...changes};
    db.prepare(`INSERT INTO orders(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  return {app,config,users,counts,call,stripeOrder,notify:value=>{notification=value;}};
}

test('la configuración pública muestra métodos disponibles sin IBAN ni credenciales',async t=>{
  for(const stripeEnabled of [false,true]){
    const f=fixture(t,{stripeEnabled}),result=await f.call('/api/config');
    assert.equal(result.status,200);assert.equal(result.data.checkout_enabled,true);
    assert.deepEqual(result.data.payment_methods,stripeEnabled?['bank_transfer','stripe']:['bank_transfer']);
    assert.equal(result.data.payment_environment,'test');
    for(const secret of [iban,'sk_test_fixture','whsec_fixture'])assert.ok(!JSON.stringify(result.data).includes(secret));
  }
  const closed=fixture(t,{checkoutEnabled:false}),config=await closed.call('/api/config');
  assert.equal(config.data.checkout_enabled,false);assert.deepEqual(config.data.payment_methods,[]);
  assert.equal((await closed.call('/api/checkout',{method:'POST',body:{}})).status,503);
});

test('confirmar una transferencia requiere sesión financiera, origen y CSRF',async t=>{
  const f=fixture(t),path='/api/admin/orders/order-fixture/confirm-transfer';
  for(const headers of [{},f.users.customer,f.users.shipping,{cookie:f.users.admin.cookie},{...f.users.admin,origin:'https://other.example.test'}]){
    assert.ok([401,403].includes((await f.call(path,{method:'POST',body:{},headers})).status));
  }
  assert.equal(f.counts.confirmed,0);
  for(const role of ['admin','finance'])assert.equal((await f.call(path,{method:'POST',body:{},headers:f.users[role]})).status,200);
  assert.equal(f.counts.confirmed,2);
});

test('el webhook Stripe verifica bytes antes de aplicar y no exige sesión del navegador',async t=>{
  const f=fixture(t),path='/api/webhooks/stripe',raw=Buffer.from('signed fixture');
  assert.equal((await f.call(path,{method:'POST',raw,headers:{origin:undefined}})).status,401);
  assert.equal(f.counts.retrieved,0);assert.equal(f.counts.applied,0);
  const headers={origin:undefined,'stripe-signature':'valid'};
  assert.equal((await f.call(path,{method:'POST',raw,headers})).status,200);
  assert.equal(f.counts.retrieved,1);assert.equal(f.counts.applied,1);
  f.stripeOrder();
  f.notify({type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:'pi_fixture'}}});
  assert.equal((await f.call(path,{method:'POST',raw,headers})).status,200);assert.equal(f.counts.refunds,1);
  f.notify({type:'customer.created',data:{object:{id:'cus_fixture'}}});
  assert.equal((await f.call(path,{method:'POST',raw,headers})).status,200);assert.equal(f.counts.applied,1);
});

test('un reembolso anterior a la confirmación reconcilia la sesión guardada y nunca muta pedidos ajenos',async t=>{
  const request={method:'POST',raw:Buffer.from('signed fixture'),headers:{origin:undefined,'stripe-signature':'valid'}};
  const notification={type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:'pi_fixture',metadata:{order_id:'order-fixture'}}}};
  const f=fixture(t);f.stripeOrder({payment_id:null});f.notify(notification);
  assert.equal((await f.call('/api/webhooks/stripe',request)).status,200);
  assert.equal(f.counts.retrieved,1);assert.equal(f.counts.refunds,1);
  assert.equal(f.counts.refundSession.id,'cs_test_fixture');

  const missing=fixture(t);missing.stripeOrder({payment_id:null,preference_id:null});missing.notify(notification);
  assert.equal((await missing.call('/api/webhooks/stripe',request)).status,503);
  assert.equal(missing.counts.retrieved,0);assert.equal(missing.counts.refunds,0);

  const unknown=fixture(t);unknown.notify(notification);
  assert.equal((await unknown.call('/api/webhooks/stripe',request)).status,200);
  assert.equal(unknown.counts.retrieved,0);assert.equal(unknown.counts.refunds,0);

  const mismatch=fixture(t);mismatch.stripeOrder({payment_id:null});
  mismatch.notify({...notification,data:{object:{...notification.data.object,payment_intent:'pi_other'}}});
  assert.equal((await mismatch.call('/api/webhooks/stripe',request)).status,409);
  assert.equal(mismatch.counts.refunds,0);
});

test('el webhook Stripe desactivado y los proveedores brasileños no pueden cobrar pedidos EUR',async t=>{
  const f=fixture(t,{stripeEnabled:false});
  for(const path of ['/api/webhooks/stripe','/api/webhooks/mercadopago','/api/webhooks/melhorenvio']){
    assert.equal((await f.call(path,{method:'POST',body:{}})).status,503);
  }
  assert.equal(f.counts.verified,0);
  for(const path of ['/api/admin/invoices','/api/admin/orders/id/invoice-preview','/api/orders/id/invoice/pdf']){
    assert.equal((await f.call(path,{headers:f.users.admin})).status,503);
  }
});

test('la migración conserva pedidos anteriores como BRL y se puede repetir',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeLegacy(db,7);
  db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run('legacy-user','Cliente','legacy@example.test','unused','customer',now());
  db.prepare("INSERT INTO orders(id,number,user_id,status,subtotal,shipping,total,address,shipping_service,idempotency_key,request_hash,reserved_until,created_at,updated_at) VALUES(?,?,?,'awaiting_payment',?,?,?,?,?,?,?,?,?,?)").run('legacy-order',1001,'legacy-user',1000,100,1100,'{}','{}','legacy-key','legacy-hash',now(),now(),now());
  migrate(db);migrate(db);
  const order=db.prepare('SELECT * FROM orders').get();
  assert.equal(order.total,1100);assert.equal(order.currency,'BRL');assert.equal(order.payment_method,'mercadopago');
  assert.equal(order.payment_environment,'live');assert.equal(order.bank_transfer_details,null);
  assert.equal(db.prepare('SELECT MAX(version) v FROM schema_version').get().v,9);
});
