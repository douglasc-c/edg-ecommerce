import {readFileSync} from 'node:fs';

// Later migrations rebuild full commerce tables. Product-only schemas are not
// representative legacy databases, so derive each fixture from the frozen v7.
export function initializeLegacy(db,version,{categories=false}={}){
  let schema=readFileSync(new URL('./fixtures/schema-v7.sql',import.meta.url),'utf8');
  if(version<7)schema=schema.replace(", sizes TEXT NOT NULL DEFAULT '[]'",'');
  if(version<5)schema=schema.replace(', deleted_at TEXT','');
  if(version<3)schema=schema.replace(", size TEXT NOT NULL DEFAULT ''",'');
  if(version<2){
    schema=schema.replace(", images TEXT NOT NULL DEFAULT '[]', fiscal TEXT NOT NULL DEFAULT '{}'",'');
    schema=schema.replace(", fiscal TEXT NOT NULL DEFAULT '{}'",'');
    schema=schema.replace(', discount INTEGER NOT NULL DEFAULT 0, coupon_code TEXT','');
  }
  const firstTables=new Set(['schema_version','users','sessions','products','carts','quotes','orders','order_items','order_events','movements','ledger','audit']);
  const statements=schema.split(';').filter(statement=>{
    const table=statement.match(/CREATE TABLE (\w+)/)?.[1];
    const index=statement.match(/CREATE INDEX (\w+)/)?.[1];
    if(table){
      if(version<2&&!firstTables.has(table))return false;
      if(version<4&&table==='categories')return false;
      if(version<6&&table.startsWith('europe_'))return false;
    }
    if(index&&((version<2&&index==='idx_coupon_uses')||(version<6&&index.startsWith('idx_europe_'))))return false;
    return !/INSERT INTO schema_version/.test(statement);
  });
  db.exec(statements.join(';')+';');
  for(let value=1;value<=version;value++)db.prepare('INSERT INTO schema_version VALUES(?)').run(value);
  if(version<4&&categories)db.exec('CREATE TABLE categories(name TEXT PRIMARY KEY COLLATE NOCASE);');
}

export function insertLegacyProduct(db,{id='legacy',size='',deleted_at=null,stock=10,reserved=2,category='Heredada',name='Producto heredado'}={}){
  const columns=new Set(db.prepare('PRAGMA table_info(products)').all().map(column=>column.name));
  const product={id,sku:`SKU-${id}`,name,description:'Producto anterior a las variaciones',category,price:2000,cost:500,
    stock,reserved,weight:.5,width:10,height:10,length:10,color:'#111111',icon:'◇',created_at:'2026-01-01T00:00:00.000Z',size,deleted_at};
  const fields=Object.keys(product).filter(key=>columns.has(key));
  db.prepare(`INSERT INTO products(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...fields.map(key=>product[key]));
}
