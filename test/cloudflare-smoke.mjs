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
  const skateAsset=await mf.dispatchFetch(origin+'/skate.js');
  assert.equal(skateAsset.status,200);
  assert.match(skateAsset.headers.get('content-security-policy'),/frame-src https:\/\/www\.youtube-nocookie\.com;/);
  assert.match(skateAsset.headers.get('content-security-policy'),/img-src 'self' data: https:\/\/i\.ytimg\.com;/);
  assert.equal(skateAsset.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(await skateAsset.text(),/function skatePage/);
  const musicAsset=await mf.dispatchFetch(origin+'/music.js');
  assert.equal(musicAsset.status,200);
  assert.match(await musicAsset.text(),/function musicPage/);
  for(const file of ['i18n.js','i18n-common.js','i18n-editorial.js']){
    const response=await mf.dispatchFetch(`${origin}/${file}`);
    assert.equal(response.status,200,file);
    assert.equal(await response.text(),await readFile(resolve('public',file),'utf8'));
  }
  for(const name of ['banda-hero','banda-hero-640','banda-live','rap-subterraneo','sobrenatural','mensageiro-do-corre','a-parada-e-o-movimento','achados-no-mundo-perdido','pratas-da-casa','aperta-o-play']){
    const response=await mf.dispatchFetch(origin+`/music/${name}.webp`);
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(resolve('public/music',`${name}.webp`)));
  }
  for(const path of ['/edg-intro.mp4','/edg-intro-mobile.mp4','/edg-logo-tremor-loop.mp4']){
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
    // Miniflare's fallback country is US; null represents an edge request without a known country.
    const r=await mf.dispatchFetch(origin+path,{cf:{country:null},method,headers:{Origin:origin,'Content-Type':'application/json',...auth,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await r.json();return {r,data};
  }
  let result=await call('/api/config');assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.mode,'catalog');assert.equal(result.data.currency,'EUR');assert.equal(result.data.language,'es');assert.equal(result.data.locale,'es-ES');assert.equal(result.r.headers.get('content-language'),'es');assert.equal(result.data.checkout_enabled,false);
  assert.equal(result.data.suggested_language,'es');assert.equal(result.data.language_source,'default');assert.equal(result.data.country,null);
  for(const [cf,headers,language,source,country] of [
    [{country:'BR'},{'X-EDG-Country':'ES','CF-IPCountry':'ES','Accept-Language':'es-ES'},'pt-BR','country','BR'],
    [{country:'ES'},{'X-EDG-Country':'BR','Accept-Language':'pt-BR'},'es','country','ES'],
    [{country:'GB'},{'Accept-Language':'es-ES'},'en','country','GB'],
    [{country:'PT'},{'Accept-Language':'en-GB'},'pt-BR','country','PT'],
    [{country:'XX'},{'X-EDG-Country':'BR','CF-IPCountry':'BR','Accept-Language':'en;q=0.4,pt-BR;q=0.9'},'pt-BR','accept-language',null],
    [{country:'T1'},{'X-EDG-Country':'ES','Accept-Language':'en-GB'},'en','accept-language',null],
    [{country:null},{'X-EDG-Country':'BR','CF-IPCountry':'BR','Accept-Language':'en-GB'},'en','accept-language',null],
    [{country:null},{'X-EDG-Country':'BR','CF-IPCountry':'BR'},'es','default',null]
  ]){
    const response=await mf.dispatchFetch(origin+'/api/config',{cf,headers}),data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual({language:data.suggested_language,source:data.language_source,country:data.country},{language,source,country});
    assert.equal(data.currency,'EUR');assert.equal(data.checkout_enabled,false);assert.equal(data.shipping_provider,'sendcloud');
  }
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
  const input={sku:'SMOKE-1',name:'Producto Europa',category:'Prueba',sizes:['A5','A4'],description:'Producto real',price:1999,cost:1000,low_stock:2,weight:.5,width:10,height:10,length:10,color:'#d9e4d5',icon:'◇',images:[image.id]};
  result=await call('/api/admin/products','POST',input);assert.equal(result.r.status,201,JSON.stringify(result.data));const id=result.data.id;
  assert.deepEqual(result.data.sizes,['A5','A4']);assert.equal(result.data.size,'A5');
  result=await call('/api/admin/categories','POST',{name:'Prueba',previous:'Prueba',image_id:image.id});assert.equal(result.r.status,201,JSON.stringify(result.data));
  const categories=await mf.dispatchFetch(origin+'/api/categories');assert.equal(categories.status,200);
  assert.deepEqual((await categories.json()).find(category=>category.name==='Prueba'),{name:'Prueba',image:image.url});
  result=await call(`/api/admin/products/${id}/stock`,'POST',{delta:12,reason:'Existencias iniciales'});assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal((await call('/api/products')).data[0].available,12);
  const variantInput={...input,variants:[
    {color_name:'Negro',color_hex:'#111111',size:'A5',stock:8,image_ids:[image.id]},
    {color_name:'Blanco',color_hex:'#ffffff',size:'A4',stock:4,price_override:2499,image_ids:[]}
  ]};
  result=await call(`/api/admin/products/${id}`,'PUT',{...variantInput,variants:variantInput.variants.map((variant,index)=>({...variant,stock:index?3:8}))});
  assert.equal(result.r.status,409,'Una distribución incompleta no modifica las existencias');
  const beforeMigration=(await call('/api/admin/products')).data.find(product=>product.id===id);
  assert.equal(beforeMigration.stock,12);assert.equal(beforeMigration.variants_enabled,false);assert.deepEqual(beforeMigration.variants,[]);
  result=await call(`/api/admin/products/${id}`,'PUT',variantInput);assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal(result.data.variants_enabled,true);assert.equal(result.data.stock,12);assert.equal(result.data.available,12);assert.equal(result.data.unallocated_stock,0);
  assert.equal(result.data.variants.length,2);
  const black=result.data.variants.find(variant=>variant.color_name==='Negro'),white=result.data.variants.find(variant=>variant.color_name==='Blanco');
  assert.notEqual(black.id,white.id);assert.notEqual(black.sku,white.sku);
  assert.equal(black.stock,8);assert.equal(white.stock,4);assert.equal(black.price,1999);assert.equal(white.price,2499);
  assert.deepEqual(black.image_ids,[image.id]);assert.deepEqual(black.images,[image.url]);
  const stockPath=`/api/admin/products/${id}/variants/${black.id}/stock`;
  assert.equal((await call(stockPath,'POST',{delta:1,reason:'Sin sesión'},{Cookie:'','X-CSRF-Token':''})).r.status,401);
  assert.equal((await call(stockPath,'POST',{delta:1,reason:'Sin CSRF'},{'X-CSRF-Token':''})).r.status,403);
  assert.equal((await call(stockPath,'POST',{delta:1,reason:'Origen externo'},{Origin:'https://other.example'})).r.status,403);
  assert.equal((await call(`/api/admin/products/${id}/stock`,'POST',{delta:1,reason:'Saldo sin combinación'})).r.status,409);
  assert.equal((await call(`/api/admin/products/${id}/variants/allocate`,'POST',{allocations:[{variant_id:black.id,quantity:1}],reason:'Saldo inexistente'})).r.status,409);
  result=await call(stockPath,'POST',{delta:-1,reason:'Corrección Negro A5'});assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal(result.data.stock,11);assert.equal(result.data.variants.find(variant=>variant.id===black.id).stock,7);
  assert.equal(result.data.variants.find(variant=>variant.id===white.id).stock,4,'El ajuste no consume otra combinación');
  const variantMovement=(await call('/api/admin/movements')).data.find(movement=>movement.reason==='Corrección Negro A5');
  assert.equal(variantMovement.variant_id,black.id);assert.equal(variantMovement.selected_color,'Negro');assert.equal(variantMovement.selected_size,'A5');
  for(const path of ['/api/checkout','/api/shipping/quote',`/api/orders/fake/demo-pay`,`/api/cart/${id}`,'/api/webhooks/mercadopago'])assert.equal((await call(path,path.includes('/cart/')?'PUT':'POST',{})).r.status,503,path);
  assert.equal((await call('/api/admin/orders')).data.length,0);assert.equal((await call('/api/admin/finance')).data.length,0);
  const downloaded=await mf.dispatchFetch(origin+image.url);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/jpeg');assert.ok((await downloaded.arrayBuffer()).byteLength>0);
  await mf.dispose();mf=create({...options,bindings:Object.fromEntries(Object.entries(options.bindings).filter(([key])=>key!=='ADMIN_PASSWORD'))});
  assert.equal((await call('/api/products')).data[0].available,11,'Existencias conservadas tras reiniciar');
  for(const path of ['/api/products','/api/admin/products']){
    const product=(await call(path)).data.find(product=>product.id===id);
    assert.deepEqual(product.sizes,['A5','A4'],`Tallas conservadas tras reiniciar: ${path}`);
    assert.equal(product.variants_enabled,true);assert.equal(product.stock,11);assert.equal(product.unallocated_stock,0);
    assert.equal(product.variants.find(variant=>variant.id===black.id).available,7);
    assert.equal(product.variants.find(variant=>variant.id===white.id).available,4);
    assert.deepEqual(product.variants.find(variant=>variant.id===black.id).images,[image.url]);
    assert.equal(product.variants.find(variant=>variant.id===white.id).price,2499);
  }
  assert.equal((await call('/api/admin/movements')).data.filter(movement=>movement.reason==='Corrección Negro A5').length,1,'Reiniciar no repite el ajuste');
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
  console.log('Workers: idioma, rangos MP4, administración, autorización, fotos, categorías, migración conservativa, variantes de color y talla, inventario independiente, eliminación, bloqueo de ventas y persistencia verificados.');
}finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
