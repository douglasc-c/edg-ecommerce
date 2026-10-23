import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { database } from '../src/db.mjs';
import { initialize } from '../src/schema.mjs';
import { commerce } from '../src/commerce.mjs';
import { providers } from '../src/providers.mjs';
import { configuration, createApp } from '../src/server.mjs';
import { hash, now } from '../src/security.mjs';
import { initializeLegacy, insertLegacyProduct } from './legacy-schema.mjs';

const config=configuration({COMMERCE_MODE:'catalog',APP_URL:'http://localhost:3000'});

function fixture(t,path=':memory:') {
  const db=database(path);
  t.after(()=>db.close());
  const users=Object.fromEntries(['admin','inventory','customer','support'].map(role=>{
    const user={id:randomUUID(),name:role,email:`${role}@example.test`,role};
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(user.id,user.name,user.email,'unused',role,now());
    return [role,user];
  }));
  const shop=commerce(db,config,providers(config));
  const product=shop.saveProduct(users.admin,{sku:'CATEGORY-1',name:'Tabla de prueba',
    description:'Producto de prueba',category:'Prueba',price:10000,cost:3000,
    low_stock:2,weight:.5,width:10,height:10,length:10,color:'#334455',icon:'◇'});
  function photo(label) {
    const data=Buffer.from(label),id=hash(data);
    db.prepare('INSERT INTO media(id,data,actor_id,created_at) VALUES(?,?,?,?)')
      .run(id,data,users.admin.id,now());
    return {id,url:`/media/${id}.jpg`,data};
  }
  return {db,shop,product,...users,photo};
}

function category(f,name) {return f.shop.categories().find(row=>row.name===name);}

function state(f) {
  return {
    categories:f.shop.categories(),
    products:f.db.prepare('SELECT id,category FROM products ORDER BY id').all(),
    audit:f.db.prepare('SELECT * FROM audit ORDER BY id').all()
  };
}

// Exercise the same HTTP handler used by Node and Workers without opening a socket.
async function request(app,path,{method='GET',body,headers={}}={}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{origin:config.url,'content-type':'application/json',...headers}});
  const result={status:200,headers:{},bytes:Buffer.alloc(0)};
  const res={headersSent:false,
    setHeader(name,value) {result.headers[name.toLowerCase()]=value;},
    writeHead(status,values) {
      result.status=status;
      for(const [name,value] of Object.entries(values))this.setHeader(name,value);
      this.headersSent=true;
    },
    end(value) {result.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}
  };
  await app.handler(req,res);
  if(result.headers['content-type']?.startsWith('application/json'))result.data=JSON.parse(result.bytes.toString());
  return result;
}

function authentication(f,user) {
  const raw=randomUUID(),csrf=randomUUID();
  f.db.prepare('INSERT INTO sessions(token,user_id,csrf,expires_at) VALUES(?,?,?,?)')
    .run(hash(raw),user.id,csrf,new Date(Date.now()+60000).toISOString());
  return {cookie:`edg_session=${raw}`,'x-csrf-token':csrf};
}

test('la imagen seleccionada se conserva al reabrir la base y al inicializar de nuevo',t=>{
  const directory=mkdtempSync(join(tmpdir(),'edg-category-images-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'store.db'),f=fixture(t,path),image=f.photo('first category image');
  f.shop.saveCategory(f.admin,{name:'Colección',image_id:image.id});
  assert.equal(category(f,'Colección').image_id,image.id);
  assert.equal(category(f,'Colección').image,image.url);
  assert.equal(f.db.prepare('SELECT image_id FROM categories WHERE name=?').get('Colección').image_id,image.id);
  const reopened=database(path);
  t.after(()=>reopened.close());
  initialize(reopened);
  const persisted=commerce(reopened,config,providers(config)).categories().find(row=>row.name==='Colección');
  assert.equal(persisted.image_id,image.id);
  assert.equal(persisted.image,image.url);
  assert.ok(Array.isArray(persisted.sizes));
  const unconfigured=category(f,'Prueba');
  assert.equal(unconfigured.image_id,null);
  assert.equal(unconfigured.image,null);
});

test('renombrar una categoría conserva su imagen y la asociación de sus productos',t=>{
  const f=fixture(t),image=f.photo('rename category image');
  f.shop.saveCategory(f.admin,{name:'Prueba',previous:'Prueba',image_id:image.id});
  f.shop.saveCategory(f.admin,{name:'Shapes',previous:'Prueba'});
  assert.equal(category(f,'Prueba'),undefined);
  assert.equal(category(f,'Shapes').image_id,image.id);
  assert.equal(category(f,'Shapes').image,image.url);
  assert.equal(f.db.prepare('SELECT category FROM products WHERE id=?').get(f.product.id).category,'Shapes');
  assert.equal(f.shop.products()[0].category,'Shapes');
  f.shop.saveCategory(f.admin,{name:'Shapes',previous:'Shapes'});
  assert.equal(category(f,'Shapes').image_id,image.id);
});

test('la imagen se puede cambiar sin renombrar y quitar con null',t=>{
  const f=fixture(t),first=f.photo('category first'),second=f.photo('category replacement');
  f.shop.saveCategory(f.admin,{name:'Prueba',image_id:first.id});
  f.shop.saveCategory(f.admin,{name:'Prueba',previous:'Prueba',image_id:second.id});
  assert.equal(category(f,'Prueba').image_id,second.id);
  assert.equal(category(f,'Prueba').image,second.url);
  f.shop.saveCategory(f.admin,{name:'Prueba',image_id:null});
  assert.equal(category(f,'Prueba').image_id,null);
  assert.equal(category(f,'Prueba').image,null);
  assert.ok(f.db.prepare('SELECT id FROM media WHERE id=?').get(first.id));
  assert.ok(f.db.prepare('SELECT id FROM media WHERE id=?').get(second.id));
  assert.equal(f.db.prepare('SELECT category FROM products WHERE id=?').get(f.product.id).category,'Prueba');
});

test('una referencia de imagen inválida no crea ni renombra categorías ni escribe auditoría',t=>{
  const f=fixture(t),image=f.photo('valid category before invalid update');
  f.shop.saveCategory(f.admin,{name:'Prueba',image_id:image.id});
  const before=state(f);
  for(const image_id of ['not-a-photo','0'.repeat(64),image.url,'A'.repeat(64),42,[],{}]) {
    assert.throws(()=>f.shop.saveCategory(f.admin,{name:'Renombrada',previous:'Prueba',image_id}),
      error=>error.status===400);
    assert.deepEqual(state(f),before);
    assert.throws(()=>f.shop.saveCategory(f.admin,{name:'Nueva',image_id}),error=>error.status===400);
    assert.deepEqual(state(f),before);
  }
});

test('una colisión de nombres no pierde la imagen ni cambia los productos',t=>{
  const f=fixture(t),original=f.photo('original category'),other=f.photo('other category');
  f.shop.saveCategory(f.admin,{name:'Prueba',image_id:original.id});
  f.shop.saveCategory(f.admin,{name:'Destino',image_id:other.id});
  const before=state(f);
  assert.throws(()=>f.shop.saveCategory(f.admin,{name:'destino',previous:'Prueba',image_id:null}),
    error=>error.status===409);
  assert.deepEqual(state(f),before);
  assert.throws(()=>f.shop.saveCategory(f.admin,{name:'PRUEBA'}),error=>error.status===409);
  assert.deepEqual(state(f),before);
});

for(const existingCategories of [false,true]) {
  test(`una base v3 ${existingCategories?'con':'sin'} tabla de categorías conserva y completa su catálogo`,t=>{
    const db=new DatabaseSync(':memory:');
    t.after(()=>db.close());
    db.exec('PRAGMA foreign_keys=ON;');
    initializeLegacy(db,3,{categories:existingCategories});
    insertLegacyProduct(db,{id:'old-product',size:'M'});
    if(existingCategories)db.exec("INSERT INTO categories VALUES('Sin productos');");
    initialize(db);
    initialize(db);
    assert.equal(db.prepare('SELECT MAX(version) version FROM schema_version').get().version,9);
    const shop=commerce(db,config,providers(config)),legacy=shop.categories().find(row=>row.name==='Heredada');
    assert.equal(legacy.image_id,null);
    assert.equal(legacy.image,null);
    assert.ok(db.prepare('SELECT name FROM categories WHERE name=?').get('Heredada'));
    assert.equal(db.prepare('SELECT name FROM products WHERE id=?').get('old-product').name,'Producto heredado');
    assert.equal(db.prepare('SELECT size FROM products WHERE id=?').get('old-product').size,'M');
    assert.deepEqual(JSON.parse(db.prepare('SELECT sizes FROM products WHERE id=?').get('old-product').sizes),['M']);
    if(existingCategories)assert.ok(shop.categories().some(row=>row.name==='Sin productos'));
  });
}

test('HTTP: las imágenes son públicas; su selección exige catálogo, sesión y CSRF',async t=>{
  const f=fixture(t),image=f.photo('public selected category image');
  const app=createApp({db:f.db,config,runtime:'worker'}),admin=authentication(f,f.admin),inventory=authentication(f,f.inventory);
  f.shop.saveCategory(f.admin,{name:'Prueba',image_id:image.id});
  const publicCategories=await request(app,'/api/categories');
  assert.equal(publicCategories.status,200);
  const publicCategory=publicCategories.data.find(row=>row.name==='Prueba');
  assert.deepEqual(publicCategory,{name:'Prueba',image:image.url});
  assert.ok(publicCategories.data.every(row=>Object.keys(row).sort().join(',')==='image,name'));
  const media=await request(app,image.url);
  assert.equal(media.status,200);
  assert.equal(media.headers['content-type'],'image/jpeg');
  assert.deepEqual(media.bytes,image.data);
  assert.equal((await request(app,'/api/admin/categories')).status,401);
  assert.equal((await request(app,'/api/admin/categories',{headers:admin})).status,200);
  for(const user of [f.customer,f.support]) {
    const headers=authentication(f,user);
    assert.equal((await request(app,'/api/admin/categories',{headers})).status,403);
    assert.equal((await request(app,'/api/admin/categories',{method:'POST',headers,
      body:{name:'Prueba',image_id:null}})).status,403);
  }
  const update={name:'Prueba',previous:'Prueba',image_id:null};
  assert.equal((await request(app,'/api/admin/categories',{method:'POST',body:update,
    headers:{cookie:admin.cookie}})).status,403);
  assert.equal((await request(app,'/api/admin/categories',{method:'POST',body:update,
    headers:{...admin,origin:'https://other.example.test'}})).status,403);
  assert.equal(category(f,'Prueba').image_id,image.id);
  assert.equal((await request(app,'/api/admin/categories',{method:'POST',body:update,headers:inventory})).status,201);
  assert.equal((await request(app,'/api/categories')).data.find(row=>row.name==='Prueba').image,null);
  assert.equal((await request(app,'/api/admin/categories',{method:'POST',headers:admin,
    body:{name:'Prueba',image_id:image.id}})).status,201);
  assert.equal((await request(app,'/api/categories')).data.find(row=>row.name==='Prueba').image,image.url);
});
