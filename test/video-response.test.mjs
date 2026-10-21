import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from '../src/db.mjs';
import { configuration,createApp } from '../src/server.mjs';
import { campaignVideoResponse } from '../src/video-response.mjs';

const sample=Uint8Array.from({length:20},(_,index)=>index);

test('rangos MP4 acotados, abiertos y de sufijo devuelven exactamente los bytes pedidos',()=>{
  for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=5-9',5,9],['bytes=17-',17,19],['bytes=-4',16,19],['bytes=18-999',18,19],['bytes=-999',0,19]]){
    const result=campaignVideoResponse({headers:{Range:range}},sample);
    assert.equal(result.status,206,range);
    assert.equal(result.headers.get('Content-Range'),`bytes ${start}-${end}/20`,range);
    assert.equal(result.headers.get('Content-Length'),String(end-start+1),range);
    assert.equal(result.headers.get('Accept-Ranges'),'bytes');
    assert.deepEqual(result.body,sample.subarray(start,end+1),range);
  }
});

test('rangos fuera del archivo devuelven 416 y sintaxis no compatible conserva la respuesta completa',()=>{
  for(const range of ['bytes=20-','bytes=30-40','bytes=-0','bytes=9-5','bytes=999999999999999999999999999999-']){
    const result=campaignVideoResponse({headers:{Range:range}},sample);
    assert.equal(result.status,416,range);
    assert.equal(result.headers.get('Content-Range'),'bytes */20');
    assert.equal(result.headers.get('Content-Length'),'0');
    assert.equal(result.body,null);
  }
  for(const range of ['items=0-1','bytes=0-1,5-6','bytes=-','bytes=nonsense']){
    const result=campaignVideoResponse({headers:{Range:range}},sample);
    assert.equal(result.status,200,range);
    assert.deepEqual(result.body,sample);
    assert.equal(result.headers.get('Content-Range'),null);
  }
});

test('If-Range solo sirve fragmentos cuando coincide un validador válido de la representación',()=>{
  const modified='Wed, 21 Oct 2026 12:00:00 GMT';
  const headers={ETag:'"current"','Last-Modified':modified};
  for(const validator of ['"current"',modified]){
    assert.equal(campaignVideoResponse({headers:{Range:'bytes=0-1','If-Range':validator}},sample,headers).status,206);
  }
  for(const validator of ['"old"','W/"current"','Thu, 22 Oct 2026 12:00:00 GMT','Tue, 20 Oct 2026 12:00:00 GMT','invalid']){
    const result=campaignVideoResponse({headers:{Range:'bytes=0-1','If-Range':validator}},sample,headers);
    assert.equal(result.status,200,validator);
    assert.deepEqual(result.body,sample,validator);
  }
});

test('ETag fuerte, validación de caché y HEAD son coherentes con el archivo completo',()=>{
  const result=campaignVideoResponse({},sample,{ETag:'W/"upstream"','Cache-Control':'public, max-age=60','Transfer-Encoding':'chunked',Connection:'keep-alive','Content-Encoding':'identity'});
  const etag=result.headers.get('ETag');
  assert.match(etag,/^"[a-f0-9]{64}"$/);
  assert.equal(result.headers.get('Cache-Control'),'public, max-age=60');
  for(const name of ['Transfer-Encoding','Connection','Content-Encoding'])assert.equal(result.headers.get(name),null);
  assert.equal(campaignVideoResponse({},sample,{ETag:'"strong-upstream"'}).headers.get('ETag'),'"strong-upstream"');
  const unchanged=campaignVideoResponse({headers:{'If-None-Match':etag}},sample);
  assert.equal(unchanged.status,304);
  assert.equal(unchanged.body,null);
  const head=campaignVideoResponse({method:'HEAD',headers:{Range:'bytes=0-1'}},sample);
  assert.equal(head.status,200);
  assert.equal(head.headers.get('Content-Length'),'20');
  assert.equal(head.headers.get('Content-Range'),null);
  assert.equal(head.body,null);
});

test('el servidor local sirve los MP4 con los mismos encabezados y rangos que producción',async t=>{
  const db=database(':memory:');t.after(()=>db.close());
  const app=createApp({db,config:configuration({COMMERCE_MODE:'catalog',APP_URL:'http://localhost:3000'}),runtime:'worker'});
  async function request(path,method='GET',headers={}){
    const result={headers:{},body:Buffer.alloc(0)};
    const response={headersSent:false,
      setHeader(name,value){result.headers[name.toLowerCase()]=String(value);},
      writeHead(status,values){result.status=status;for(const [name,value] of Object.entries(values))this.setHeader(name,value);this.headersSent=true;},
      end(content){result.body=content?Buffer.from(content):Buffer.alloc(0);}
    };
    await app.handler({url:path,method,headers},response);return result;
  }
  for(const path of ['/edg-intro.mp4','/edg-intro-mobile.mp4','/edg-logo-tremor-loop.mp4']){
    const file=await readFile(new URL(`../public${path}`,import.meta.url));
    const full=await request(path);
    assert.equal(full.status,200);
    assert.deepEqual(full.body,file);
    assert.equal(full.headers['content-length'],String(file.length));
    const partial=await request(path,'GET',{range:'bytes=0-1'});
    assert.equal(partial.status,206);
    assert.equal(partial.headers['content-range'],`bytes 0-1/${file.length}`);
    assert.equal(partial.headers['content-type'],'video/mp4');
    assert.equal(partial.headers['accept-ranges'],'bytes');
    assert.equal(partial.headers['x-content-type-options'],'nosniff');
    assert.deepEqual(partial.body,file.subarray(0,2));
    const head=await request(path,'HEAD',{range:'bytes=0-1'});
    assert.equal(head.status,200);
    assert.equal(head.headers['content-length'],String(file.length));
    assert.equal(head.body.length,0);
    const unsatisfiable=await request(path,'GET',{range:`bytes=${file.length}-`});
    assert.equal(unsatisfiable.status,416);
    assert.equal(unsatisfiable.headers['content-range'],`bytes */${file.length}`);
  }
  assert.equal((await request('/other.mp4')).status,404);
});
