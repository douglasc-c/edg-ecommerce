import { randomUUID } from 'node:crypto';
import { photoIds } from './media.mjs';
import { requireThat, text, integer, now } from './security.mjs';

const colorKey=value=>value.normalize('NFKC').toLocaleLowerCase('es');
const skuPart=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'');

export function productVariants(db,audit) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const rows=id=>all('SELECT * FROM product_variants WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at,id',id);
  function serialize(p,admin=false) {
    const variants=rows(p.id),visible=admin?variants:variants.filter(v=>v.active);
    const total=variants.reduce((sum,v)=>({stock:sum.stock+v.stock,reserved:sum.reserved+v.reserved}),{stock:p.stock,reserved:p.reserved});
    return {variants_enabled:!!p.variants_enabled,unallocated_stock:p.variants_enabled?p.stock:0,unallocated_reserved:p.variants_enabled?p.reserved:0,
      stock:total.stock,reserved:total.reserved,
      available:p.variants_enabled?visible.reduce((sum,v)=>sum+v.stock-v.reserved,0):p.stock-p.reserved,
      variants:visible.map(v=>({id:v.id,sku:v.sku,color_name:v.color_name,color_hex:v.color_hex,size:v.size,
        price:v.price_override??p.price,price_override:v.price_override,stock:v.stock,reserved:v.reserved,
        available:v.stock-v.reserved,low_stock:v.low_stock,active:!!v.active,
        images:JSON.parse(v.images).map(id=>`/media/${id}.jpg`),...(admin?{image_ids:JSON.parse(v.images)}:{})}))};
  }
  function movement(p,variant,quantity,reason,actor,reference=null) {
    run('INSERT INTO movements(product_id,variant_id,selected_color,selected_size,quantity,reason,reference,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      p.id,variant?.id??null,variant?.color_name??'',variant?.size??'',quantity,reason,reference,actor,now());
  }
  // Called within the product-save transaction; all validation precedes any balance transfer.
  function save(user,p,input,current=null) {
    requireThat(Array.isArray(input) && input.length>0 && input.length<=200,400,'Añade entre 1 y 200 combinaciones de color y talla.');
    const existing=rows(p.id),byId=new Map(existing.map(v=>[v.id,v])),seenIds=new Set(),seenCombinations=new Set(),colors=new Map(),skus=new Set();
    const allowed=JSON.parse(p.sizes||'[]');
    const normalized=input.map(raw=>{
      requireThat(raw && typeof raw==='object' && !Array.isArray(raw),400,'Variante no válida.');
      const previous=raw.id?byId.get(raw.id):null;
      requireThat(!raw.id || previous,400,'La variante no pertenece a este producto.');
      requireThat(!previous || !seenIds.has(previous.id),400,'No repitas una variante.');
      if(previous)seenIds.add(previous.id);
      const color_name=text(raw.color_name,'Nombre del color',1,50),color_key=colorKey(color_name);
      const color_hex=text(raw.color_hex,'Muestra del color',7,7);
      requireThat(/^#[a-fA-F0-9]{6}$/.test(color_hex),400,'Muestra del color no válida.');
      const size=raw.size===undefined?'':text(raw.size,'Talla',0,30);
      const active=raw.active===undefined?(previous?.active??1):raw.active===false?0:1;
      // Las tallas retiradas se conservan inactivas para mantener su saldo e historial.
      const retainedInactive=!!previous&&!active&&size===previous.size;
      requireThat(retainedInactive||(allowed.length?allowed.includes(size):size===''),400,'Selecciona una talla del producto para cada variante activa.');
      const key=JSON.stringify([color_key,size]);
      requireThat(!seenCombinations.has(key),400,'No repitas una combinación de color y talla.');seenCombinations.add(key);
      const images=raw.image_ids===undefined?(previous?.images??'[]'):photoIds(db,raw.image_ids);
      const colorData=JSON.stringify([color_hex.toLowerCase(),images]);
      requireThat(!colors.has(color_key)||colors.get(color_key)===colorData,400,'Usa la misma muestra y fotos para todas las tallas de un color.');colors.set(color_key,colorData);
      const id=previous?.id??randomUUID();
      let sku=raw.sku?text(raw.sku,'SKU de variante',1,80):previous?.sku;
      if(!sku)sku=`${skuPart(p.sku).slice(0,28)||'EDG'}-${skuPart(color_name).slice(0,18)||'COLOR'}-${skuPart(size).slice(0,12)||'UNICA'}-${id.slice(0,6).toUpperCase()}`;
      requireThat(!skus.has(sku),409,'No repitas el SKU de una variante.');skus.add(sku);
      requireThat(!one('SELECT id FROM product_variants WHERE sku=? AND id!=?',sku,id)&&!one('SELECT id FROM products WHERE sku=?',sku),409,'SKU de variante ya registrado.');
      const price_override=raw.price_override===undefined?(previous?.price_override??null):raw.price_override;
      if(price_override!==null)integer(price_override,'Precio de variante en céntimos',1);
      const low_stock=raw.low_stock===undefined?(previous?.low_stock??p.low_stock):integer(raw.low_stock,'Existencias mínimas',0,10000);
      if(previous && (previous.color_key!==color_key || previous.size!==size)) {
        requireThat(previous.stock===0 && previous.reserved===0 && !one('SELECT order_id FROM order_items WHERE variant_id=? LIMIT 1',previous.id),409,'Esta variante tiene existencias o historial. Conserva su color y talla y crea otra combinación.');
      }
      const stock=raw.stock===undefined?(previous?.stock??0):integer(raw.stock,'Existencias iniciales',0,100000);
      if(previous)requireThat(stock===previous.stock,409,'Actualiza las existencias de esta variante desde Inventario.');
      if(current?.variants_enabled&&!previous)requireThat(stock===0,409,'Guarda la nueva variante y registra su entrada desde Inventario.');
      return {id,sku,color_name,color_key,color_hex:color_hex.toLowerCase(),size,images,price_override,low_stock,active,stock,previous};
    });
    requireThat(colors.size<=30,400,'Usa hasta 30 colores por producto.');
    const retired=existing.filter(v=>!seenIds.has(v.id));
    for(const v of retired)requireThat(v.stock===0&&v.reserved===0,409,'Una variante con existencias o reservas no se puede eliminar. Ajusta su inventario o desactívala.');
    const converting=!!current&&!current.variants_enabled;
    if(converting) {
      requireThat(current.reserved===0,409,'Hay unidades reservadas en pedidos anteriores. Espera al pago, cancela esos pedidos o deja vencer sus reservas antes de distribuir las existencias.');
      requireThat(normalized.reduce((sum,v)=>sum+v.stock,0)===current.stock,409,`Distribuye exactamente las ${current.stock} unidades actuales entre las variantes.`);
    }
    for(const v of retired) {
      run('UPDATE product_variants SET active=0,deleted_at=? WHERE id=?',now(),v.id);
      run('DELETE FROM carts WHERE variant_id=?',v.id);
    }
    // Free old combination keys before changing the set, without dropping historical rows.
    for(const v of normalized.filter(v=>v.previous))run('UPDATE product_variants SET deleted_at=? WHERE id=?',now(),v.id);
    for(const v of normalized) {
      const fields=[v.sku,v.color_name,v.color_key,v.color_hex,v.size,v.price_override,v.low_stock,v.active,v.images];
      if(v.previous)run('UPDATE product_variants SET sku=?,color_name=?,color_key=?,color_hex=?,size=?,price_override=?,low_stock=?,active=?,images=?,deleted_at=NULL WHERE id=?',...fields,v.id);
      else {
        run('INSERT INTO product_variants(id,product_id,sku,color_name,color_key,color_hex,size,price_override,low_stock,active,images,stock,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',v.id,p.id,...fields,v.stock,now());
        if(v.stock)movement(p,v,v.stock,converting?'Distribución de existencias anteriores':'Existencias iniciales',user.id);
      }
    }
    if(!current?.variants_enabled) {
      run('UPDATE products SET variants_enabled=1,stock=0,reserved=0 WHERE id=?',p.id);
      run('DELETE FROM carts WHERE product_id=?',p.id);
      if(converting&&current.stock)movement(p,null,-current.stock,'Distribución de existencias anteriores',user.id);
      audit(user.id,converting?'product.variants_migrate':'product.variants_create',p.id,{previous_stock:current?.stock??0,variants:normalized.map(v=>({id:v.id,stock:v.stock,color:v.color_name,size:v.size}))});
    }
  }
  function adjust(user,p,id,delta,reason) {
    integer(delta,'Variación',-100000,100000);requireThat(delta!==0,400,'Introduce una variación distinta de cero.');reason=text(reason,'Motivo',3,250);
    const v=one('SELECT * FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL',id,p.id);
    requireThat(p.variants_enabled&&v,404,'Variante no encontrada.');
    requireThat(v.stock+delta>=v.reserved,409,'El ajuste no puede consumir existencias reservadas.');
    run('UPDATE product_variants SET stock=stock+? WHERE id=?',delta,v.id);
    movement(p,v,delta,reason,user.id);audit(user.id,'stock.variant_adjust',p.id,{variant_id:v.id,delta,reason});
  }
  function allocate(user,p,allocations,reason) {
    requireThat(p.variants_enabled,409,'Configura primero las variantes del producto.');
    requireThat(p.stock>0 && p.reserved===0,409,'No hay un saldo libre pendiente de distribuir.');
    reason=text(reason,'Motivo de la distribución',3,250);
    requireThat(Array.isArray(allocations)&&allocations.length>0&&allocations.length<=200,400,'Indica la distribución de existencias.');
    const seen=new Set(),entries=allocations.map(a=>{
      requireThat(a&&typeof a==='object'&&!seen.has(a.variant_id),400,'No repitas una variante en la distribución.');seen.add(a.variant_id);
      const v=one('SELECT * FROM product_variants WHERE id=? AND product_id=? AND deleted_at IS NULL',a.variant_id,p.id);requireThat(v,400,'Variante no válida para este producto.');
      return {v,quantity:integer(a.quantity,'Cantidad asignada',0,100000)};
    });
    requireThat(entries.reduce((sum,a)=>sum+a.quantity,0)===p.stock,409,`Distribuye exactamente las ${p.stock} unidades pendientes.`);
    for(const {v,quantity} of entries)if(quantity){run('UPDATE product_variants SET stock=stock+? WHERE id=?',quantity,v.id);movement(p,v,quantity,reason,user.id);}
    run('UPDATE products SET stock=0 WHERE id=?',p.id);movement(p,null,-p.stock,reason,user.id);
    audit(user.id,'stock.variants_allocate',p.id,{quantity:p.stock,allocations,reason});
  }
  return {serialize,save,adjust,allocate,movement,rows};
}
