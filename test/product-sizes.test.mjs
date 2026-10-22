import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { database } from '../src/db.mjs';
import { migrate } from '../src/migrations.mjs';
import { commerce } from '../src/commerce.mjs';
import { providers } from '../src/providers.mjs';
import { now } from '../src/security.mjs';
import { initializeLegacy, insertLegacyProduct } from './legacy-schema.mjs';

const config={mode:'demo',reservationMinutes:30};
const input={sku:'SIZES-1',name:'Camiseta de prueba',description:'Producto con varias tallas',
  category:'Camiseta',sizes:['S','L','XL'],price:10000,cost:4000,low_stock:2,
  weight:.5,width:10,height:10,length:10,color:'#334455',icon:'◇'};
const address={name:'Cliente de prueba',phone:'41999999999',document:'12345678901',
  postal_code:'80010000',street:'Calle de prueba',number:'10',district:'Centro',city:'Curitiba',state:'PR'};

function fixture(t,path=':memory:') {
  const db=database(path);
  t.after(()=>db.close());
  const users=Object.fromEntries(['admin','customer'].map(role=>{
    const user={id:randomUUID(),name:role,email:`${role}@example.test`,role};
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(user.id,user.name,user.email,'unused',role,now());
    return [role,user];
  }));
  const shop=commerce(db,config,providers(config)),product=shop.saveProduct(users.admin,input);
  return {db,shop,product,...users};
}

function row(f) {return f.db.prepare('SELECT * FROM products WHERE id=?').get(f.product.id);}
function edit(f,changes={}) {return f.shop.saveProduct(f.admin,{...input,...changes},f.product.id);}

test('camisetas y sudaderas ofrecen únicamente S, L, XL y XXL en todas sus categorías',t=>{
  const f=fixture(t),sizes=['S','L','XL','XXL'];
  for(const category of ['Camiseta','Camisetas','Sudadera','Sudaderas','Moletom','Moleton','Moletons',' MÓLETÓN ']) {
    const saved=f.shop.saveProduct(f.admin,{...input,sku:`CLOTHES-${category}`,category,sizes});
    assert.deepEqual(saved.sizes,sizes);
    const metadata=f.shop.categories().find(c=>c.name===category.trim());
    assert.deepEqual(metadata.sizes,sizes);
    assert.equal(metadata.allow_legacy_sizes,false);
    for(const invalid of ['XS','M','PP','P','G','GG','XGG']) {
      assert.throws(()=>f.shop.saveProduct(f.admin,{...input,sku:'INVALID-CLOTHES',category,sizes:[invalid]}),error=>error.status===400);
      assert.throws(()=>f.shop.saveProduct(f.admin,{...input,sku:'INVALID-CLOTHES',category,sizes:undefined,size:invalid}),error=>error.status===400);
    }
  }
  for(const category of ['Gorra','Tabla','Accesorios']) {
    if(!f.shop.categories().some(c=>c.name===category))f.shop.saveCategory(f.admin,{name:category});
    assert.equal(f.shop.categories().find(c=>c.name===category).allow_legacy_sizes,true);
  }
});

test('las tallas antiguas de ropa se conservan hasta que se guarda una selección válida',t=>{
  const f=fixture(t);
  for(const category of ['Camiseta','Sudadera','Moletom']) {
    for(const previous of [['M'],['PP','M','L']]) {
      f.db.prepare('UPDATE products SET category=?,size=?,sizes=? WHERE id=?')
        .run(category,previous[0],JSON.stringify(previous),f.product.id);
      assert.deepEqual(edit(f,{category,sizes:undefined}).sizes,previous);
      assert.deepEqual(edit(f,{category,sizes:undefined,size:previous[0]}).sizes,previous);
      const before=row(f),auditCount=f.db.prepare('SELECT COUNT(*) n FROM audit').get().n;
      for(const sizes of [previous,['S','M'],['PP'],[]]) {
        assert.throws(()=>edit(f,{category,name:'Cambio no válido',sizes}),error=>error.status===400);
        assert.deepEqual(row(f),before);
        assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit').get().n,auditCount);
      }
      const saved=edit(f,{category,sizes:['S','XXL']});
      assert.deepEqual(saved.sizes,['S','XXL']);
      assert.equal(saved.size,'S');
      assert.deepEqual(JSON.parse(row(f).sizes),['S','XXL']);
    }
  }
});

test('varias tallas pertenecen al mismo producto y se conservan al reabrir la base',t=>{
  const directory=mkdtempSync(join(tmpdir(),'edg-product-sizes-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'store.db'),f=fixture(t,path);
  assert.deepEqual(f.product.sizes,['S','L','XL']);
  assert.equal(f.product.size,'S');
  assert.deepEqual(JSON.parse(row(f).sizes),['S','L','XL']);
  assert.equal(row(f).size,'S');
  const reopened=database(path);
  t.after(()=>reopened.close());
  const shop=commerce(reopened,config,providers(config));
  for(const admin of [false,true]) {
    const products=shop.products(admin);
    assert.equal(products.length,1);
    assert.equal(products[0].id,f.product.id);
    assert.equal(products[0].sku,input.sku);
    assert.equal(products[0].size,'S');
    assert.deepEqual(products[0].sizes,['S','L','XL']);
  }
});

test('editar la lista añade, elimina y ordena tallas y sincroniza el valor antiguo',t=>{
  const f=fixture(t);
  const updated=edit(f,{sizes:[' XL ','XXL'],size:'S'});
  assert.deepEqual(updated.sizes,['XL','XXL']);
  assert.equal(updated.size,'XL');
  assert.deepEqual(JSON.parse(row(f).sizes),['XL','XXL']);
  assert.equal(row(f).size,'XL');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM products').get().n,1);
  assert.deepEqual(f.shop.products()[0].sizes,['XL','XXL']);
});

test('los tipos, límites, duplicados y tallas ajenas a la categoría se rechazan sin cambiar el producto',t=>{
  const f=fixture(t),before=row(f),auditCount=f.db.prepare('SELECT COUNT(*) n FROM audit').get().n;
  const invalid=[null,'S,M',{},[3],[null],[true],[''],['   '],['X'.repeat(31)],
    ['L',' L '],['no válida'],[],Array.from({length:21},(_,i)=>String(i)),Array(1)];
  for(const sizes of invalid) {
    assert.throws(()=>edit(f,{name:'Cambio que debe revertirse',sizes}),error=>error.status===400);
    assert.deepEqual(row(f),before);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit').get().n,auditCount);
  }
  assert.throws(()=>f.shop.saveProduct(f.admin,{...input,sku:'MISSING',sizes:undefined}),error=>error.status===400);
});

test('las categorías genéricas permiten tallas libres y productos sin talla',t=>{
  const f=fixture(t),sizes=Array.from({length:20},(_,i)=>`Medida ${i+1}`);
  sizes[0]='X'.repeat(30);
  assert.deepEqual(edit(f,{category:'Accesorios',sizes}).sizes,sizes);
  assert.deepEqual(edit(f,{category:'Accesorios',sizes:[' Ajustable ','Pequeña / 10"']}).sizes,['Ajustable','Pequeña / 10"']);
  const cleared=edit(f,{category:'Accesorios',sizes:[]});
  assert.equal(cleared.size,'');
  assert.deepEqual(cleared.sizes,[]);
  const created=f.shop.saveProduct(f.admin,{...input,sku:'NO-SIZE',category:'Accesorios',sizes:undefined});
  assert.deepEqual(created.sizes,[]);
});

test('los clientes antiguos conservan una lista múltiple y no pueden borrarla mediante size',t=>{
  const f=fixture(t),{sizes,...legacy}=input;
  assert.deepEqual(f.shop.saveProduct(f.admin,{...legacy,name:'Nombre actualizado'},f.product.id).sizes,sizes);
  assert.deepEqual(f.shop.saveProduct(f.admin,{...legacy,size:' S '},f.product.id).sizes,sizes);
  const before=row(f);
  for(const size of ['L','']) {
    assert.throws(()=>f.shop.saveProduct(f.admin,{...legacy,size},f.product.id),error=>error.status===409);
    assert.deepEqual(row(f),before);
  }
  for(const size of [null,3,'X'.repeat(31)]) {
    assert.throws(()=>f.shop.saveProduct(f.admin,{...legacy,size},f.product.id),error=>error.status===400);
  }
});

test('el campo antiguo sigue creando y editando productos con una sola talla',t=>{
  const f=fixture(t),{sizes,...legacy}=input;
  const created=f.shop.saveProduct(f.admin,{...legacy,sku:'LEGACY',size:' S '});
  assert.deepEqual(created.sizes,['S']);
  assert.equal(created.size,'S');
  const updated=f.shop.saveProduct(f.admin,{...legacy,sku:'LEGACY',size:'L'},created.id);
  assert.deepEqual(updated.sizes,['L']);
  assert.equal(updated.size,'L');
  assert.throws(()=>f.shop.saveProduct(f.admin,{...legacy,sku:'LEGACY',size:''},created.id),error=>error.status===400);
});

test('renombrar una categoría conserva las tallas históricas solo para sus productos existentes',t=>{
  const f=fixture(t);
  f.shop.saveCategory(f.admin,{previous:'Camiseta',name:'Shapes'});
  assert.deepEqual(f.shop.products(true)[0].sizes,['S','L','XL']);
  assert.deepEqual(edit(f,{category:'Shapes',sizes:['L','8.25']}).sizes,['L','8.25']);
  assert.deepEqual(edit(f,{category:'Shapes',sizes:undefined,size:'L'}).sizes,['L','8.25']);
  assert.throws(()=>edit(f,{category:'Shapes',sizes:['XS','8.25']}),error=>error.status===400);
  assert.throws(()=>f.shop.saveProduct(f.admin,{...input,sku:'NEW-SHAPE',category:'Shapes',sizes:['L']}),error=>error.status===400);
  assert.throws(()=>edit(f,{category:'Sudadera',sizes:['L','8.25']}),error=>error.status===400);
  assert.deepEqual(edit(f,{category:'Sudadera',sizes:['L','XXL']}).sizes,['L','XXL']);
});

test('un producto antiguo sin talla sigue editable si el cliente omite los campos de tallas',t=>{
  const f=fixture(t);
  f.db.prepare("UPDATE products SET size='',sizes='[]' WHERE id=?").run(f.product.id);
  const saved=edit(f,{sizes:undefined,name:'Producto heredado'});
  assert.deepEqual(saved.sizes,[]);
  assert.equal(saved.size,'');
  assert.throws(()=>edit(f,{sizes:[]}),error=>error.status===400);
});

test('editar tallas no multiplica el saldo compartido ni modifica reservas o pedidos',async t=>{
  const f=fixture(t),stock=f.shop.stock(f.admin,f.product.id,10,'Existencias iniciales');
  assert.equal(stock.stock,10);
  assert.deepEqual(stock.sizes,['S','L','XL']);
  const cart=f.shop.setCart(f.customer,f.product.id,2);
  assert.equal(cart.items.length,1);
  assert.deepEqual(cart.items[0].sizes,['S','L','XL']);
  const quote=await f.shop.quote(f.customer,address.postal_code);
  const order=await f.shop.checkout(f.customer,{quote_id:quote.id,service_id:quote.options[0].id,address},randomUUID());
  const saved=edit(f,{sizes:['L','XXL']});
  assert.equal(saved.stock,10);
  assert.equal(saved.reserved,2);
  assert.equal(f.shop.products()[0].available,8);
  assert.deepEqual(f.shop.order(order.id).items,order.items);
  assert.equal(order.items.length,1);
  f.shop.demoPay(f.customer,order.id);
  assert.equal(row(f).stock,8);
  assert.equal(row(f).reserved,0);
  assert.deepEqual(JSON.parse(row(f).sizes),['L','XXL']);
});

for(const transactionSync of [false,true]) {
  test(`la migración v7 conserva tallas y existencias y se repite con ${transactionSync?'transactionSync':'SQLite de Node'}`,t=>{
    const sql=new DatabaseSync(':memory:');
    t.after(()=>sql.close());
    initializeLegacy(sql,6);
    for(const [id,size,deleted] of [['legacy','Único',null],['quote','8.25" / 21 cm',null],['empty','',null],['deleted','GG','2026-01-01']]) {
      insertLegacyProduct(sql,{id,size,deleted_at:deleted});
    }
    const before=sql.prepare('SELECT * FROM products ORDER BY id').all();
    let transactions=0;
    const db=transactionSync?{
      exec:query=>sql.exec(query),prepare:query=>sql.prepare(query),
      transactionSync(fn) {
        transactions++;sql.exec('BEGIN IMMEDIATE');
        try {const result=fn();sql.exec('COMMIT');return result;}
        catch(error) {sql.exec('ROLLBACK');throw error;}
      }
    }:sql;
    migrate(db);
    migrate(db);
    const after=sql.prepare('SELECT * FROM products ORDER BY id').all();
    assert.deepEqual(after.map(product=>Object.fromEntries(Object.keys(before[0]).map(key=>[key,product[key]]))),before.map(product=>({...product})));
    for(const product of after)assert.deepEqual(JSON.parse(product.sizes),product.size?[product.size]:[]);
    assert.equal(sql.prepare('SELECT MAX(version) v FROM schema_version').get().v,8);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=7').get().n,1);
    sql.prepare('UPDATE products SET sizes=? WHERE id=?').run('["S","M"]','legacy');
    migrate(db);
    assert.deepEqual(JSON.parse(sql.prepare('SELECT sizes FROM products WHERE id=?').get('legacy').sizes),['S','M']);
    if(transactionSync)assert.ok(transactions>0);
  });
}
