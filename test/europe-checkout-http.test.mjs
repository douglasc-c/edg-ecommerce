import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { database } from '../src/db.mjs';
import { configuration,createApp } from '../src/server.mjs';
import { stripeProvider } from '../src/stripe.mjs';
import { hash,now } from '../src/security.mjs';

const destination={name:'Cliente de prueba',phone:'+34910000000',street:'Calle Mayor',number:'20',
  complement:'',postal_code:'28001',city:'Madrid',country_code:'ES'};
const signingSecret='whsec_fixture';
function fixture(t,enabled=true){
  const db=database(':memory:');t.after(()=>db.close());
  const config=configuration({APP_URL:'https://store.example.test',COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR',
    EUROPE_CHECKOUT_ENABLED:String(enabled),PAYMENT_ENVIRONMENT:'test',BANK_TRANSFER_IBAN:'ES9121000418450200051332',
    SENDCLOUD_PUBLIC_KEY:'senderpublic',SENDCLOUD_SECRET_KEY:'senderprivate',SENDCLOUD_SENDER_ADDRESS_ID:'123',
    STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:signingSecret});
  const users={},auth={},sessions=new Map();let retrievals=0;
  for(const role of ['customer','admin','finance','shipping']){
    const u={id:randomUUID(),name:role,email:`${role}@example.test`,role},raw=randomUUID(),csrf=randomUUID();
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(u.id,u.name,u.email,'unused',role,now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw),u.id,csrf,new Date(Date.now()+60000).toISOString());
    users[role]=u;auth[role]={cookie:`edg_session=${raw}`,'x-csrf-token':csrf};
  }
  const sendcloud={async sender(){return {id:123,name:'EDG',address:'Carrer Prueba',house_number:'1',postal_code:'08001',city:'Barcelona',country_code:'ES'};},
    async quote(){return [{id:'test:home|',name:'Entrega de prueba',carrier:'Prueba',price:500,currency:'EUR',days:3,shipping_option_code:'test:home',contract_id:null}];}};
  const stripe={...stripeProvider(config,()=>assert.fail('No debe llamar a la red.')),
    async preference(order){const s={id:'cs_test_httpfixture',object:'checkout.session',metadata:{order_id:order.id},client_reference_id:order.id,
      currency:'eur',amount_total:order.total,livemode:false,payment_status:'paid',status:'complete',payment_intent:'pi_httpfixture'};
      sessions.set(s.id,s);return {id:s.id,url:'https://checkout.stripe.com/c/pay/'+s.id};},
    async retrieveSession(id){retrievals++;assert.ok(sessions.has(id));return sessions.get(id);}};
  const app=createApp({db,config,europeProvider:sendcloud,stripe,runtime:'worker'});
  const p=app.shop.saveProduct(users.admin,{sku:'HTTP-EUR-1',name:'Producto de prueba',category:'Prueba',description:'Artículo de prueba',
    price:1000,cost:500,low_stock:1,weight:0.5,width:10,height:5,length:20,color:'#ffffff',icon:'◇'});
  app.shop.stock(users.admin,p.id,5,'Entrada de prueba');
  async function call(path,{method='GET',body,headers={},raw}={}){
    const bytes=raw??(body===undefined?null:Buffer.from(JSON.stringify(body))),req=Readable.from(bytes?[bytes]:[]);
    Object.assign(req,{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{origin:config.url,'content-type':'application/json',...headers}});
    const result={status:200,headers:{}};
    const response={headersSent:false,setHeader(k,v){result.headers[k.toLowerCase()]=v;},
      writeHead(status,values){result.status=status;for(const [k,v]of Object.entries(values))this.setHeader(k,v);this.headersSent=true;},
      end(value){result.data=JSON.parse(Buffer.from(value).toString());}};
    await app.handler(req,response);return result;
  }
  async function buy(payment_method='bank_transfer'){
    const h=auth.customer;
    assert.equal((await call('/api/cart/'+p.id,{method:'PUT',body:{quantity:1},headers:h})).status,200);
    const q=await call('/api/shipping/quote',{method:'POST',body:{address:destination},headers:h});assert.equal(q.status,200);
    const result=await call('/api/checkout',{method:'POST',body:{address:destination,quote_id:q.data.id,service_id:q.data.options[0].id,payment_method},headers:{...h,'idempotency-key':randomUUID()}});
    assert.equal(result.status,201);return result.data;
  }
  return {db,config,users,auth,app,p,call,buy,sessions,retrievals:()=>retrievals};
}

test('HTTP EUR: la configuración pública anuncia métodos y entorno sin datos bancarios ni credenciales',async t=>{
  const f=fixture(t),response=await f.call('/api/config');
  assert.equal(response.status,200);assert.equal(response.data.checkout_enabled,true);
  assert.deepEqual(response.data.payment_methods,['bank_transfer','stripe']);assert.equal(response.data.payment_environment,'test');
  for(const value of [f.config.europeCheckout.bank.iban,'sk_test_fixture',signingSecret,'senderprivate'])assert.ok(!JSON.stringify(response.data).includes(value));
  const order=await f.buy();
  assert.equal(order.bank_transfer.iban,f.config.europeCheckout.bank.iban);assert.equal(order.bank_transfer_details,undefined);
  assert.equal(order.payment_id,undefined);assert.equal(order.items[0].cost,undefined);
  assert.equal((await f.call('/api/orders/'+order.id,{headers:f.auth.shipping})).status,404);
});

test('HTTP EUR: la clave interna de Stripe no se publica y el pago vencido explica cómo continuar',async t=>{
  const f=fixture(t),order=await f.buy('stripe');
  f.db.prepare('UPDATE orders SET reserved_until=?,stripe_checkout_key=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z','preference-private-retry',order.id);
  const response=await f.call('/api/orders/'+order.id+'/payment',{method:'POST',headers:f.auth.customer});
  assert.equal(response.status,409);assert.match(response.data.error,/vencido.*nuevo pedido/i);
  const updated=await f.call('/api/orders/'+order.id,{headers:f.auth.customer});
  assert.equal(updated.data.status,'expired');assert.equal(updated.data.stripe_checkout_key,undefined);
  assert.ok(!JSON.stringify(updated.data).includes('preference-private-retry'));
  assert.equal(f.db.prepare('SELECT reserved FROM products WHERE id=?').get(f.p.id).reserved,0);
});

test('HTTP EUR: el checkout permanece cerrado mientras no se active expresamente',async t=>{
  const f=fixture(t,false),config=await f.call('/api/config');assert.equal(config.data.checkout_enabled,false);
  assert.deepEqual(config.data.payment_methods,[]);
  assert.equal((await f.call('/api/cart/'+f.p.id,{method:'PUT',body:{quantity:1},headers:f.auth.customer})).status,503);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
});

test('HTTP EUR: confirmar transferencias exige sesión, finanzas, origen y CSRF',async t=>{
  const f=fixture(t),order=await f.buy(),path='/api/admin/orders/'+order.id+'/confirm-transfer';
  const body={bank_reference:'HTTP-BANK-RECEIPT',amount:order.total,confirmed:true};
  assert.equal((await f.call(path,{method:'POST',body})).status,401);
  for(const role of ['customer','shipping'])assert.equal((await f.call(path,{method:'POST',body,headers:f.auth[role]})).status,403);
  assert.equal((await f.call(path,{method:'POST',body,headers:{cookie:f.auth.finance.cookie}})).status,403);
  assert.equal((await f.call(path,{method:'POST',body,headers:{...f.auth.finance,origin:'https://other.example'}})).status,403);
  assert.equal(f.app.shop.order(order.id).payment_status,'pending');
  const result=await f.call(path,{method:'POST',body,headers:f.auth.finance});assert.equal(result.status,200);assert.equal(result.data.status,'paid');
  assert.equal(f.app.shop.ledger().length,1);
});

test('HTTP EUR: solo el webhook Stripe firmado confirma tarjetas y repeticiones no duplican la venta',async t=>{
  const f=fixture(t),order=await f.buy('stripe');
  const session=[...f.sessions.values()][0];
  const raw=Buffer.from(JSON.stringify({id:'evt_httpfixture',type:'checkout.session.completed',livemode:false,data:{object:{id:session.id}}}));
  const timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',signingSecret).update(timestamp+'.').update(raw).digest('hex');
  const path='/api/webhooks/stripe';
  assert.equal((await f.call(path,{method:'POST',raw,headers:{origin:undefined}})).status,401);
  assert.equal(f.retrievals(),0);assert.equal(f.app.shop.order(order.id).payment_status,'pending');
  const headers={'stripe-signature':`t=${timestamp},v1=${signature}`,origin:undefined};
  for(let i=0;i<2;i++)assert.equal((await f.call(path,{method:'POST',raw,headers})).status,200);
  assert.equal(f.retrievals(),2);assert.equal(f.app.shop.order(order.id).status,'paid');assert.equal(f.app.shop.ledger().length,1);
});
