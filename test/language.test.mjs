import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from '../src/db.mjs';
import { configuration,createApp } from '../src/server.mjs';
import { normalizeCountry,suggestLanguage } from '../src/language.mjs';

const config=configuration({APP_URL:'http://localhost:3000',COMMERCE_MODE:'catalog',STORE_CURRENCY:'EUR'});

function workerFixture(t) {
  const db=database(':memory:');t.after(()=>db.close());
  const app=createApp({db,config,runtime:'worker'});
  return async(country,headers={})=>{
    let status,content;const responseHeaders=new Headers();
    await app.handler({url:'/api/config',method:'GET',country,headers,socket:{remoteAddress:'test'}},{
      headersSent:false,setHeader(name,value){responseHeaders.set(name,value);},
      writeHead(code,values){status=code;for(const [name,value] of Object.entries(values))responseHeaders.set(name,value);this.headersSent=true;},
      end(value){content=value;}
    });
    return {status,headers:responseHeaders,data:JSON.parse(content)};
  };
}

test('el país sugiere español, portugués brasileño o inglés sin cambiar la región comercial',()=>{
  for(const [country,language] of [['ES','es'],['MX','es'],['AR','es'],['GQ','es'],['BR','pt-BR'],['PT','pt-BR'],['AO','pt-BR'],['MZ','pt-BR'],['GB','en'],['US','en'],['DE','en'],['JP','en']]) {
    assert.deepEqual(suggestLanguage({country,acceptLanguage:'es-ES'}),{suggested_language:language,language_source:'country',country});
  }
  assert.equal(normalizeCountry(' br '),'BR');
  for(const country of [undefined,null,123,'','XX','T1','ZZ','ES,BR','GBR'])assert.equal(normalizeCountry(country),null);
});

test('Accept-Language respeta prioridades, regiones y el orden de las preferencias empatadas',()=>{
  for(const [header,language] of [
    ['es-ES;q=0.4,en-GB;q=0.9,pt-BR;q=0.8','en'],
    ['fr-FR,pt-PT;q=0.8,en;q=0.5','pt-BR'],
    ['EN-us;q=0.7,es-MX;q=0.7','en'],
    ['en-GB ;q=0.2, pt-BR ; q=0.8','pt-BR'],
    ['es-MX;q=0.7,EN-us;q=0.7','es'],
    ['en;q=0,pt-BR;q=0.2','pt-BR'],
    ['de-DE, es-AR; q=1.000, en;q=0.900','es'],
    ['es;q=9,en;q=0.8','en'],
    ['pt;q=bad,es;q=-1,en;q=0.5','en']
  ])assert.deepEqual(suggestLanguage({acceptLanguage:header}),{suggested_language:language,language_source:'accept-language',country:null});
});

test('países desconocidos usan el navegador y las preferencias ausentes o no compatibles vuelven al español',()=>{
  for(const country of [undefined,'XX','T1','ZZ']) {
    assert.deepEqual(suggestLanguage({country,acceptLanguage:'pt-BR,en;q=0.8'}),{suggested_language:'pt-BR',language_source:'accept-language',country:null});
  }
  for(const acceptLanguage of [undefined,null,'','de-DE,fr;q=0.8','*','en;q=0,pt;q=0','es;q=1.1,pt;q=0.1234']) {
    assert.deepEqual(suggestLanguage({acceptLanguage}),{suggested_language:'es',language_source:'default',country:null});
  }
});

test('/api/config resuelve el país por solicitud, no lo comparte y conserva moneda y servicios',async t=>{
  const call=workerFixture(t),responses=await Promise.all(['BR','ES','DE'].map(country=>call(country,{'accept-language':'en'})));
  assert.deepEqual(responses.map(({data})=>data.suggested_language),['pt-BR','es','en']);
  assert.deepEqual(responses.map(({data})=>data.country),['BR','ES','DE']);
  for(const response of responses) {
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.data.language,'es');assert.equal(response.data.locale,'es-ES');
    assert.equal(response.data.currency,'EUR');assert.equal(response.data.mode,'catalog');
    assert.equal(response.data.checkout_enabled,false);assert.equal(response.data.shipping_provider,'sendcloud');
  }
  const next=await call(null,{'accept-language':'pt-PT'});
  assert.equal(next.data.language_source,'accept-language');assert.equal(next.data.country,null);
  const plain=await call(null);
  assert.equal(plain.data.suggested_language,'es');assert.equal(plain.data.language_source,'default');
});

test('HTTP local ignora cabeceras de país falsificadas y usa únicamente Accept-Language',async t=>{
  const db=database(':memory:'),app=createApp({db,config});
  t.after(()=>db.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const [headers,language,source] of [
    [{'X-EDG-Country':'BR','CF-IPCountry':'BR','Accept-Language':'en-GB'},'en','accept-language'],
    [{'X-EDG-Country':'US','CF-IPCountry':'US','Accept-Language':'pt-PT'},'pt-BR','accept-language'],
    [{'X-EDG-Country':'US','CF-IPCountry':'US','Accept-Language':''},'es','default']
  ]) {
    const response=await fetch(`${origin}/api/config`,{headers}),data=await response.json();
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(data.suggested_language,language);assert.equal(data.language_source,source);assert.equal(data.country,null);
  }
});

test('el servidor local entrega los tres recursos de idiomas como JavaScript',async t=>{
  const db=database(':memory:'),app=createApp({db,config});
  t.after(()=>db.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  for(const file of ['i18n.js','i18n-common.js','i18n-editorial.js']) {
    const response=await fetch(`${origin}/${file}`);
    assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await response.text(),await readFile(new URL(`../public/${file}`,import.meta.url),'utf8'));
  }
});
