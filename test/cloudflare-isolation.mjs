import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

const directory=await mkdtemp(join(tmpdir(),'edg-payment-isolation-'));
const origin='https://store.example.test',password='Isolation-Test-Password-2026';
const bindings={APP_URL:origin,COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR',
  ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:password,BANK_TRANSFER_IBAN:'ES9121000418450200051332'};
let mf,blockedOutboundRequests=0;
try{
  // Compilación exclusivamente local: no ejecuta herramientas de despliegue,
  // telemetría, instalaciones de paquetes ni servicios externos.
  await build({entryPoints:[resolve('cloudflare/worker.mjs')],outfile:join(directory,'worker.js'),
    bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','browser'],
    external:['node:*','cloudflare:workers'],logLevel:'silent',
    plugins:[{name:'local-cloudflare-adapters',setup(bundler){
      bundler.onResolve({filter:/(?:^|\/)db\.mjs$/},()=>({path:resolve('cloudflare/database.mjs')}));
      bundler.onResolve({filter:/(?:^|\/)image-processor\.mjs$/},()=>({path:resolve('cloudflare/image-processor.mjs')}));
    }}]});
  const options={name:'edg-payment-isolation',modulesRoot:directory,modules:true,scriptPath:join(directory,'worker.js'),
    compatibilityDate:'2026-01-01',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,
    durableObjects:{STORE:{className:'CommerceStore',useSQLite:true}},durableObjectsPersist:join(directory,'storage'),
    serviceBindings:{ASSETS:async()=>new Response('fixture')},
    outboundService:async()=>{blockedOutboundRequests++;return new Response('External network disabled in isolation test',{status:503});}};
  const create=values=>new Miniflare({...convertV4MiniflareOptions({...options,bindings:{...bindings,...values}}),resourcePersistencePath:join(directory,'storage')});
  async function call(path,{method='GET',body,auth={}}={}){
    const response=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...auth},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.ok(response.ok,`${response.status}: ${JSON.stringify(data)}`);return {response,data};
  }
  async function login(){
    const result=await call('/api/auth/login',{method:'POST',body:{email:bindings.ADMIN_EMAIL,password}});
    return {id:result.data.user.id,headers:{Cookie:result.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':result.data.csrf}};
  }
  async function category(name,auth){await call('/api/admin/categories',{method:'POST',body:{name},auth});}
  async function names(){return (await call('/api/categories')).data.map(row=>row.name);}

  mf=create({EUROPE_CHECKOUT_ENABLED:'false'});
  const real=await login();await category('Solo producción',real.headers);
  assert.equal((await call('/api/config')).data.checkout_enabled,false);
  await mf.dispose();

  mf=create({EUROPE_CHECKOUT_ENABLED:'true',PAYMENT_ENVIRONMENT:'test'});
  const sandbox=await login();assert.notEqual(sandbox.id,real.id,'Las pruebas tienen su propia cuenta administrativa');
  assert.ok(!(await names()).includes('Solo producción'),'Las pruebas no leen el catálogo real');
  await category('Solo pruebas',sandbox.headers);
  const config=(await call('/api/config')).data;assert.equal(config.checkout_enabled,true);assert.equal(config.payment_environment,'test');
  const worker=await mf.getWorker();await worker.scheduled({cron:'*/5 * * * *'});
  await mf.dispose();

  mf=create({EUROPE_CHECKOUT_ENABLED:'true',PAYMENT_ENVIRONMENT:'live'});
  assert.equal((await login()).id,real.id,'La activación real recupera la base original');
  assert.ok((await names()).includes('Solo producción'));assert.ok(!(await names()).includes('Solo pruebas'));
  await mf.dispose();

  mf=create({EUROPE_CHECKOUT_ENABLED:'true',PAYMENT_ENVIRONMENT:'test'});
  assert.equal((await login()).id,sandbox.id,'Los datos de prueba persisten en su propia base');
  assert.ok((await names()).includes('Solo pruebas'));assert.ok(!(await names()).includes('Solo producción'));
  assert.equal(blockedOutboundRequests,0,'El test no solicita conexiones externas');
  console.log('Workers offline: catálogo, usuarios y persistencia del checkout de pruebas aislados; vuelta a producción conserva la base original; cron ejecutado; cero solicitudes externas.');
}finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
