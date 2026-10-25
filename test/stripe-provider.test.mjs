import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { stripeProvider } from '../src/stripe.mjs';

const config={url:'https://store.example.test',stripe:{environment:'test',secretKey:'sk_test_fixture',webhookSecret:'whsec_fixture'}};
const order={id:'order-123',number:1001,total:1099,subtotal:1200,discount:201,shipping:100,currency:'EUR',reserved_until:new Date(Date.now()+3600000).toISOString()};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const session=(overrides={})=>({id:'cs_test_fixture',object:'checkout.session',livemode:false,currency:'eur',amount_total:1099,client_reference_id:order.id,metadata:{order_id:order.id},payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/cs_test_fixture',...overrides});
const event=(overrides={})=>({id:'evt_fixture',type:'checkout.session.completed',livemode:false,data:{object:session({payment_status:'paid',payment_intent:'pi_fixture'})},...overrides});
function signed(value,{timestamp=Math.floor(Date.now()/1000),secret=config.stripe.webhookSecret}={}){
  const raw=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
  return {raw,signature:`t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.`).update(raw).digest('hex')}`};
}

test('crea Checkout EUR con total del servidor, referencia, reserva e idempotencia',async()=>{
  const calls=[];
  const api=stripeProvider(config,async(url,init)=>{calls.push({url,init});return json(session());});
  const result=await api.preference(order,[{price:1,quantity:1}],{email:'buyer@example.test'});
  assert.deepEqual(result,{id:'cs_test_fixture',url:session().url});
  const {url,init}=calls[0],body=new URLSearchParams(init.body);
  assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');
  assert.equal(init.headers.Authorization,'Bearer sk_test_fixture');assert.equal(init.headers['Idempotency-Key'],'preference-order-123');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'),'1099');assert.equal(body.get('line_items[0][price_data][currency]'),'eur');
  assert.equal(body.get('line_items[0][quantity]'),'1');assert.equal(body.get('allowed_payment_method_types[0]'),'card');
  assert.equal(body.get('client_reference_id'),order.id);assert.equal(body.get('metadata[order_id]'),order.id);assert.equal(body.get('payment_intent_data[metadata][order_id]'),order.id);
  assert.equal(body.get('customer_email'),'buyer@example.test');assert.equal(body.get('expires_at'),String(Math.floor(Date.parse(order.reserved_until)/1000)));
  assert.equal(body.get('success_url'),'https://store.example.test/?payment=success#orders');
});

test('crea Checkout con el contrato Endive, que rechaza payment_method_types',async()=>{
  const api=stripeProvider(config,async(url,init)=>{
    const body=new URLSearchParams(init.body);
    if([...body.keys()].some(key=>/^payment_method_types(?:\[|$)/.test(key)))return json({error:{type:'invalid_request_error',code:'parameter_unknown',param:'payment_method_types'}},400);
    if(body.get('allowed_payment_method_types[0]')!=='card')return json({error:{type:'invalid_request_error',code:'parameter_missing',param:'allowed_payment_method_types'}},400);
    return json(session());
  });
  assert.equal((await api.preference(order,[],{})).id,'cs_test_fixture');
});

test('rechaza importe, moneda, reserva y claves de otro entorno antes de acceder a Stripe',async()=>{
  const api=stripeProvider(config,()=>assert.fail('No debe llamar a la red.'));
  for(const change of [{total:0},{total:10.5},{currency:'BRL'},{reserved_until:new Date(Date.now()-60000).toISOString()},{reserved_until:new Date(Date.now()+90000000).toISOString()}])await assert.rejects(api.preference({...order,...change},[],{}));
  for(const secretKey of [undefined,'sk_live_fixture','pk_test_fixture'])await assert.rejects(stripeProvider({...config,stripe:{...config.stripe,secretKey}},()=>assert.fail('No debe llamar a la red.')).retrieveSession('cs_test_fixture'),{status:503});
});

test('solo una validación rechazada de expires_at permite renovar la solicitud de Checkout',async t=>{
  t.mock.method(console,'error',()=>{});
  for(const [status,type,param,renew] of [[400,'invalid_request_error','expires_at',true],
    [500,'invalid_request_error','expires_at',false],[400,'authentication_error','expires_at',false],
    [400,'invalid_request_error','customer_email',false],[409,'idempotency_error','expires_at',false]]){
    let calls=0;
    const api=stripeProvider(config,async()=>{calls++;return json({error:{type,param}},status);});
    await assert.rejects(api.preference(order,[],{}),error=>Boolean(error.checkoutReservationRejected)===renew);
    assert.equal(calls,1);
  }
});

test('solo devuelve páginas alojadas por Stripe y sesiones que coincidan con el pedido',async()=>{
  for(const change of [{url:'https://other.example.test/pay'},{url:'http://checkout.stripe.com/pay'},{url:'https://user:pass@checkout.stripe.com/pay'},{amount_total:1100},{currency:'usd'},{livemode:true},{client_reference_id:'another-order'},{metadata:{order_id:'another-order'}}]){
    await assert.rejects(stripeProvider(config,async()=>json(session(change))).preference(order,[],{}));
  }
});

test('consulta una sesión por ruta fija y rechaza identificadores o respuestas diferentes',async()=>{
  let calls=0;
  const api=stripeProvider(config,async(url,init)=>{calls++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions/cs_test_fixture');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');return json(session());});
  assert.equal((await api.retrieveSession('cs_test_fixture')).id,'cs_test_fixture');
  for(const id of ['../secrets','https://example.test','cs_test_fixture?expand[]=secret'])await assert.rejects(api.retrieveSession(id),{status:400});
  assert.equal(calls,1);
  await assert.rejects(stripeProvider(config,async()=>json(session({id:'cs_test_other'}))).retrieveSession('cs_test_fixture'),{status:409});
  for(const change of [{metadata:{}},{payment_status:'paid',payment_intent:null},{payment_intent:'pi_fixture/path'},{payment_status:'unknown'}])await assert.rejects(stripeProvider(config,async()=>json(session(change))).retrieveSession('cs_test_fixture'));
});

test('bloquea redirecciones y errores remotos sin divulgar cuerpos o credenciales',async t=>{
  t.mock.method(console,'error',()=>{});
  for(const response of [new Response(null,{status:307,headers:{Location:'https://other.example.test/private'}}),json({error:{message:'private sk_test_fixture'}},400),new Response('private invalid JSON',{status:200})]){
    await assert.rejects(stripeProvider(config,async()=>response).retrieveSession('cs_test_fixture'),error=>error.status===502 && !error.message.includes('private') && !error.message.includes('sk_test_fixture'));
  }
  await assert.rejects(stripeProvider(config,async()=>{throw Error('private transport');}).preference(order,[],{}),error=>error.status===502&&error.uncertain===true&&!error.message.includes('private'));
});

test('registra el rechazo Stripe con parámetro y referencia seguros, sin exponer el mensaje remoto',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const response=new Response(JSON.stringify({error:{type:'invalid_request_error',code:'parameter_unknown',param:'integration_identifier',
    message:'private sk_test_fixture buyer@example.test',request_log_url:'https://example.test/private'}}),
    {status:400,headers:{'content-type':'application/json','request-id':'req_fixture'}});
  await assert.rejects(stripeProvider(config,async()=>response).preference(order,[],{email:'buyer@example.test'}),error=>{
    assert.equal(error.status,502);assert.equal(error.uncertain,false);assert.match(error.message,/req_fixture/);
    assert.ok(!error.message.includes('private'));assert.ok(!error.message.includes('buyer@example.test'));assert.ok(!error.message.includes('sk_test_fixture'));
    return true;
  });
  assert.deepEqual(logs,[['Stripe request rejected:',{status:400,type:'invalid_request_error',code:'parameter_unknown',param:'integration_identifier',request_id:'req_fixture'}]]);
});

test('omite diagnósticos no fiables y conserva la incertidumbre de escrituras sin reintentar',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  for(const status of [400,401,403,429,500]){
    let calls=0;
    const data={error:{type:'private',code:'sk_test_fixture',param:'private buyer@example.test',message:'private sk_test_fixture'}};
    await assert.rejects(stripeProvider(config,async()=>{calls++;return new Response(JSON.stringify(data),{status,headers:{'request-id':'req_private?secret=sk_test_fixture'}});}).preference(order,[],{}),error=>{
      assert.equal(error.uncertain,status>=500);assert.equal(error.status,502);assert.ok(!error.message.includes('private'));assert.ok(!error.message.includes('sk_test_fixture'));return true;
    });
    assert.equal(calls,1);assert.deepEqual(logs.at(-1),['Stripe request rejected:',{status}]);
  }
  await assert.rejects(stripeProvider(config,async()=>new Response('private sk_test_fixture',{status:502})).preference(order,[],{}),error=>error.uncertain===true);
  assert.deepEqual(logs.at(-1),['Stripe request rejected:',{status:502}]);
});

test('distingue timeout y fallo de red sin registrar excepciones ni repetir la creación',async t=>{
  const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  for(const name of ['TimeoutError','AbortError','Error']){
    let calls=0;
    await assert.rejects(stripeProvider(config,async()=>{calls++;throw Object.assign(new Error('private sk_test_fixture'),{name});}).preference(order,[],{}),error=>error.status===502&&error.uncertain===true&&!error.message.includes('private'));
    assert.equal(calls,1);
    assert.deepEqual(logs.at(-1),['Stripe request failed:',{kind:name==='Error'?'network_error':'timeout',method:'POST'}]);
  }
});

test('verifica Stripe-Signature sobre bytes originales y acepta varias firmas v1',()=>{
  const api=stripeProvider(config),value=event(),{raw,signature}=signed(value);
  assert.deepEqual(api.verifyWebhook(new Headers({'Stripe-Signature':signature}),raw),value);
  const multiple=signature.replace(',v1=',`,v1=${'0'.repeat(64)},v1=`);
  assert.deepEqual(api.verifyWebhook({'Stripe-Signature':multiple},new Uint8Array(raw)),value);
  assert.throws(()=>api.verifyWebhook({'stripe-signature':signature},Buffer.from(JSON.stringify(value,null,2))),{status:401});
  assert.throws(()=>api.verifyWebhook({'stripe-signature':signature},raw.toString()),{status:400});
});

test('rechaza firma ausente, falsa, caducada, futura o timestamp ambiguo',()=>{
  const api=stripeProvider(config),value=event(),{raw,signature}=signed(value),time=Math.floor(Date.now()/1000);
  for(const headers of [{},{'stripe-signature':`t=${time},v1=${'0'.repeat(64)}`},{'stripe-signature':`${signature},t=${time}`}])assert.throws(()=>api.verifyWebhook(headers,raw),{status:401});
  for(const timestamp of [time-301,time+301]){const s=signed(value,{timestamp});assert.throws(()=>api.verifyWebhook({'stripe-signature':s.signature},s.raw),{status:401});}
});

test('rechaza eventos de otro entorno y JSON o estructura no válidos aun con firma correcta',()=>{
  const api=stripeProvider(config);
  for(const [value,status] of [[event({livemode:true}),409],['invalid JSON',400],[{id:'evt_fixture',type:'checkout.session.completed',livemode:false},400]]){
    const s=signed(value);assert.throws(()=>api.verifyWebhook({'stripe-signature':s.signature},s.raw),{status});
  }
  assert.throws(()=>stripeProvider({...config,stripe:{...config.stripe,webhookSecret:undefined}}).verifyWebhook({},Buffer.from('{}')),{status:503});
});

test('solicita un único reembolso completo por PaymentIntent con idempotencia y valida su respuesta',async()=>{
  let calls=0;
  const refund={id:'re_fixture',object:'refund',payment_intent:'pi_fixture',currency:'eur',amount:1099,status:'succeeded'};
  const api=stripeProvider(config,async(url,init)=>{calls++;assert.equal(url,'https://api.stripe.com/v1/refunds');assert.equal(init.method,'POST');assert.equal(init.headers['Idempotency-Key'],'full-refund-order-123');assert.equal(new URLSearchParams(init.body).get('payment_intent'),'pi_fixture');return json(refund);});
  assert.deepEqual(await api.refund('pi_fixture',order.id),refund);
  await assert.rejects(api.refund('pi_fixture/../../',order.id),{status:400});assert.equal(calls,1);
  await assert.rejects(stripeProvider(config,async()=>json({...refund,payment_intent:'pi_other'})).refund('pi_fixture',order.id),{status:502});
});
