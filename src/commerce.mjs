import { categorySizes, isClothingCategory, productSizes, productSizesForSave } from './product-sizes.mjs';
import { randomUUID } from 'node:crypto';
import { productVariants } from './product-variants.mjs';
import { transaction } from './db.mjs';
import { coupons } from './coupons.mjs';
import { photoIds } from './media.mjs';
import { spanishCheckoutAddress } from './europe-commerce.mjs';
import { requireThat, HttpError, text, integer, positive, hash, now, address, safeLink, fiscalFields, permissions } from './security.mjs';
export function commerce(db,config,provider) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const event=(id,status,message)=>run('INSERT INTO order_events(order_id,status,message,created_at) VALUES(?,?,?,?)',id,status,message,now());
  const audit=(actor,action,id,details={})=>run('INSERT INTO audit(actor_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?)',actor,action,id,JSON.stringify(details),now());
  const discounts=coupons(db,audit);
  const variants=productVariants(db,audit);
  const locks=new Set();
  async function locked(key,fn) {
    requireThat(!locks.has(key),409,'Hay una operación en curso para este pedido. Espera e inténtalo de nuevo.');
    locks.add(key); try{return await fn();}finally{locks.delete(key);}
  }
  function rawCart(userId) {
    return all('SELECT p.*,c.quantity,c.variant_id FROM carts c JOIN products p ON p.id=c.product_id WHERE user_id=? AND p.deleted_at IS NULL ORDER BY p.id,c.variant_key',userId).map(p=>{
      if(!p.variant_id)return {...p,selected_color:'',selected_size:''};
      const v=one('SELECT * FROM product_variants WHERE id=? AND product_id=?',p.variant_id,p.id);
      return {...p,base_product:p,sku:v?.sku??p.sku,price:v?.price_override??p.price,
        stock:v?.stock??0,reserved:v?.reserved??0,variant_active:!!v?.active&&!v?.deleted_at,
        selected_color:v?.color_name??'',selected_size:v?.size??'',
        images:v&&JSON.parse(v.images).length?v.images:p.images};
    });
  }
  function cart(userId) {
    const items=rawCart(userId);
    return {items:items.map(p=>({...publicProduct(p.base_product??p),sku:p.sku,price:p.price,
      images:JSON.parse(p.images).map(id=>`/media/${id}.jpg`),quantity:p.quantity,
      active:!!p.active&&(!p.variant_id||p.variant_active),available:p.stock-p.reserved,
      variant_id:p.variant_id,selected_color:p.selected_color,selected_size:p.selected_size})),
      subtotal:items.reduce((sum,p)=>sum+p.price*p.quantity,0)};
  }
  function fingerprint(items) {return hash(JSON.stringify(items.map(p=>[p.id,p.variant_id,p.sku,p.selected_color,p.selected_size,p.price,p.quantity,p.active,p.variant_active,p.variants_enabled,p.weight,p.width,p.height,p.length])));}
  function validCart(items) {
    requireThat(items.length>0 && items.length<=100,400,'El carrito está vacío o supera el límite.');
    for(const p of items)requireThat(!p.deleted_at&&p.active&&(p.variant_id?p.variants_enabled&&p.variant_active:!p.variants_enabled)&&p.stock-p.reserved>=p.quantity,409,`Existencias insuficientes para ${p.name}${p.selected_color?' · '+p.selected_color+' · '+p.selected_size:''}. Revisa la selección del carrito.`);
  }
  function publicProduct(p) {const sizes=productSizes(p);return {id:p.id,sku:p.sku,name:p.name,description:p.description,category:p.category,size:sizes[0]||'',sizes,price:p.price,color:p.color,icon:p.icon,images:JSON.parse(p.images).map(id=>`/media/${id}.jpg`),...variants.serialize(p)};}
  function adminProduct(p) {const sizes=productSizes(p);return {...p,size:sizes[0]||'',sizes,...variants.serialize(p,true)};}
  function updateBalance(item,stockDelta,reservedDelta=0) {
    const table=item.variant_id?'product_variants':'products',id=item.variant_id??item.product_id??item.id;
    run(`UPDATE ${table} SET stock=stock+?,reserved=reserved+? WHERE id=?`,stockDelta,reservedDelta,id);
  }
  function itemAvailable(item) {
    if(item.variant_id) {
      const v=one('SELECT stock-reserved available,active,deleted_at FROM product_variants WHERE id=?',item.variant_id);
      const p=one('SELECT active,deleted_at FROM products WHERE id=?',item.product_id);
      return v&&v.active&&!v.deleted_at&&p?.active&&!p.deleted_at?v.available:0;
    }
    const p=one('SELECT stock-reserved available,variants_enabled FROM products WHERE id=?',item.product_id);
    return p&&!p.variants_enabled?p.available:0;
  }
  function itemMovement(item,quantity,reason,reference) {
    const v=item.variant_id?{id:item.variant_id,color_name:item.selected_color,size:item.selected_size}:null;
    variants.movement({id:item.product_id},v,quantity,reason,null,reference);
  }
  const categoryRows='SELECT names.name,c.image_id FROM (SELECT name FROM categories UNION SELECT category AS name FROM products WHERE deleted_at IS NULL) names LEFT JOIN categories c ON c.name=names.name';
  const categoryImage=c=>({...c,image:c.image_id?`/media/${c.image_id}.jpg`:null});
  function order(id,user=null,manage=false) {
    const o=one('SELECT o.*,u.name customer_name,u.email customer_email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?',id);
    requireThat(o && (manage || !user || o.user_id===user.id),404,'Pedido no encontrado.');
    return {...o,bank_transfer:o.bank_transfer_details?JSON.parse(o.bank_transfer_details):null,address:JSON.parse(o.address),shipping_service:JSON.parse(o.shipping_service),items:all('SELECT * FROM order_items WHERE order_id=?',id),events:all('SELECT * FROM order_events WHERE order_id=? ORDER BY id',id)};
  }
  function release(o,status,message) {
    for(const item of all('SELECT * FROM order_items WHERE order_id=?',o.id))updateBalance(item,0,-item.quantity);
    discounts.release(o.id);
    run('UPDATE orders SET status=?,updated_at=? WHERE id=?',status,now(),o.id); event(o.id,status,message);
  }
  function expire() {
    transaction(db,()=>{
      for(const o of all("SELECT * FROM orders WHERE status='awaiting_payment' AND reserved_until<=?",now())) release(o,'expired','El plazo de pago ha vencido; se ha liberado la reserva de existencias.');
      run('DELETE FROM sessions WHERE expires_at<=?',now()); run('DELETE FROM quotes WHERE expires_at<=?',now());
    });
  }
  function returnStock(o) {
    for(const item of all('SELECT * FROM order_items WHERE order_id=?',o.id)) {
      const retired=item.variant_id&&one('SELECT deleted_at FROM product_variants WHERE id=?',item.variant_id)?.deleted_at;
      if(retired) {
        // La combinación puede haberse sustituido. Devuelve el saldo al reparto pendiente.
        updateBalance({...item,variant_id:null},item.quantity);
        variants.movement({id:item.product_id},{id:null,color_name:item.selected_color,size:item.selected_size},item.quantity,'Reembolso de variante retirada; pendiente de distribuir',null,o.id);
        audit(null,'stock.retired_variant_return',item.product_id,{variant_id:item.variant_id,quantity:item.quantity,order_id:o.id});
      } else {
        updateBalance(item,item.quantity);
        itemMovement(item,item.quantity,'Reembolso antes del envío',o.id);
      }
    }
  }
  function applyPayment(payment) {
    return transaction(db,()=>{
      const o=one('SELECT * FROM orders WHERE id=?',String(payment.external_reference));
      requireThat(o,404,'Pedido no encontrado.');
      requireThat(payment.currency_id===o.currency && Math.round(Number(payment.transaction_amount)*100)===o.total,409,'El importe o la moneda del pago no coinciden.');
      if(o.currency==='EUR') {
        requireThat(provider.european && payment.source===o.payment_method && payment.environment===o.payment_environment,409,'El método o entorno del pago no coincide.');
        const used=one('SELECT order_id FROM ledger WHERE reference=?',`payment-${String(payment.id)}`);
        requireThat(!used || used.order_id===o.id,409,'El ingreso ya está asociado a otro pedido.');
      } else if(!provider.demo) requireThat(String(payment.collector_id)===String(config.collectorId),409,'El beneficiario del pago no coincide.');
      const pid=String(payment.id), paid=['approved','refunded','charged_back'].includes(payment.status);
      if(o.payment_id && o.payment_id!==pid) {
        if(paid) audit(null,'payment.duplicate',o.id,{payment_id:pid});
        return order(o.id);
      }
      if(payment.status==='approved' && o.payment_status==='pending') {
        const items=all('SELECT * FROM order_items WHERE order_id=?',o.id);
        let status='paid';
        if(o.status==='awaiting_payment') {
          for(const i of items)updateBalance(i,-i.quantity,-i.quantity);
        } else if(o.status==='expired') {
          const available=items.every(i=>itemAvailable(i)>=i.quantity);
          if(available)for(const i of items)updateBalance(i,-i.quantity);
          else status='payment_review';
        } else status='payment_review';
        discounts.used(o.id);
        if(status==='paid')for(const i of items)itemMovement(i,-i.quantity,'Venta confirmada',o.id);
        run("UPDATE orders SET status=?,payment_status='approved',payment_id=?,updated_at=? WHERE id=?",status,pid,now(),o.id);
        run("INSERT OR IGNORE INTO ledger(order_id,type,amount,description,reference,created_at) VALUES(?,'income',?,?,?,?)",o.id,o.total,`Venta #${o.number}`,`payment-${pid}`,now());
        event(o.id,status,status==='paid'?'Pago confirmado.':'Pago recibido sin existencias reservadas. Atención al cliente debe gestionar el reembolso.');
        if(payment.source==='bank_transfer')audit(payment.actor_id,'payment.transfer_confirmed',o.id,{environment:o.payment_environment,amount:o.total,receipt_hash:hash(String(payment.bank_reference))});
      }
      // La consulta al proveedor permite recuperar una aprobación no registrada antes de un reembolso.
      if(['refunded','charged_back'].includes(payment.status) && o.payment_status==='pending') {
        if(o.status==='awaiting_payment') release(o,'cancelled','Pago reembolsado antes de la confirmación local.');
        run("UPDATE orders SET payment_id=?,payment_status=?,refunded=?,status='refunded',updated_at=? WHERE id=?",pid,payment.status,o.total,now(),o.id);
        event(o.id,'refunded','Pago devuelto por el proveedor, sin ingreso neto.');
        return order(o.id);
      }
      const current=one('SELECT * FROM orders WHERE id=?',o.id);
      const refunded=payment.status==='charged_back'?o.total:Math.round(Number(payment.transaction_amount_refunded||0)*100);
      requireThat(Number.isSafeInteger(refunded) && refunded>=0 && refunded<=o.total,409,'Reembolso no válido.');
      const full=payment.status==='refunded' || payment.status==='charged_back' || refunded===o.total;
      const refundAmount=full?o.total:refunded;
      if(current.payment_status==='approved' && refundAmount>current.refunded) {
        const delta=refundAmount-current.refunded;
        run("INSERT INTO ledger(order_id,type,amount,description,reference,created_at) VALUES(?,'refund',?,?,?,?)",o.id,-delta,`Reembolso #${o.number}`,`refund-${pid}-${refundAmount}`,now());
        if(full && ['paid','picking','ready'].includes(current.status)) returnStock(current);
        run('UPDATE orders SET refunded=?,payment_status=?,status=?,updated_at=? WHERE id=?',refundAmount,full?'refunded':'approved',full?'refunded':current.status,now(),o.id);
        event(o.id,full?'refunded':current.status,full?'Pago reembolsado.':'Reembolso parcial registrado.');
      }
      return order(o.id);
    });
  }
  function applyTracking(labelId,data) {
    return transaction(db,()=>{
      const o=one('SELECT * FROM orders WHERE label_id=?',labelId);
      requireThat(o,404,'Etiqueta no encontrada.');
      const raw=typeof data.status==='string'?data.status.toLowerCase():'unknown';
      const labels={created:'Etiqueta creada',pending:'Envío pendiente de pago',released:'Envío pagado',generated:'Etiqueta generada',received:'Recibido en el punto de distribución',posted:'Admitido por el transportista',delivered:'Entrega confirmada por el transportista',cancelled:'Etiqueta cancelada',undelivered:'Intento de entrega fallido',paused:'Entrega interrumpida',suspended:'Entrega suspendida'};
      const previous=o.shipping_data?JSON.parse(o.shipping_data):null;
      let status=o.status;
      // Las notificaciones antiguas no hacen que un pedido entregado vuelva al estado enviado.
      if(o.payment_status==='approved' && !o.refunded) {
        if(raw==='posted' && ['paid','picking','ready'].includes(status)) status='shipped';
        if(raw==='delivered' && ['paid','picking','ready','shipped'].includes(status)) status='delivered';
      }
      const tracking=typeof data.tracking==='string'?data.tracking.slice(0,100):o.tracking_code;
      let link=o.tracking_url; if(data.tracking_url) {try{link=safeLink(data.tracking_url);}catch{}}
      const incomingRank={created:0,pending:0,released:1,generated:2,received:3,posted:4,delivered:5};
      const oldRank=incomingRank[previous?.status]??-1,newRank=incomingRank[raw]??-1;
      const summary={status:raw,label:labels[raw]||'Actualización del transportista',tracking,updated_at:now()};
      const keepPrevious=oldRank>newRank && newRank>=0;
      run('UPDATE orders SET status=?,tracking_code=?,tracking_url=?,shipping_data=?,updated_at=? WHERE id=?',status,tracking,link,JSON.stringify(keepPrevious?previous:summary),now(),o.id);
      if(!keepPrevious && previous?.status!==raw) event(o.id,status,summary.label);
      return order(o.id);
    });
  }
  return {
    audit, expire, applyPayment, applyTracking, order, coupons:discounts,
    confirmTransfer(user,id,input) {
      requireThat(permissions[user?.role]?.includes('finance'),403,'Tu perfil no puede confirmar transferencias.');
      requireThat(input && input.confirmed===true,400,'Confirma que has comprobado el ingreso en la cuenta bancaria.');
      const bankReference=text(input.bank_reference,'Referencia bancaria',3,100).toUpperCase();
      requireThat(!/[\u0000-\u001f\u007f]/.test(bankReference),400,'Referencia bancaria no válida.');
      const o=order(id,user,true);
      requireThat(provider.european && o.currency==='EUR' && o.payment_method==='bank_transfer' && o.payment_environment===config.europeCheckout.environment,409,'El pedido no es una transferencia del entorno actual.');
      requireThat(integer(input.amount,'Importe recibido',1)===o.total,409,'El importe recibido debe coincidir con el total del pedido.');
      const paymentId=`bank-${hash(`${o.payment_environment}:${bankReference}`)}`;
      requireThat(o.payment_status==='pending'||o.payment_status==='approved'&&o.payment_id===paymentId,409,'El pedido ya tiene otro ingreso confirmado.');
      return applyPayment({id:paymentId,external_reference:o.id,currency_id:'EUR',transaction_amount:o.total/100,status:'approved',source:'bank_transfer',environment:o.payment_environment,actor_id:user.id,bank_reference:bankReference});
    },
    applyStripeSession(session) {
      const id=session?.metadata?.order_id;
      const o=typeof id==='string'?one('SELECT * FROM orders WHERE id=?',id):null;
      if(!o)return null;
      requireThat(provider.european && o.currency==='EUR' && o.payment_method==='stripe' && o.payment_environment===config.europeCheckout.environment,409,'El método o entorno del pedido no coincide.');
      requireThat(session.id===o.preference_id && session.client_reference_id===o.id && session.currency==='eur' && Number.isSafeInteger(session.amount_total) && session.amount_total===o.total && session.livemode===(o.payment_environment==='live'),409,'La sesión Stripe no coincide con el pedido.');
      if(session.payment_status!=='paid')return order(o.id);
      requireThat(session.status==='complete' && typeof session.payment_intent==='string' && /^pi_[A-Za-z0-9_]+$/.test(session.payment_intent),409,'El pago Stripe no está confirmado.');
      return applyPayment({id:session.payment_intent,external_reference:o.id,currency_id:'EUR',transaction_amount:o.total/100,status:'approved',source:'stripe',environment:o.payment_environment});
    },
    applyStripeRefund(charge,session=null) {
      let o=typeof charge?.payment_intent==='string'?one('SELECT * FROM orders WHERE payment_id=?',charge.payment_intent):null;
      if(!o && typeof charge?.metadata?.order_id==='string')o=one('SELECT * FROM orders WHERE id=?',charge.metadata.order_id);
      if(!o)return null;
      requireThat(provider.european && o.currency==='EUR' && o.payment_method==='stripe' && o.payment_environment===config.europeCheckout.environment,409,'El método o entorno del reembolso no coincide.');
      requireThat(charge.currency==='eur' && charge.amount===o.total && charge.livemode===(o.payment_environment==='live') && Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded>=0 && charge.amount_refunded<=o.total && (!charge.metadata?.order_id||charge.metadata.order_id===o.id),409,'El reembolso Stripe no coincide con el pedido.');
      if(!o.payment_id) {
        requireThat(session,503,'El reembolso requiere conciliar primero la sesión Stripe.');
        requireThat(session.id===o.preference_id && session.client_reference_id===o.id && session.metadata?.order_id===o.id && session.payment_intent===charge.payment_intent && session.currency==='eur' && session.amount_total===o.total && session.livemode===(o.payment_environment==='live') && session.status==='complete' && session.payment_status==='paid',409,'La sesión del reembolso no coincide con el pedido.');
      }
      return applyPayment({id:charge.payment_intent,external_reference:o.id,currency_id:'EUR',transaction_amount:o.total/100,transaction_amount_refunded:charge.amount_refunded/100,status:charge.amount_refunded===o.total?'refunded':'approved',source:'stripe',environment:o.payment_environment});
    },
    products(admin=false) {return admin?all('SELECT *,stock-reserved available FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC').map(adminProduct):all('SELECT * FROM products WHERE active=1 AND deleted_at IS NULL ORDER BY created_at DESC').map(publicProduct);},
    cart,
    setCart(user,id,quantity,variantId=null) {
      integer(quantity,'Cantidad',0,99);expire();
      requireThat(variantId===null||variantId===undefined||typeof variantId==='string',400,'Variante no válida.');
      variantId=variantId||null;
      const p=one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id);requireThat(p,404,'Producto no encontrado.');
      if(quantity) {
        requireThat(p.active,404,'Producto no encontrado.');
        if(p.variants_enabled) {
          requireThat(variantId,400,'Selecciona un color y una talla antes de añadir el producto.');
          const v=one('SELECT * FROM product_variants WHERE id=? AND product_id=? AND active=1 AND deleted_at IS NULL',variantId,id);
          requireThat(v,404,'Variante no encontrada.');requireThat(quantity<=v.stock-v.reserved,409,'Cantidad no disponible para este color y talla.');
        } else {
          requireThat(!variantId,400,'Este producto todavía no tiene variantes.');
          requireThat(quantity<=p.stock-p.reserved,409,'Cantidad no disponible.');
        }
        run('INSERT INTO carts(user_id,product_id,quantity,variant_key,variant_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,product_id,variant_key) DO UPDATE SET quantity=excluded.quantity',user.id,id,quantity,variantId??'',variantId);
      } else run('DELETE FROM carts WHERE user_id=? AND product_id=? AND variant_key=?',user.id,id,variantId??'');
      return cart(user.id);
    },
    async quote(user,postalCode) {
      const destination=provider.european?spanishCheckoutAddress(postalCode):postalCode;
      const destinationKey=provider.european?hash(JSON.stringify(destination)):postalCode;
      expire(); const items=rawCart(user.id); validCart(items); const options=await provider.quote(items,destination);
      const current=rawCart(user.id); validCart(current);
      requireThat(fingerprint(current)===fingerprint(items),409,'El carrito ha cambiado. Vuelve a calcular el envío.');
      requireThat(options.length,422,provider.european?'No hay envíos disponibles para esta dirección.':'No hay envíos disponibles para este código postal brasileño (CEP).');
      const id=randomUUID(); run('INSERT INTO quotes VALUES(?,?,?,?,?,?)',id,user.id,fingerprint(items),destinationKey,JSON.stringify(options),new Date(Date.now()+10*60000).toISOString());
      return {id,options,expires_in:600};
    },
    async checkout(user,input,key) {
      text(key,'Clave de idempotencia',16,100); const a=provider.european?spanishCheckoutAddress(input.address):address(input.address);
      const paymentMethod=provider.european?(input.payment_method||'bank_transfer'):'mercadopago';
      if(provider.european)requireThat(paymentMethod==='bank_transfer'||paymentMethod==='stripe'&&config.stripe?.enabled,400,'Método de pago no disponible.');
      const requestHash=hash(JSON.stringify({quote_id:input.quote_id,service_id:input.service_id,address:a,coupon:input.coupon?String(input.coupon).trim().toUpperCase():null,...(provider.european?{payment_method:paymentMethod}:{})})); expire();
      let o=one('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?',user.id,key);
      if(o) requireThat(o.request_hash===requestHash,409,'La clave ya se ha utilizado en otro checkout.');
      else o=transaction(db,()=>{
        const items=rawCart(user.id); validCart(items);
        const q=one('SELECT * FROM quotes WHERE id=? AND user_id=? AND expires_at>?',input.quote_id,user.id,now());
        requireThat(q && q.fingerprint===fingerprint(items) && q.postal_code===(provider.european?hash(JSON.stringify(a)):a.postal_code),409,'La cotización ha caducado o el carrito ha cambiado. Vuelve a calcular el envío.');
        const service=JSON.parse(q.options).find(s=>s.id===input.service_id); requireThat(service,400,'Envío no válido.');
        const subtotal=items.reduce((s,p)=>s+p.price*p.quantity,0); const coupon=discounts.calculate(user,subtotal,input.coupon); integer(subtotal-coupon.discount+service.price,'Total del pedido',1,100000000);
        const id=randomUUID(), time=now(), number=(one('SELECT MAX(number) n FROM orders').n||1000)+1;
        const minutes=provider.european?(paymentMethod==='bank_transfer'?config.europeCheckout.transferHours*60:35):config.reservationMinutes;
        const until=new Date(Date.now()+minutes*60000).toISOString();
        run("INSERT INTO orders(id,number,user_id,status,subtotal,shipping,total,address,shipping_service,idempotency_key,request_hash,reserved_until,created_at,updated_at) VALUES(?,?,?,'awaiting_payment',?,?,?,?,?,?,?,?,?,?)",id,number,user.id,subtotal,service.price,subtotal-coupon.discount+service.price,JSON.stringify(a),JSON.stringify(service),key,requestHash,until,time,time);
        if(provider.european) {
          const environment=config.europeCheckout.environment;
          const bank=paymentMethod==='bank_transfer'?{...config.europeCheckout.bank,reference:`${environment==='test'?'TEST-':''}EDG-${number}`,due_at:until}:null;
          run('UPDATE orders SET currency=?,payment_method=?,payment_environment=?,bank_transfer_details=? WHERE id=?','EUR',paymentMethod,environment,bank?JSON.stringify(bank):null,id);
        }
        run('UPDATE orders SET discount=?,coupon_code=? WHERE id=?',coupon.discount,coupon.code,id);discounts.reserve(id,user.id,coupon.code);
        for(const p of items) {
          updateBalance(p,0,p.quantity);
          run('INSERT INTO order_items(order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length,fiscal,variant_key,variant_id,selected_color,selected_size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.id,p.sku,p.name,p.price,p.cost,p.quantity,p.weight,p.width,p.height,p.length,p.fiscal,p.variant_id??'',p.variant_id??null,p.selected_color,p.selected_size);
        }
        run('DELETE FROM carts WHERE user_id=?',user.id); event(id,'awaiting_payment','Pedido creado y existencias reservadas.');
        return one('SELECT * FROM orders WHERE id=?',id);
      });
      return this.paymentLink(user,o.id);
    },
    async paymentLink(user,id) {
      expire(); const o=order(id,user); requireThat(o.status==='awaiting_payment',409,'El pedido no está pendiente de pago.');
      if(o.currency==='EUR') {
        requireThat(provider.european && o.payment_environment===config.europeCheckout.environment,409,'Utiliza el entorno original del pedido.');
        if(o.payment_method==='bank_transfer')return o;
        requireThat(o.payment_method==='stripe' && config.stripe?.enabled,503,'El pago con tarjeta no está disponible.');
      }
      if(!o.preference_id) await locked(`payment-${id}`,async()=>{
        const p=await provider.preference(o,o.items,user);
        run('UPDATE orders SET preference_id=?,payment_url=?,updated_at=? WHERE id=?',p.id,p.url,now(),id);
      });
      return order(id,user);
    },
    listOrders(user,manage=false) {
      expire(); return all(`SELECT o.id FROM orders o WHERE ${manage?'1=1':'o.user_id=?'} ORDER BY o.created_at DESC LIMIT 200`,...(manage?[]:[user.id])).map(o=>order(o.id,user,manage));
    },
    cancel(user,id,manage=false) {
      return transaction(db,()=>{const o=order(id,user,manage); requireThat(o.status==='awaiting_payment',409,'Solo se pueden cancelar los pedidos sin pagar.'); release(o,'cancelled','Pedido cancelado; reserva liberada.'); audit(user.id,'order.cancel',id); return order(id,user,manage);});
    },
    demoPay(user,id) {
      requireThat(provider.demo,404,'Operación no disponible.'); expire(); const o=order(id,user);
      requireThat(o.status==='awaiting_payment',409,'El plazo de pago del pedido ha vencido.');
      return applyPayment({id:`demo-${id}`,external_reference:id,currency_id:'BRL',transaction_amount:o.total/100,status:'approved'});
    },
    categories() {return all(`${categoryRows} ORDER BY names.name COLLATE NOCASE`).map(c=>({...categoryImage(c),sizes:categorySizes(c.name),allow_legacy_sizes:!isClothingCategory(c.name)}));},
    saveCategory(user,input) {
      const name=text(input.name,'Categoría',1,80);
      const previous=input.previous===undefined?null:text(input.previous,'Categoría anterior',1,80);
      const hasImage=input.image_id!==undefined;
      return transaction(db,()=>{
        const exists=one(`${categoryRows} WHERE names.name=? COLLATE NOCASE`,name);
        const current=previous?one(`${categoryRows} WHERE names.name=? COLLATE NOCASE`,previous):exists;
        requireThat(!previous || current,404,'Categoría no encontrada.');
        requireThat(!exists || (current?.name===exists.name && (previous || hasImage)),409,'Categoría ya registrada.');
        const imageId=hasImage?input.image_id:current?.image_id??null;
        if(imageId!==null)photoIds(db,[imageId]);
        if(current){
          run('DELETE FROM categories WHERE name=?',current.name);
          if(current.name!==name)run('UPDATE products SET category=? WHERE category=? COLLATE NOCASE AND deleted_at IS NULL',name,current.name);
        }
        run('INSERT INTO categories(name,image_id) VALUES(?,?)',name,imageId);
        audit(user.id,current?(current.name===name?'category.update':'category.rename'):'category.create',name,{previous:current?.name??null,image_id:imageId,previous_image_id:current?.image_id??null});
        return categoryImage({name,image_id:imageId});
      });
    },
    deleteCategory(user,value) {
      const name=text(value,'Categoría',1,80);
      return transaction(db,()=>{
        const category=one(`${categoryRows} WHERE names.name=? COLLATE NOCASE`,name);
        requireThat(category,404,'Categoría no encontrada.');
        requireThat(!one('SELECT id FROM products WHERE category=? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1',category.name),409,'La categoría tiene productos asociados. Mueve o elimina sus productos antes de eliminarla.');
        run('DELETE FROM categories WHERE name=?',category.name);
        audit(user.id,'category.delete',category.name,{name:category.name,image_id:category.image_id});
        return {ok:true,name:category.name};
      });
    },
    saveProduct(user,input,id=null) {
      const p={sku:text(input.sku,'SKU',1,50),name:text(input.name,'Nombre',2,120),description:text(input.description,'Descripción',1,2000),category:text(input.category,'Categoría',1,80),price:integer(input.price,'Precio en céntimos',1),cost:integer(input.cost,'Coste en céntimos'),low_stock:integer(input.low_stock,'Existencias mínimas',0,10000),weight:positive(input.weight,'Peso'),width:positive(input.width,'Anchura'),height:positive(input.height,'Altura'),length:positive(input.length,'Longitud'),color:text(input.color,'Color',7,7),icon:text(input.icon,'Símbolo',1,8),active:input.active===false?0:1};
      if(input.images!==undefined)p.images=photoIds(db,input.images);
      if(input.fiscal!==undefined)p.fiscal=JSON.stringify(fiscalFields(input.fiscal));
      requireThat(/^#[a-fA-F0-9]{6}$/.test(p.color),400,'Color no válido.');
      requireThat(!one('SELECT id FROM products WHERE sku=? AND id!=?',p.sku,id||'')&&!one('SELECT id FROM product_variants WHERE sku=?',p.sku),409,'SKU ya registrado.');
      return transaction(db,()=>{
        const current=id?one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id):null;
        requireThat(!id || current,404,'Producto no encontrado.');
        const sizes=productSizesForSave(input,p.category,current);
        p.sizes=JSON.stringify(sizes);p.size=sizes[0]||'';
        run('INSERT OR IGNORE INTO categories(name) VALUES(?)',p.category);
        if(id) {run(`UPDATE products SET ${Object.keys(p).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(p),id);}
        else {id=randomUUID(); run(`INSERT INTO products(id,${Object.keys(p).join(',')},created_at) VALUES(${Array(Object.keys(p).length+2).fill('?').join(',')})`,id,...Object.values(p),now());}
        const updated=one('SELECT * FROM products WHERE id=?',id);
        const legacyEcho=input.variants_enabled===false&&!current?.variants_enabled&&Array.isArray(input.variants)&&input.variants.length===0;
        if(input.variants!==undefined&&!legacyEcho)variants.save(user,updated,input.variants,current);
        else if(current?.variants_enabled)requireThat(variants.rows(id).every(v=>!v.active||(sizes.length?sizes.includes(v.size):v.size==='')),409,'Actualiza también las variantes al cambiar las tallas.');
        audit(user.id,'product.save',id); return adminProduct(one('SELECT * FROM products WHERE id=?',id));
      });
    },
    deleteProduct(user,id) {
      return transaction(db,()=>{
        const p=one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id);
        requireThat(p,404,'Producto no encontrado.');
        const deletedAt=now();
        run('UPDATE products SET active=0,deleted_at=? WHERE id=?',deletedAt,id);
        run('DELETE FROM carts WHERE product_id=?',id);
        const inventory=variants.serialize(p,true);
        audit(user.id,'product.delete',id,{sku:p.sku,name:p.name,category:p.category,stock:inventory.stock,reserved:inventory.reserved,unallocated_stock:inventory.unallocated_stock,variants:inventory.variants.map(v=>({id:v.id,sku:v.sku,stock:v.stock,reserved:v.reserved})),deleted_at:deletedAt});
        return {ok:true,id};
      });
    },
    stock(user,id,delta,reason) {
      integer(delta,'Variación',-100000,100000); requireThat(delta!==0,400,'Introduce una variación distinta de cero.'); text(reason,'Motivo',3,250);
      return transaction(db,()=>{const p=one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id); requireThat(p,404,'Producto no encontrado.');requireThat(!p.variants_enabled,409,'Selecciona la combinación de color y talla para ajustar sus existencias.'); requireThat(p.stock+delta>=p.reserved,409,'El ajuste no puede consumir existencias reservadas.');
        run('UPDATE products SET stock=stock+? WHERE id=?',delta,id); run('INSERT INTO movements(product_id,quantity,reason,actor_id,created_at) VALUES(?,?,?,?,?)',id,delta,reason,user.id,now()); audit(user.id,'stock.adjust',id,{delta,reason}); return adminProduct(one('SELECT * FROM products WHERE id=?',id));});
    },
    variantStock(user,id,variantId,delta,reason) {
      return transaction(db,()=>{const p=one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id);requireThat(p,404,'Producto no encontrado.');variants.adjust(user,p,variantId,delta,reason);return adminProduct(one('SELECT * FROM products WHERE id=?',id));});
    },
    allocateVariants(user,id,allocations,reason) {
      return transaction(db,()=>{const p=one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',id);requireThat(p,404,'Producto no encontrado.');variants.allocate(user,p,allocations,reason);return adminProduct(one('SELECT * FROM products WHERE id=?',id));});
    },
    movements() {return all('SELECT m.*,p.name product_name,v.sku variant_sku,u.name actor_name FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN product_variants v ON v.id=m.variant_id LEFT JOIN users u ON u.id=m.actor_id ORDER BY m.id DESC LIMIT 200');},
    status(user,id,status,input={}) {
      return transaction(db,()=>{const o=order(id,user,true);
        const allowed={paid:['picking'],picking:['ready'],ready:['shipped'],shipped:['delivered']};
        requireThat(o.payment_status==='approved' && o.refunded===0 && allowed[o.status]?.includes(status),409,'Transición no permitida para este pedido.');
        if(status==='shipped'){const note=one('SELECT status,environment FROM invoices WHERE order_id=?',id);if(note)requireThat(note.status==='authorized' && (config.mode==='demo'||note.environment==='production'),409,'El envío requiere una NF-e autorizada en el entorno correcto.');}
        if(status==='shipped') run('UPDATE orders SET tracking_code=?,tracking_url=? WHERE id=?',text(input.tracking_code,'Seguimiento',3,100),safeLink(input.tracking_url),id);
        run('UPDATE orders SET status=?,updated_at=? WHERE id=?',status,now(),id); event(id,status,{picking:'Preparación iniciada.',ready:'Pedido embalado y listo para enviar.',shipped:'Pedido enviado al transportista.',delivered:'Entrega confirmada.'}[status]); audit(user.id,'order.status',id,{status}); return order(id,user,true);});
    },
    async refund(user,id) {
      return locked(`refund-${id}`,async()=>{
        const o=order(id,user,true); requireThat(o.payment_status==='approved',409,'El pago no está aprobado.');
        if(o.currency==='EUR') {
          requireThat(permissions[user?.role]?.includes('finance'),403,'Tu perfil no puede reembolsar pagos.');
          requireThat(provider.european && o.payment_method==='stripe' && o.payment_environment===config.europeCheckout.environment,409,'Las transferencias deben devolverse y conciliarse desde el banco.');
          const result=await provider.refund(o);audit(user.id,'payment.refund_requested',id,{environment:o.payment_environment});
          requireThat(result.payment_intent===o.payment_id && result.currency==='eur' && result.amount===o.total-o.refunded,502,'El reembolso recibido no coincide con el pedido.');
          if(result.status!=='succeeded')return order(id,user,true);
          return applyPayment({id:o.payment_id,external_reference:o.id,currency_id:'EUR',transaction_amount:o.total/100,transaction_amount_refunded:o.total/100,status:'refunded',source:'stripe',environment:o.payment_environment});
        }
        if(provider.demo) return applyPayment({id:o.payment_id,external_reference:id,currency_id:'BRL',transaction_amount:o.total/100,status:'refunded',transaction_amount_refunded:o.total/100});
        await provider.refund(o); audit(user.id,'payment.refund_requested',id); return applyPayment(await provider.payment(o.payment_id));
      });
    },
    async label(user,id,action,input={}) {
      return locked(`label-${id}`,async()=>{
        const o=order(id,user,true); requireThat(['paid','picking','ready'].includes(o.status) && o.payment_status==='approved' && !o.refunded,409,'No se puede generar una etiqueta para este pedido.');
        requireThat(o.currency!=='EUR',409,'Prepara el envío europeo desde el módulo Sendcloud con las medidas del paquete embalado.');
        if(action==='create') {
          requireThat(!o.label_id,409,'El pedido ya tiene una etiqueta.');
          const issued=one('SELECT invoice_key,status,environment FROM invoices WHERE order_id=?',id);
          if(issued) requireThat(issued.status==='authorized' && issued.environment==='production',409,'La etiqueta real requiere una NF-e autorizada en producción.');
          input.invoice_key=issued?.invoice_key||input.invoice_key;
          requireThat(/^\d{44}$/.test(input.invoice_key||''),400,'Introduce la clave de 44 dígitos de la NF-e.');
          const labelId=await provider.createLabel({...o,address:JSON.stringify(o.address),shipping_service:JSON.stringify(o.shipping_service)},o.items,input.invoice_key);
          run('UPDATE orders SET label_id=?,updated_at=? WHERE id=?',labelId,now(),id);
        } else {
          requireThat(o.label_id,409,'Crea primero la etiqueta.');
          if(action==='buy') {await provider.buyLabel(o.label_id); event(id,o.status,'Compra del envío solicitada a Melhor Envio.');}
          else if(action==='print') {const url=await provider.printLabel(o.label_id); run('UPDATE orders SET label_url=? WHERE id=?',url,id);}
          else throw new HttpError(400,'Acción de etiqueta no válida.');
        }
        audit(user.id,`shipping.label.${action}`,id); return order(id,user,true);
      });
    },
    async syncTracking(user,id) {
      const o=order(id,user,true); requireThat(o.label_id,409,'Introduce una etiqueta integrada para consultar al proveedor.');
      const data=await provider.tracking(o.label_id); const item=data[o.label_id] || data.data?.[o.label_id]; requireThat(item && item.status,502,'Respuesta de seguimiento no válida.'); const updated=applyTracking(o.label_id,item); audit(user.id,'shipping.sync',id); return {order:updated,tracking:JSON.parse(updated.shipping_data)};
    },
    dashboard(user) {
      expire(); const financial=['admin','finance'].includes(user.role);
      const products=all('SELECT * FROM products WHERE deleted_at IS NULL').map(adminProduct);
      const alerts=products.filter(p=>p.active).flatMap(p=>p.variants_enabled?p.variants.filter(v=>v.active&&v.available<=v.low_stock).map(v=>({...v,id:p.id,variant_id:v.id,name:`${p.name} · ${v.color_name}${v.size?' · '+v.size:''}`})):p.available<=p.low_stock?[{id:p.id,name:p.name,stock:p.stock,reserved:p.reserved,available:p.available,low_stock:p.low_stock}]:[]);
      const metrics={products:products.filter(p=>p.active).length,low_stock:alerts.length,orders:one('SELECT COUNT(*) n FROM orders').n,to_ship:one("SELECT COUNT(*) n FROM orders WHERE status IN ('paid','picking','ready')").n};
      if(financial)Object.assign(metrics,{net_revenue:one('SELECT COALESCE(SUM(amount),0) n FROM ledger').n,pending:one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='awaiting_payment'").n,inventory_cost:products.reduce((sum,p)=>sum+p.cost*p.stock,0)});
      return {metrics,recent_orders:this.listOrders(user,true).slice(0,6),alerts,revenue:financial?all("SELECT substr(created_at,1,10) day,SUM(amount) amount FROM ledger GROUP BY day ORDER BY day DESC LIMIT 14"):[]};
    },
    ledger() {return all('SELECT * FROM ledger ORDER BY id DESC LIMIT 500');},
    expense(user,input,key) {
      integer(input.amount,'Importe en céntimos',1); text(input.description,'Descripción',3,250); text(key,'Clave',16,100);
      const ref=`expense-${key}`; const existing=one('SELECT * FROM ledger WHERE reference=?',ref);
      if(existing) {requireThat(existing.amount===-input.amount && existing.description===input.description,409,'Clave ya utilizada.'); return existing;}
      run("INSERT INTO ledger(type,amount,description,reference,created_at) VALUES('expense',?,?,?,?)",-input.amount,input.description,ref,now()); audit(user.id,'finance.expense',ref); return one('SELECT * FROM ledger WHERE reference=?',ref);
    },
    audits() {return all('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200');}
  };
}
