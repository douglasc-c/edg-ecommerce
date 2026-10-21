import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import jpeg from 'jpeg-js';

const directory=await mkdtemp(join(tmpdir(),'edg-worker-'));
const origin='https://store.example.test',password='Smoke-Test-Password-2026';
let mf;
try{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir',directory],{stdio:'pipe'});
  const options={name:"edg-test",modulesRoot:directory,modules:true,scriptPath:join(directory,'worker.js'),compatibilityDate:'2026-01-01',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,
    durableObjects:{STORE:{className:'CommerceStore',useSQLite:true}},durableObjectsPersist:join(directory,'storage'),
    bindings:{APP_URL:origin,COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:password},
    // This binding intentionally ignores Range, matching the production failure.
    serviceBindings:{ASSETS:async request=>new Response(await readFile(resolve('public',new URL(request.url).pathname==='/'?'index.html':new URL(request.url).pathname.slice(1))),{headers:{ETag:'W/"asset"','Cache-Control':'public, max-age=60'}})}};
  const create=opts=>new Miniflare({...convertV4MiniflareOptions(opts),resourcePersistencePath:join(directory,"storage")});
  mf=create(options);
  for(const path of ['/edg-intro.mp4','/edg-logo-tremor-loop.mp4']){
    const file=await readFile(resolve('public',path.slice(1)));
    let etag;
    for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=1000-1999',1000,1999],[`bytes=${file.length-8}-`,file.length-8,file.length-1],['bytes=-8',file.length-8,file.length-1]]){
      const response=await mf.dispatchFetch(origin+path,{headers:{Range:range}});
      assert.equal(response.status,206,`${path}: ${range}`);
      assert.equal(response.headers.get('content-type'),'video/mp4');
      assert.equal(response.headers.get('accept-ranges'),'bytes');
      assert.equal(response.headers.get('content-length'),String(end-start+1));
      assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${file.length}`);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('cache-control'),'public, max-age=60');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),file.subarray(start,end+1));
      etag=response.headers.get('etag');assert.match(etag,/^"[a-f0-9]{64}"$/);
    }
    const head=await mf.dispatchFetch(origin+path,{method:'HEAD',headers:{Range:'bytes=0-1'}});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(file.length));
    assert.equal((await head.arrayBuffer()).byteLength,0);
    const invalid=await mf.dispatchFetch(origin+path,{headers:{Range:`bytes=${file.length}-`}});
    assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),`bytes */${file.length}`);
    await invalid.arrayBuffer();
    const valid=await mf.dispatchFetch(origin+path,{headers:{Range:'bytes=0-1','If-Range':etag}});
    assert.equal(valid.status,206);assert.deepEqual(Buffer.from(await valid.arrayBuffer()),file.subarray(0,2));
    const stale=await mf.dispatchFetch(origin+path,{headers:{Range:'bytes=0-1','If-Range':'"outdated"'}});
    assert.equal(stale.status,200);assert.deepEqual(Buffer.from(await stale.arrayBuffer()),file);
  }
  let auth={};
  async function call(path,method='GET',body,headers={}){
    const r=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...auth,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await r.json();return {r,data};
  }
  let result=await call('/api/config');assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.mode,'catalog');assert.equal(result.data.currency,'EUR');assert.equal(result.data.language,'es');assert.equal(result.data.locale,'es-ES');assert.equal(result.r.headers.get('content-language'),'es');assert.equal(result.data.checkout_enabled,false);
  assert.equal((await call('/api/admin/products')).r.status,401);
  const login=await call('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.r.status,200,JSON.stringify(login.data));assert.match(login.r.headers.get('set-cookie'),/Secure/);
  auth={Cookie:login.r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
  result=await call('/api/admin/europe-shipping/status');assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal(result.data.provider,'sendcloud');assert.equal(result.data.environment,'test');assert.equal(result.data.configured,false);
  assert.deepEqual(result.data.countries.map(country=>country.code).sort(),['DE','ES','IT','PT']);
  assert.equal((await call('/api/admin/europe-shipping/check','POST')).r.status,503,'La cuenta pendiente no bloquea el catálogo');
  assert.equal((await call('/api/admin/europe-shipping/shipments')).data.length,0);
  assert.equal((await call('/api/admin/products','POST',{} ,{Origin:'https://other.example'})).r.status,403);
  const photo=jpeg.encode({width:2,height:2,data:Buffer.alloc(16,255)},85).data;
  const upload=await mf.dispatchFetch(origin+'/api/admin/media',{method:'POST',headers:{Origin:origin,...auth,'Content-Type':'image/jpeg'},body:photo});const image=await upload.json();assert.equal(upload.status,201,JSON.stringify(image));
  const input={sku:'SMOKE-1',name:'Producto Europa',category:'Prueba',description:'Producto real',price:1999,cost:1000,low_stock:2,weight:.5,width:10,height:10,length:10,color:'#d9e4d5',icon:'◇',images:[image.id]};
  result=await call('/api/admin/products','POST',input);assert.equal(result.r.status,201,JSON.stringify(result.data));const id=result.data.id;
  result=await call('/api/admin/categories','POST',{name:'Prueba',previous:'Prueba',image_id:image.id});assert.equal(result.r.status,201,JSON.stringify(result.data));
  const categories=await mf.dispatchFetch(origin+'/api/categories');assert.equal(categories.status,200);
  assert.deepEqual((await categories.json()).find(category=>category.name==='Prueba'),{name:'Prueba',image:image.url});
  result=await call(`/api/admin/products/${id}/stock`,'POST',{delta:12,reason:'Existencias iniciales'});assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal((await call('/api/products')).data[0].available,12);
  for(const path of ['/api/checkout','/api/shipping/quote',`/api/orders/fake/demo-pay`,`/api/cart/${id}`,'/api/webhooks/mercadopago'])assert.equal((await call(path,path.includes('/cart/')?'PUT':'POST',{})).r.status,503,path);
  assert.equal((await call('/api/admin/orders')).data.length,0);assert.equal((await call('/api/admin/finance')).data.length,0);
  const downloaded=await mf.dispatchFetch(origin+image.url);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/jpeg');assert.ok((await downloaded.arrayBuffer()).byteLength>0);
  await mf.dispose();mf=create({...options,bindings:Object.fromEntries(Object.entries(options.bindings).filter(([key])=>key!=='ADMIN_PASSWORD'))});
  assert.equal((await call('/api/products')).data[0].available,12,'Existencias conservadas tras reiniciar');
  const persistedCategories=await mf.dispatchFetch(origin+'/api/categories');assert.equal(persistedCategories.status,200);
  assert.deepEqual((await persistedCategories.json()).find(category=>category.name==='Prueba'),{name:'Prueba',image:image.url},'Imagen de categoría conservada tras reiniciar');
  assert.equal((await call('/api/admin/products')).r.status,200,'Sesión conservada tras reiniciar');
  result=await call('/api/admin/categories','DELETE',{name:'Prueba'});assert.equal(result.r.status,409,JSON.stringify(result.data));
  result=await call(`/api/admin/products/${id}`,'DELETE');assert.equal(result.r.status,200,JSON.stringify(result.data));
  for(const path of ['/api/products','/api/admin/products']){
    result=await call(path);assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.some(product=>product.id===id),false,path);
  }
  result=await call('/api/admin/categories','DELETE',{name:'Prueba'});assert.equal(result.r.status,200,JSON.stringify(result.data));
  result=await call('/api/categories');assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.some(category=>category.name==='Prueba'),false);
  await mf.dispose();mf=create({...options,bindings:Object.fromEntries(Object.entries(options.bindings).filter(([key])=>key!=='ADMIN_PASSWORD'))});
  for(const path of ['/api/products','/api/admin/products']){
    result=await call(path);assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.some(product=>product.id===id),false,`Producto eliminado no reaparece tras reiniciar: ${path}`);
  }
  result=await call('/api/categories');assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.some(category=>category.name==='Prueba'),false,'Categoría eliminada no reaparece tras reiniciar');
  console.log('Workers: rangos MP4 para Safari, administración, autorización, fotos, categorías, productos, inventario, eliminación, bloqueo de ventas y persistencia verificados.');
}finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
