import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { database } from '../src/db.mjs';
import { createApp, configuration } from '../src/server.mjs';
import { HttpError, hash, now } from '../src/security.mjs';

const base='/api/admin/europe-shipping';
const destination={name:'Cliente de prueba',company_name:'',address:'Calle Prueba',house_number:'10',
  address_2:'',postal_code:'28001',city:'Madrid',country_code:'ES',state_province_code:'ES-M',email:'customer@example.test',telephone:'+34910000000'};
const parcel={weight:1.8,width:25,height:12,length:90};

function fixture(t,environment='test') {
  const db=database(':memory:');t.after(()=>db.close());
  const config=configuration({APP_URL:'https://store.example.test',COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR',
    SENDCLOUD_ENVIRONMENT:environment,SENDCLOUD_PUBLIC_KEY:'fixture-public',SENDCLOUD_SECRET_KEY:'fixture-private',
    SENDCLOUD_WEBHOOK_SECRET:'fixture-webhook',SENDCLOUD_SENDER_ADDRESS_ID:'1'});
  const users={};
  for(const role of ['admin','shipping','inventory','finance','support','customer']) {
    const id=randomUUID(),raw=randomUUID(),csrf=randomUUID();
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(id,role,`${role}@example.test`,'unused',role,now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw),id,csrf,new Date(Date.now()+60000).toISOString());
    users[role]={cookie:`edg_session=${raw}`,'x-csrf-token':csrf};
  }
  const counts={quoted:0,created:0,labels:0,retrieved:0};
  const sender={id:1,name:'EDG Prueba',company_name:'EDG',address:'Calle Prueba',house_number:'1',
    address_2:'',postal_code:'08001',city:'Barcelona',country_code:'ES',email:'sender@example.test',telephone:'+34000000000'};
  const provider={
    async sender(){return sender;},
    async quote(){counts.quoted++;return [{id:'eu-standard',name:'Estándar',carrier:'Prueba',price:1890,currency:'EUR',
      days:4,shipping_option_code:'fixture:standard',contract_id:1}];},
    async create(){counts.created++;return {shipment_id:'shipment-fixture',parcel_id:'parcel-fixture',
      tracking_code:'TRACK-TEST',tracking_url:'https://example.test/track',status:'label_created',occurred_at:now()};},
    async retrieve(){counts.retrieved++;return {shipment_id:'shipment-fixture',parcel_id:'parcel-fixture',
      tracking_code:'TRACK-TEST',tracking_url:'https://example.test/track',status:'in_transit',occurred_at:now()};},
    async lookup(){return null;},
    async label(){counts.labels++;return Buffer.from('%PDF-1.4\nfixture');},
    verifyWebhook(headers,raw){
      const expected=createHmac('sha256',config.sendcloud.webhookSecret).update(raw).digest('hex');
      if(headers['sendcloud-signature']!==expected)throw new HttpError(401,'Firma Sendcloud no válida.');
      return JSON.parse(raw.toString());
    }
  };
  const app=createApp({db,config,europeProvider:provider,runtime:'worker'});
  async function call(path,{method='GET',body,headers={},raw}={}) {
    const bytes=raw??(body===undefined?null:Buffer.from(JSON.stringify(body)));
    const req=Readable.from(bytes?[bytes]:[]);
    Object.assign(req,{url:path,method,socket:{remoteAddress:'127.0.0.1'},
      headers:{origin:config.url,'content-type':'application/json',...headers}});
    const result={status:200,headers:{},bytes:Buffer.alloc(0)};
    const response={headersSent:false,
      setHeader(key,value){result.headers[key.toLowerCase()]=value;},
      writeHead(status,values){result.status=status;for(const [key,value] of Object.entries(values))this.setHeader(key,value);this.headersSent=true;},
      end(value){result.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}
    };
    await app.handler(req,response);
    if(result.headers['content-type']?.startsWith('application/json'))result.data=JSON.parse(result.bytes.toString());
    return result;
  }
  return {db,config,users,provider,counts,call,app};
}

test('HTTP europeo: catálogo EUR mantiene el checkout cerrado y publica solo configuración no secreta',async t=>{
  const f=fixture(t),result=await f.call('/api/config');
  assert.equal(result.status,200);assert.equal(result.data.shipping_provider,'sendcloud');
  assert.equal(result.data.shipping,'Sendcloud');assert.equal(result.data.checkout_enabled,false);
  assert.equal((await f.call('/api/checkout',{method:'POST',body:{}})).status,503);
  const status=await f.call(base+'/status',{headers:f.users.admin});
  assert.equal(status.status,200);assert.equal(status.data.environment,'test');
  assert.deepEqual(status.data.countries.map(c=>c.code),['ES']);
  assert.ok(!JSON.stringify([result.data,status.data]).includes('fixture-private'));
  assert.ok(!JSON.stringify([result.data,status.data]).includes('fixture-webhook'));
});

test('HTTP europeo: solo cotiza Península y Baleares y rechaza rutas internacionales antes del proveedor',async t=>{
  const f=fixture(t),headers=f.users.shipping;
  for(const change of [{country_code:'DE',postal_code:'10115'},{country_code:'IT',postal_code:'20121',state_province_code:'IT-MI'},{country_code:'PT',postal_code:'1234-567'},...['35001','38001','51001','52001'].map(postal_code=>({postal_code}))]) {
    const result=await f.call(base+'/quote',{method:'POST',headers,body:{destination:{...destination,...change},parcel}});
    assert.equal(result.status,400,JSON.stringify(result.data));
  }
  assert.equal(f.counts.quoted,0);
  const result=await f.call(base+'/quote',{method:'POST',headers,body:{destination:{...destination,postal_code:'07001',city:'Palma',state_province_code:'ES-PM'},parcel}});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(f.counts.quoted,1);
  assert.equal(result.data.destination.country_code,'ES');assert.equal(result.data.destination.postal_code,'07001');
});

test('HTTP europeo: sesión, permiso de expedición, origen y CSRF protegen todos los envíos',async t=>{
  const f=fixture(t);
  assert.equal((await f.call(base+'/status')).status,401);
  for(const role of ['inventory','finance','support','customer']) {
    for(const path of ['/status','/shipments','/shipments/unknown/label']) {
      assert.equal((await f.call(base+path,{headers:f.users[role]})).status,403);
    }
    assert.equal((await f.call(base+'/quote',{method:'POST',body:{destination,parcel},headers:f.users[role]})).status,403);
  }
  for(const headers of [{cookie:f.users.admin.cookie},{...f.users.admin,origin:'https://other.example.test'}]) {
    assert.equal((await f.call(base+'/quote',{method:'POST',body:{destination,parcel},headers})).status,403);
  }
  const check=await f.call(base+'/check',{method:'POST',headers:f.users.shipping});assert.equal(check.status,200);
});

test('HTTP europeo: devuelve el diagnóstico de la tarifa solo a usuarios autorizados y sin guardar envíos',async t=>{
  const f=fixture(t),provider={name:'sendcloud',operation:'quote',status:400,errors:[{code:'invalid',field:'contract_id',detail:'Invalid contract.'}]};
  f.provider.quote=async()=>{throw Object.assign(new HttpError(422,'No se han podido consultar las tarifas en Sendcloud (HTTP 400). Invalid contract.'),{provider});};
  for(const headers of [{},f.users.customer]){
    const denied=await f.call(base+'/quote',{method:'POST',headers,body:{destination,parcel}});
    assert.ok([401,403].includes(denied.status));assert.equal(denied.data.provider,undefined);
  }
  const result=await f.call(base+'/quote',{method:'POST',headers:f.users.shipping,body:{destination,parcel}});
  assert.equal(result.status,422);assert.deepEqual(result.data.provider,provider);
  assert.equal(result.headers['cache-control'],'no-store');assert.match(result.data.error,/Invalid contract/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_quotes').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM europe_shipments').get().n,0);assert.equal(f.counts.created,0);
});

test('HTTP europeo: simular no compra etiquetas, no descarga PDF y conserva existencias y saldo',async t=>{
  const f=fixture(t),headers={...f.users.shipping,'idempotency-key':randomUUID()};
  const quote=await f.call(base+'/quote',{method:'POST',headers,body:{destination,parcel}});
  assert.equal(quote.status,200,JSON.stringify(quote.data));
  const body={quote_id:quote.data.id,service_id:quote.data.options[0].id,order_reference:'PRUEBA-1'};
  const first=await f.call(base+'/shipments',{method:'POST',headers,body});assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(first.data.status,'simulated');assert.equal(f.counts.created,0);
  const duplicate=await f.call(base+'/shipments',{method:'POST',headers,body});
  assert.equal(duplicate.data.id,first.data.id);
  const listing=await f.call(base+'/shipments',{headers});assert.equal(listing.data.length,1);
  assert.equal((await f.call(`${base}/shipments/${first.data.id}/label`,{headers})).status,409);
  assert.equal(f.counts.labels,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM movements').get().n,0);
});

test('HTTP europeo: contratar exige confirmación, evita duplicados y sirve PDF solo a expedición',async t=>{
  const f=fixture(t,'live'),headers={...f.users.admin,'idempotency-key':randomUUID()};
  const quote=await f.call(base+'/quote',{method:'POST',headers,body:{destination,parcel}});
  assert.equal(quote.status,200,JSON.stringify(quote.data));
  const body={quote_id:quote.data.id,service_id:quote.data.options[0].id,order_reference:'MANUAL-1'};
  assert.equal((await f.call(base+'/shipments',{method:'POST',headers,body})).status,409);
  const created=await f.call(base+'/shipments',{method:'POST',headers,body:{...body,confirm_live:true}});
  assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(f.counts.created,1);
  const duplicate=await f.call(base+'/shipments',{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:{...body,confirm_live:true}});
  assert.equal(duplicate.data.id,created.data.id);assert.equal(f.counts.created,1);
  const download=await f.call(`${base}/shipments/${created.data.id}/label`,{headers:f.users.shipping});
  assert.equal(download.status,200);assert.equal(download.headers['content-type'],'application/pdf');
  assert.match(download.bytes.toString(),/^%PDF/);assert.equal(f.counts.labels,1);
  const sync=await f.call(`${base}/shipments/${created.data.id}/sync`,{method:'POST',headers:f.users.shipping});
  assert.equal(sync.status,200);assert.equal(sync.data.status,'in_transit');
});

test('HTTP europeo: webhook sigue autenticado en catálogo y no acepta firmas falsas',async t=>{
  const f=fixture(t,'live');
  const rejected=await f.call('/api/webhooks/sendcloud',{method:'POST',headers:{origin:'https://sendcloud.example','sendcloud-signature':'invalid'},body:{action:'parcel_status_changed',parcel:{id:'unknown'}}});
  assert.equal(rejected.status,401);
});
