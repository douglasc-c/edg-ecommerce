import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database } from '../src/db.mjs';
import { commerce } from '../src/commerce.mjs';
import { configuration } from '../src/server.mjs';
import { europeCommerceProvider } from '../src/europe-commerce.mjs';
import { stripeProvider as createStripeProvider } from '../src/stripe.mjs';
import { migrate } from '../src/migrations.mjs';
import { now } from '../src/security.mjs';

// Public format example used only with fake providers and an in-memory database.
const testIban='ES9121000418450200051332';
const address={name:'Cliente de prueba',phone:'+34910000000',street:'Calle Mayor',number:'20',
  complement:'Piso 1',postal_code:'28001',city:'Madrid',country_code:'ES'};
const service={id:'test:home|',name:'Entrega de prueba',carrier:'Transportista de prueba',price:1295,
  currency:'EUR',days:3,shipping_option_code:'test:home',contract_id:null};

function fixture(t,{stripe=true,environment='test'}={}){
  const db=database(':memory:');t.after(()=>db.close());
  const config=configuration({APP_URL:'https://store.example.test',COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR',
    EUROPE_CHECKOUT_ENABLED:'true',PAYMENT_ENVIRONMENT:environment,BANK_TRANSFER_IBAN:testIban,
    SENDCLOUD_PUBLIC_KEY:'senderpublic',SENDCLOUD_SECRET_KEY:'senderprivate',SENDCLOUD_SENDER_ADDRESS_ID:'123',
    ...(stripe?{STRIPE_SECRET_KEY:`sk_${environment}_fixture`,STRIPE_WEBHOOK_SECRET:'whsec_fixture'}:{})});
  const users={};
  for(const role of ['customer','admin','finance','shipping']){
    const user={id:randomUUID(),name:role,email:`${role}@example.test`,role};
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(user.id,user.name,user.email,'unused',user.role,now());users[role]=user;
  }
  const calls={quote:[],preference:[],refund:[]},sessions=new Map();
  const sendcloud={
    async sender(){return {id:123,name:'EDG',address:'Carrer de prova',house_number:'1',postal_code:'08001',city:'Barcelona',country_code:'ES'};},
    async quote(input){calls.quote.push(structuredClone(input));return [service];},
  };
  const stripeProvider={
    async preference(order,items,user){
      calls.preference.push(structuredClone({order,items,user}));
      const session={id:`cs_test_${order.id.replaceAll('-','')}`,object:'checkout.session',client_reference_id:order.id,
        metadata:{order_id:order.id},currency:'eur',amount_total:order.total,livemode:environment==='live',
        status:'complete',payment_status:'paid',payment_intent:`pi_${order.id.replaceAll('-','')}`};
      sessions.set(order.id,session);
      return {id:session.id,url:`https://checkout.stripe.com/c/pay/${session.id}`};
    },
    async refund(paymentIntent,id){calls.refund.push({paymentIntent,id});const s=sessions.get(id);return {
      id:'re_testrefund',object:'refund',payment_intent:paymentIntent,currency:'eur',amount:s.amount_total,status:'succeeded'};},
  };
  const provider=europeCommerceProvider(config,sendcloud,stripeProvider),shop=commerce(db,config,provider);
  const product=shop.saveProduct(users.admin,{sku:'EUR-001',name:'Producto de prueba',description:'Artículo de prueba',
    category:'Prueba',price:10000,cost:4000,low_stock:2,weight:0.5,width:10,height:5,length:20,color:'#ffffff',icon:'◇'});
  shop.stock(users.admin,product.id,10,'Entrada de prueba');
  return {db,config,users,calls,sessions,provider,stripeProvider,shop,product};
}

const stock=f=>f.db.prepare('SELECT stock,reserved FROM products WHERE id=?').get(f.product.id);
const balance=f=>f.shop.ledger().reduce((sum,entry)=>sum+entry.amount,0);
async function buy(f,{method='bank_transfer',quantity=1,target=address,key=randomUUID()}={}){
  f.shop.setCart(f.users.customer,f.product.id,quantity);
  const quote=await f.shop.quote(f.users.customer,target);
  const input={quote_id:quote.id,service_id:quote.options[0].id,address:target,payment_method:method};
  const order=await f.shop.checkout(f.users.customer,input,key);
  return {order,input,key,quote};
}
const confirmation=(order,bank_reference='BANK-RECEIPT-001')=>({bank_reference,amount:order.total,confirmed:true});

// Stripe replays executed requests before validating a new session's expiration.
function stripeReplay(f,{loseResponse='before'}={}) {
  const requests=[],sessions=new Map();
  f.provider.preference=createStripeProvider(f.config,async(url,init)=>{
    const body=new URLSearchParams(init.body),key=init.headers['Idempotency-Key'];
    requests.push({body:init.body,key});
    if(requests.length===1&&loseResponse==='before')throw new TypeError('Lost connection before creation');
    const cached=sessions.get(key);
    if(cached){assert.equal(init.body,cached.body);return Response.json(cached.session);}
    if(Number(body.get('expires_at'))<Math.floor(Date.now()/1000)+1800)
      return Response.json({error:{type:'invalid_request_error',param:'expires_at'}},{status:400});
    const id=body.get('client_reference_id'),session={id:`cs_test_resume${sessions.size}`,object:'checkout.session',
      livemode:false,currency:'eur',amount_total:Number(body.get('line_items[0][price_data][unit_amount]')),
      client_reference_id:id,metadata:{order_id:id},status:'open',payment_status:'unpaid',payment_intent:null,
      expires_at:Number(body.get('expires_at')),url:'https://checkout.stripe.com/c/pay/cs_test_resume'};
    sessions.set(key,{body:init.body,session});
    if(requests.length===1&&loseResponse==='after')throw new TypeError('Lost response after creation');
    return Response.json(session);
  }).preference;
  return {requests,sessions};
}

test('Stripe permite retomar un pedido sin sesión después de cinco minutos sin duplicar reservas',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.method(console,'error',()=>{});
  const f=fixture(t),remote=stripeReplay(f);
  await assert.rejects(buy(f,{method:'stripe',quantity:2}),{status:502});
  const pending=f.shop.listOrders(f.users.customer)[0],originalUntil=pending.reserved_until;
  t.mock.timers.tick(6*60000);
  const resumed=await f.shop.paymentLink(f.users.customer,pending.id);
  assert.equal(resumed.id,pending.id);assert.equal(resumed.status,'awaiting_payment');
  assert.ok(Date.parse(resumed.reserved_until)>Date.parse(originalUntil));
  assert.equal(remote.sessions.size,1);assert.equal(remote.requests.length,3);
  assert.equal(remote.requests[1].key,remote.requests[0].key);
  assert.equal(remote.requests[1].body,remote.requests[0].body);
  assert.notEqual(remote.requests[2].key,remote.requests[0].key);
  assert.deepEqual({...stock(f)},{stock:10,reserved:2});assert.equal(balance(f),0);
  assert.equal(f.shop.cart(f.users.customer.id).items.length,0);
  await f.shop.paymentLink(f.users.customer,pending.id);assert.equal(remote.requests.length,3);
});

test('Stripe recupera una sesión creada antes del timeout conservando clave, parámetros y plazo',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.method(console,'error',()=>{});
  const f=fixture(t),remote=stripeReplay(f,{loseResponse:'after'});
  await assert.rejects(buy(f,{method:'stripe'}),{status:502});
  const pending=f.shop.listOrders(f.users.customer)[0];t.mock.timers.tick(6*60000);
  const resumed=await f.shop.paymentLink(f.users.customer,pending.id);
  assert.equal(resumed.reserved_until,pending.reserved_until);
  assert.equal(resumed.preference_id,[...remote.sessions.values()][0].session.id);
  assert.equal(remote.requests.length,2);assert.deepEqual(remote.requests[0],remote.requests[1]);
  assert.equal(remote.sessions.size,1);assert.deepEqual({...stock(f)},{stock:10,reserved:1});
});

test('un pedido Stripe vencido rechaza la reanudación con instrucciones y libera las existencias',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const f=fixture(t),{order}=await buy(f,{method:'stripe'});
  t.mock.timers.tick(36*60000);
  await assert.rejects(f.shop.paymentLink(f.users.customer,order.id),error=>error.status===409&&/vencido.*nuevo pedido/i.test(error.message));
  assert.equal(f.shop.order(order.id).status,'expired');assert.equal(f.calls.preference.length,1);
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(balance(f),0);
});

test('la clave renovada sobrevive a un timeout y a la reconstrucción del servicio',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.method(console,'error',()=>{});
  const f=fixture(t),remote=stripeReplay(f),preference=f.provider.preference;
  await assert.rejects(buy(f,{method:'stripe'}),{status:502});
  const pending=f.shop.listOrders(f.users.customer)[0];t.mock.timers.tick(6*60000);
  f.provider.preference=async(...args)=>{
    const result=await preference(...args);
    if(remote.requests.length===3)throw Object.assign(new Error('Lost renewal response'),{status:502,uncertain:true});
    return result;
  };
  await assert.rejects(f.shop.paymentLink(f.users.customer,pending.id),{status:502});
  const until=f.shop.order(pending.id).reserved_until;
  t.mock.timers.tick(6*60000);
  const restarted=commerce(f.db,f.config,f.provider),resumed=await restarted.paymentLink(f.users.customer,pending.id);
  assert.equal(resumed.reserved_until,until);assert.equal(remote.requests.length,4);
  assert.deepEqual(remote.requests[2],remote.requests[3]);assert.equal(remote.sessions.size,1);
  assert.deepEqual({...stock(f)},{stock:10,reserved:1});assert.equal(balance(f),0);
});

test('no renueva un pedido que vence mientras Stripe rechaza la fecha de inicio',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.method(console,'error',()=>{});
  const f=fixture(t),remote=stripeReplay(f),preference=f.provider.preference;
  await assert.rejects(buy(f,{method:'stripe'}),{status:502});
  const pending=f.shop.listOrders(f.users.customer)[0];t.mock.timers.tick(6*60000);
  f.provider.preference=async(...args)=>{
    try{return await preference(...args);}catch(error){if(error.checkoutReservationRejected)t.mock.timers.tick(30*60000);throw error;}
  };
  await assert.rejects(f.shop.paymentLink(f.users.customer,pending.id),error=>error.status===409&&/nuevo pedido/.test(error.message));
  assert.equal(remote.requests.length,2);assert.equal(remote.sessions.size,0);
  assert.equal(f.shop.order(pending.id).status,'expired');assert.deepEqual({...stock(f)},{stock:10,reserved:0});
});

test('la migración desde v9 conserva pedidos Stripe, sesiones y reservas y se aplica una sola vez',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe',quantity:2});
  f.db.exec('ALTER TABLE orders DROP COLUMN stripe_checkout_key; DELETE FROM schema_version WHERE version=10;');
  const before={...f.db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)};
  migrate(f.db);migrate(f.db);
  const {stripe_checkout_key,...after}=f.db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
  assert.equal(stripe_checkout_key,null);assert.deepEqual(after,before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=10').get().n,1);
  assert.deepEqual({...stock(f)},{stock:10,reserved:2});
});

test('la transferencia crea instrucciones exactas sin confirmar un crédito ni registrar ingresos',async t=>{
  const f=fixture(t,{stripe:false}),{order}=await buy(f,{quantity:2});
  assert.equal(order.currency,'EUR');assert.equal(order.payment_method,'bank_transfer');
  assert.equal(order.payment_environment,'test');assert.equal(order.status,'awaiting_payment');
  assert.equal(order.payment_status,'pending');assert.equal(order.total,21295);
  assert.equal(order.bank_transfer.bank,'Banco Sabadell');assert.equal(order.bank_transfer.iban,testIban);
  assert.ok(order.bank_transfer.beneficiary);assert.ok(order.bank_transfer.reference);
  assert.equal(order.bank_transfer.due_at,order.reserved_until);
  const hours=(Date.parse(order.reserved_until)-Date.now())/3600000;
  assert.ok(hours>71.9&&hours<=72);
  assert.deepEqual({...stock(f)},{stock:10,reserved:2});assert.equal(balance(f),0);
  assert.equal(f.calls.preference.length,0);assert.equal(f.shop.order(order.id,f.users.customer).payment_status,'pending');
});

test('solo administración y finanzas pueden confirmar el abono exacto comprobado en el banco',async t=>{
  const f=fixture(t),{order}=await buy(f);
  for(const user of [f.users.customer,f.users.shipping]){
    assert.throws(()=>f.shop.confirmTransfer(user,order.id,confirmation(order)),error=>error.status===403);
  }
  for(const input of [{...confirmation(order),confirmed:false},{...confirmation(order),amount:order.total-1},
    {...confirmation(order),bank_reference:''}])assert.throws(()=>f.shop.confirmTransfer(f.users.finance,order.id,input));
  assert.equal(balance(f),0);assert.deepEqual({...stock(f)},{stock:10,reserved:1});
  const paid=f.shop.confirmTransfer(f.users.finance,order.id,confirmation(order));
  assert.equal(paid.payment_status,'approved');assert.equal(paid.status,'paid');
  assert.deepEqual({...stock(f)},{stock:9,reserved:0});assert.equal(balance(f),order.total);
});

test('repetir la confirmación del mismo recibo no duplica ingreso, venta ni movimiento',async t=>{
  const f=fixture(t),{order}=await buy(f,{quantity:2});
  f.shop.confirmTransfer(f.users.admin,order.id,confirmation(order));
  f.shop.confirmTransfer(f.users.finance,order.id,confirmation(order));
  assert.equal(f.shop.ledger().length,1);assert.equal(balance(f),order.total);
  assert.deepEqual({...stock(f)},{stock:8,reserved:0});
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM movements WHERE reference=? AND quantity<0").get(order.id).n,1);
  assert.throws(()=>f.shop.confirmTransfer(f.users.admin,order.id,confirmation(order,'OTHER-RECEIPT')));
});

test('un mismo recibo bancario no puede acreditar dos pedidos distintos',async t=>{
  const f=fixture(t),first=await buy(f),second=await buy(f);
  f.shop.confirmTransfer(f.users.finance,first.order.id,confirmation(first.order,'UNIQUE-BANK-RECEIPT'));
  assert.throws(()=>f.shop.confirmTransfer(f.users.finance,second.order.id,confirmation(second.order,'UNIQUE-BANK-RECEIPT')));
  assert.equal(f.shop.order(second.order.id).payment_status,'pending');
  assert.equal(balance(f),first.order.total);assert.deepEqual({...stock(f)},{stock:9,reserved:1});
});

test('un fallo de auditoría revierte la confirmación bancaria y permite corregir el intento',async t=>{
  const f=fixture(t),{order}=await buy(f);
  f.db.exec("CREATE TRIGGER reject_transfer_audit BEFORE INSERT ON audit WHEN NEW.action='payment.transfer_confirmed' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.throws(()=>f.shop.confirmTransfer(f.users.finance,order.id,confirmation(order)));
  assert.equal(f.shop.order(order.id).payment_status,'pending');assert.equal(balance(f),0);
  assert.deepEqual({...stock(f)},{stock:10,reserved:1});
  f.db.exec('DROP TRIGGER reject_transfer_audit;');
  assert.equal(f.shop.confirmTransfer(f.users.finance,order.id,confirmation(order)).status,'paid');
});

test('cambiar a producción no permite acreditar pedidos de prueba con el nuevo entorno',async t=>{
  const f=fixture(t),transfer=await buy(f),card=await buy(f,{method:'stripe'});
  f.config.europeCheckout.environment='live';
  assert.throws(()=>f.shop.confirmTransfer(f.users.finance,transfer.order.id,confirmation(transfer.order)));
  assert.throws(()=>f.shop.applyStripeSession(f.sessions.get(card.order.id)));
  assert.equal(balance(f),0);assert.deepEqual({...stock(f)},{stock:10,reserved:2});
});

test('las instrucciones de una transferencia ya creada conservan su beneficiario y cuenta',async t=>{
  const f=fixture(t),{order}=await buy(f),before=structuredClone(order.bank_transfer);
  f.config.europeCheckout.bank.iban='ES7620770024003102575766';
  f.config.europeCheckout.bank.beneficiary='Otro beneficiario';
  assert.deepEqual(f.shop.order(order.id,f.users.customer).bank_transfer,before);
});

test('la cotización queda vinculada a la dirección completa aunque el código postal sea igual',async t=>{
  const f=fixture(t);f.shop.setCart(f.users.customer,f.product.id,1);
  const q=await f.shop.quote(f.users.customer,address);
  for(const change of [{number:'99'},{street:'Otra calle'},{city:'Otra ciudad'}]){
    await assert.rejects(f.shop.checkout(f.users.customer,{quote_id:q.id,service_id:q.options[0].id,address:{...address,...change},payment_method:'bank_transfer'},randomUUID()));
  }
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(f.shop.ledger().length,0);
});

test('la cotización usa peso y dimensiones del catálogo y el cliente no fija el total',async t=>{
  const f=fixture(t);f.shop.setCart(f.users.customer,f.product.id,2);
  const q=await f.shop.quote(f.users.customer,{...address,weight:0.001,width:1,height:1,length:1});
  assert.equal(f.calls.quote.length,1);assert.equal(f.calls.quote[0].parcel.weight,1);
  assert.equal(f.calls.quote[0].destination.country_code,'ES');
  const result=await f.shop.checkout(f.users.customer,{quote_id:q.id,service_id:q.options[0].id,address,payment_method:'bank_transfer',total:1,shipping:0},randomUUID());
  assert.equal(result.total,21295);assert.equal(result.shipping,service.price);
});

test('los destinos fuera de Península y Baleares se rechazan antes de consultar el proveedor',async t=>{
  const f=fixture(t);f.shop.setCart(f.users.customer,f.product.id,1);
  for(const change of [{country_code:'FR'},{postal_code:'80010000'},...['35001','38001','51001','52001'].map(postal_code=>({postal_code}))]){
    await assert.rejects(f.shop.quote(f.users.customer,{...address,...change}));
  }
  assert.equal(f.calls.quote.length,0);
  const q=await f.shop.quote(f.users.customer,{...address,postal_code:'07001',city:'Palma'});
  assert.equal(q.options[0].currency,'EUR');
});

test('cancelación y vencimiento liberan la reserva una sola vez sin acreditar dinero',async t=>{
  const f=fixture(t),first=await buy(f,{quantity:2});
  f.shop.cancel(f.users.customer,first.order.id);
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});
  const second=await buy(f,{quantity:3});
  f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',second.order.id);
  f.shop.expire();f.shop.expire();
  assert.equal(f.shop.order(second.order.id).status,'expired');
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(balance(f),0);
});

test('una transferencia tardía sin existencias exige revisión y no habilita el envío',async t=>{
  const f=fixture(t),{order}=await buy(f,{quantity:2});
  f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',order.id);
  f.shop.expire();f.shop.stock(f.users.admin,f.product.id,-10,'Salida de prueba');
  const result=f.shop.confirmTransfer(f.users.finance,order.id,confirmation(order));
  assert.equal(result.status,'payment_review');assert.equal(result.payment_status,'approved');
  assert.equal(balance(f),order.total);assert.deepEqual({...stock(f)},{stock:0,reserved:0});
  assert.throws(()=>f.shop.status(f.users.admin,order.id,'picking'));
});

test('la idempotencia incluye el método de pago y Stripe no disponible se rechaza antes de reservar',async t=>{
  const f=fixture(t,{stripe:false});f.shop.setCart(f.users.customer,f.product.id,1);
  const q=await f.shop.quote(f.users.customer,address);
  await assert.rejects(f.shop.checkout(f.users.customer,{quote_id:q.id,service_id:q.options[0].id,address,payment_method:'stripe'},randomUUID()));
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});
  const {order,input,key}=await buy(f);
  assert.equal((await f.shop.checkout(f.users.customer,input,key)).id,order.id);
  await assert.rejects(f.shop.checkout(f.users.customer,{...input,payment_method:'stripe'},key));
  assert.equal(f.calls.preference.length,0);
});

test('Stripe recibe el total calculado, reserva 35 minutos y una visita no confirma el pago',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe',quantity:2});
  assert.equal(order.currency,'EUR');assert.equal(order.payment_method,'stripe');assert.equal(order.status,'awaiting_payment');
  assert.match(order.payment_url,/^https:\/\/checkout\.stripe\.com\//);
  assert.equal(f.calls.preference.length,1);assert.equal(f.calls.preference[0].order.total,21295);
  const minutes=(Date.parse(order.reserved_until)-Date.now())/60000;assert.ok(minutes>34&&minutes<=35);
  assert.equal(f.shop.order(order.id,f.users.customer).payment_status,'pending');assert.equal(balance(f),0);
  await f.shop.paymentLink(f.users.customer,order.id);assert.equal(f.calls.preference.length,1);
});

test('la confirmación Stripe valida sesión, pedido, importe, moneda y entorno antes de registrar una venta',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe'}),session=f.sessions.get(order.id);
  assert.equal(f.shop.applyStripeSession({...session,metadata:{order_id:'other'}}),null);
  assert.equal(f.shop.order(order.id).payment_status,'pending');assert.equal(balance(f),0);
  for(const change of [{id:'cs_test_wrong'},{client_reference_id:'other'},
    {amount_total:order.total+1},{currency:'brl'},{livemode:true}]){
    assert.throws(()=>f.shop.applyStripeSession({...session,...change}));
    assert.equal(f.shop.order(order.id).payment_status,'pending');assert.equal(balance(f),0);
  }
  const paid=f.shop.applyStripeSession(session);assert.equal(paid.status,'paid');
  f.shop.applyStripeSession(session);assert.equal(f.shop.ledger().length,1);assert.equal(balance(f),order.total);
  assert.deepEqual({...stock(f)},{stock:9,reserved:0});
});

test('una sesión Stripe impagada no acredita fondos y una transferencia no acepta una sesión de tarjeta',async t=>{
  const f=fixture(t),stripeOrder=await buy(f,{method:'stripe'}),session=f.sessions.get(stripeOrder.order.id);
  try{f.shop.applyStripeSession({...session,payment_status:'unpaid',status:'open',payment_intent:null});}catch(error){assert.ok(error.status>=400);}
  assert.equal(f.shop.order(stripeOrder.order.id).payment_status,'pending');assert.equal(balance(f),0);
  const transfer=await buy(f);
  assert.throws(()=>f.shop.applyStripeSession({...session,metadata:{order_id:transfer.order.id},client_reference_id:transfer.order.id}));
  assert.equal(f.shop.order(transfer.order.id).payment_status,'pending');
});

test('el reembolso Stripe completo repone existencias una vez y liquida el ingreso',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe',quantity:2}),session=f.sessions.get(order.id);
  f.shop.applyStripeSession(session);
  const refunded=await f.shop.refund(f.users.finance,order.id);
  assert.equal(refunded.payment_status,'refunded');assert.equal(refunded.refunded,order.total);
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(balance(f),0);
  const charge={id:'ch_fixture',object:'charge',payment_intent:session.payment_intent,metadata:{order_id:order.id},
    amount:order.total,amount_refunded:order.total,currency:'eur',livemode:false,refunded:true};
  f.shop.applyStripeRefund(charge);assert.equal(f.shop.ledger().length,2);
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(balance(f),0);
});

test('reembolsos Stripe de otro entorno o importe no alteran una venta aprobada',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe'}),session=f.sessions.get(order.id);f.shop.applyStripeSession(session);
  const charge={id:'ch_fixture',object:'charge',payment_intent:session.payment_intent,metadata:{order_id:order.id},
    amount:order.total,amount_refunded:order.total,currency:'eur',livemode:false,refunded:true};
  for(const change of [{currency:'brl'},{livemode:true},{amount:order.total+1},{amount_refunded:order.total+1}]){
    assert.throws(()=>f.shop.applyStripeRefund({...charge,...change}));
    assert.equal(f.shop.order(order.id).payment_status,'approved');assert.equal(balance(f),order.total);
  }
});

test('un reembolso recibido antes de completar el pago libera la reserva sin resucitar el pedido',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe',quantity:2}),session=f.sessions.get(order.id);
  const charge={id:'ch_early',object:'charge',payment_intent:session.payment_intent,metadata:{order_id:order.id},
    amount:order.total,amount_refunded:order.total,currency:'eur',livemode:false,refunded:true};
  assert.throws(()=>f.shop.applyStripeRefund(charge));
  assert.equal(f.shop.order(order.id).payment_status,'pending');assert.equal(balance(f),0);
  assert.throws(()=>f.shop.applyStripeRefund(charge,{...session,id:'cs_test_other'}));
  const result=f.shop.applyStripeRefund(charge,session);
  assert.equal(result.status,'refunded');assert.equal(result.payment_status,'refunded');
  assert.equal(result.refunded,order.total);assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(balance(f),0);
  assert.equal(f.shop.ledger().length,0);
  f.shop.applyStripeSession(session);
  assert.equal(f.shop.order(order.id).status,'refunded');assert.deepEqual({...stock(f)},{stock:10,reserved:0});
  assert.equal(f.shop.ledger().length,0);
});

test('el reembolso del saldo restante completa una devolución parcial sin duplicar importes',async t=>{
  const f=fixture(t),{order}=await buy(f,{method:'stripe',quantity:2}),session=f.sessions.get(order.id);
  f.shop.applyStripeSession(session);
  const partial=500,charge={id:'ch_partial',object:'charge',payment_intent:session.payment_intent,metadata:{order_id:order.id},
    amount:order.total,amount_refunded:partial,currency:'eur',livemode:false,refunded:false};
  f.shop.applyStripeRefund(charge);f.shop.applyStripeRefund(charge);
  assert.equal(f.shop.order(order.id).refunded,partial);assert.equal(balance(f),order.total-partial);
  assert.deepEqual({...stock(f)},{stock:8,reserved:0});
  f.stripeProvider.refund=async(paymentIntent,id)=>({id:'re_remainder',object:'refund',payment_intent:paymentIntent,
    currency:'eur',amount:order.total-partial,status:'succeeded'});
  const refunded=await f.shop.refund(f.users.finance,order.id);
  assert.equal(refunded.status,'refunded');assert.equal(refunded.refunded,order.total);assert.equal(balance(f),0);
  assert.deepEqual({...stock(f)},{stock:10,reserved:0});
  f.shop.applyStripeRefund({...charge,amount_refunded:order.total,refunded:true});
  assert.equal(balance(f),0);assert.deepEqual({...stock(f)},{stock:10,reserved:0});assert.equal(f.shop.ledger().length,3);
});
