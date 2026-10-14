import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { coupons } from './coupons.mjs';
import { photoIds } from './media.mjs';
import { requireThat, HttpError, text, integer, positive, hash, now, address, safeLink, fiscalFields } from './security.mjs';
export function commerce(db,config,provider) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const event=(id,status,message)=>run('INSERT INTO order_events(order_id,status,message,created_at) VALUES(?,?,?,?)',id,status,message,now());
  const audit=(actor,action,id,details={})=>run('INSERT INTO audit(actor_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?)',actor,action,id,JSON.stringify(details),now());
  const discounts=coupons(db,audit);
  const locks=new Set();
  async function locked(key,fn) {
    requireThat(!locks.has(key),409,'Uma operação está em andamento para este pedido. Aguarde e tente novamente.');
    locks.add(key); try{return await fn();}finally{locks.delete(key);}
  }
  function cart(userId) {
    const items=all('SELECT p.*,c.quantity FROM carts c JOIN products p ON p.id=c.product_id WHERE user_id=? ORDER BY p.id',userId);
    return {items:items.map(p=>({...publicProduct(p),quantity:p.quantity,active:p.active})),subtotal:items.reduce((s,p)=>s+p.price*p.quantity,0)};
  }
  function rawCart(userId) {return all('SELECT p.*,c.quantity FROM carts c JOIN products p ON p.id=c.product_id WHERE user_id=? ORDER BY p.id',userId);}
  function fingerprint(items) {return hash(JSON.stringify(items.map(p=>[p.id,p.price,p.quantity,p.active,p.weight,p.width,p.height,p.length])));}
  function validCart(items) {requireThat(items.length>0 && items.length<=100,400,'O carrinho está vazio ou excede o limite.'); for(const p of items) requireThat(p.active && p.stock-p.reserved>=p.quantity,409,`Estoque insuficiente para ${p.name}.`);}
  function publicProduct(p) {return {id:p.id,sku:p.sku,name:p.name,description:p.description,category:p.category,price:p.price,available:p.stock-p.reserved,color:p.color,icon:p.icon,images:JSON.parse(p.images).map(id=>`/media/${id}.jpg`)};}
  function order(id,user=null,manage=false) {
    const o=one('SELECT o.*,u.name customer_name,u.email customer_email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?',id);
    requireThat(o && (manage || !user || o.user_id===user.id),404,'Pedido não encontrado.');
    return {...o,address:JSON.parse(o.address),shipping_service:JSON.parse(o.shipping_service),items:all('SELECT * FROM order_items WHERE order_id=?',id),events:all('SELECT * FROM order_events WHERE order_id=? ORDER BY id',id)};
  }
  function release(o,status,message) {
    for(const item of all('SELECT * FROM order_items WHERE order_id=?',o.id)) run('UPDATE products SET reserved=reserved-? WHERE id=?',item.quantity,item.product_id);
    discounts.release(o.id);
    run('UPDATE orders SET status=?,updated_at=? WHERE id=?',status,now(),o.id); event(o.id,status,message);
  }
  function expire() {
    transaction(db,()=>{
      for(const o of all("SELECT * FROM orders WHERE status='awaiting_payment' AND reserved_until<=?",now())) release(o,'expired','Prazo de pagamento encerrado; reserva de estoque liberada.');
      run('DELETE FROM sessions WHERE expires_at<=?',now()); run('DELETE FROM quotes WHERE expires_at<=?',now());
    });
  }
  function returnStock(o) {
    for(const item of all('SELECT * FROM order_items WHERE order_id=?',o.id)) {
      run('UPDATE products SET stock=stock+? WHERE id=?',item.quantity,item.product_id);
      run('INSERT INTO movements(product_id,quantity,reason,reference,created_at) VALUES(?,?,?,?,?)',item.product_id,item.quantity,'Estorno antes da expedição',o.id,now());
    }
  }
  function applyPayment(payment) {
    return transaction(db,()=>{
      const o=one('SELECT * FROM orders WHERE id=?',String(payment.external_reference));
      requireThat(o,404,'Pedido não encontrado.');
      requireThat(payment.currency_id==='BRL' && Math.round(Number(payment.transaction_amount)*100)===o.total,409,'Valor ou moeda do pagamento divergente.');
      if(!provider.demo) requireThat(String(payment.collector_id)===String(config.collectorId),409,'Recebedor do pagamento divergente.');
      const pid=String(payment.id), paid=['approved','refunded','charged_back'].includes(payment.status);
      if(o.payment_id && o.payment_id!==pid) {
        if(paid) audit(null,'payment.duplicate',o.id,{payment_id:pid});
        return order(o.id);
      }
      if(payment.status==='approved' && o.payment_status==='pending') {
        const items=all('SELECT * FROM order_items WHERE order_id=?',o.id);
        let status='paid';
        if(o.status==='awaiting_payment') {
          for(const i of items) run('UPDATE products SET stock=stock-?,reserved=reserved-? WHERE id=?',i.quantity,i.quantity,i.product_id);
        } else if(o.status==='expired') {
          const available=items.every(i=>one('SELECT stock-reserved available FROM products WHERE id=?',i.product_id).available>=i.quantity);
          if(available) for(const i of items) run('UPDATE products SET stock=stock-? WHERE id=?',i.quantity,i.product_id);
          else status='payment_review';
        } else status='payment_review';
        discounts.used(o.id);
        if(status==='paid') for(const i of items) run('INSERT INTO movements(product_id,quantity,reason,reference,created_at) VALUES(?,?,?,?,?)',i.product_id,-i.quantity,'Venda confirmada',o.id,now());
        run("UPDATE orders SET status=?,payment_status='approved',payment_id=?,updated_at=? WHERE id=?",status,pid,now(),o.id);
        run("INSERT OR IGNORE INTO ledger(order_id,type,amount,description,reference,created_at) VALUES(?,'income',?,?,?,?)",o.id,o.total,`Venda #${o.number}`,`payment-${pid}`,now());
        event(o.id,status,status==='paid'?'Pagamento confirmado.':'Pagamento recebido sem reserva disponível. Atendimento deve providenciar estorno.');
      }
      // Consulta canônica permite recuperar aprovação perdida antes de um estorno.
      if(['refunded','charged_back'].includes(payment.status) && o.payment_status==='pending') {
        if(o.status==='awaiting_payment') release(o,'cancelled','Pagamento estornado antes da confirmação local.');
        run("UPDATE orders SET payment_id=?,payment_status=?,refunded=?,status='refunded',updated_at=? WHERE id=?",pid,payment.status,o.total,now(),o.id);
        event(o.id,'refunded','Pagamento devolvido pelo provedor, sem receita líquida.');
        return order(o.id);
      }
      const current=one('SELECT * FROM orders WHERE id=?',o.id);
      const refunded=payment.status==='charged_back'?o.total:Math.round(Number(payment.transaction_amount_refunded||0)*100);
      requireThat(Number.isSafeInteger(refunded) && refunded>=0 && refunded<=o.total,409,'Estorno inválido.');
      const full=payment.status==='refunded' || payment.status==='charged_back' || refunded===o.total;
      const refundAmount=full?o.total:refunded;
      if(current.payment_status==='approved' && refundAmount>current.refunded) {
        const delta=refundAmount-current.refunded;
        run("INSERT INTO ledger(order_id,type,amount,description,reference,created_at) VALUES(?,'refund',?,?,?,?)",o.id,-delta,`Estorno #${o.number}`,`refund-${pid}-${refundAmount}`,now());
        if(full && ['paid','picking','ready'].includes(current.status)) returnStock(current);
        run('UPDATE orders SET refunded=?,payment_status=?,status=?,updated_at=? WHERE id=?',refundAmount,full?'refunded':'approved',full?'refunded':current.status,now(),o.id);
        event(o.id,full?'refunded':current.status,full?'Pagamento estornado.':'Estorno parcial registrado.');
      }
      return order(o.id);
    });
  }
  function applyTracking(labelId,data) {
    return transaction(db,()=>{
      const o=one('SELECT * FROM orders WHERE label_id=?',labelId);
      requireThat(o,404,'Etiqueta não encontrada.');
      const raw=typeof data.status==='string'?data.status.toLowerCase():'unknown';
      const labels={created:'Etiqueta criada',pending:'Frete pendente',released:'Frete pago',generated:'Etiqueta gerada',received:'Recebido no ponto de distribuição',posted:'Postado na transportadora',delivered:'Entrega confirmada pela transportadora',cancelled:'Etiqueta cancelada',undelivered:'Tentativa de entrega sem sucesso',paused:'Entrega interrompida',suspended:'Entrega suspensa'};
      const previous=o.shipping_data?JSON.parse(o.shipping_data):null;
      let status=o.status;
      // Notificações antigas não fazem um pedido entregue voltar para enviado.
      if(o.payment_status==='approved' && !o.refunded) {
        if(raw==='posted' && ['paid','picking','ready'].includes(status)) status='shipped';
        if(raw==='delivered' && ['paid','picking','ready','shipped'].includes(status)) status='delivered';
      }
      const tracking=typeof data.tracking==='string'?data.tracking.slice(0,100):o.tracking_code;
      let link=o.tracking_url; if(data.tracking_url) {try{link=safeLink(data.tracking_url);}catch{}}
      const incomingRank={created:0,pending:0,released:1,generated:2,received:3,posted:4,delivered:5};
      const oldRank=incomingRank[previous?.status]??-1,newRank=incomingRank[raw]??-1;
      const summary={status:raw,label:labels[raw]||'Atualização da transportadora',tracking,updated_at:now()};
      const keepPrevious=oldRank>newRank && newRank>=0;
      run('UPDATE orders SET status=?,tracking_code=?,tracking_url=?,shipping_data=?,updated_at=? WHERE id=?',status,tracking,link,JSON.stringify(keepPrevious?previous:summary),now(),o.id);
      if(!keepPrevious && previous?.status!==raw) event(o.id,status,summary.label);
      return order(o.id);
    });
  }
  return {
    audit, expire, applyPayment, applyTracking, order, coupons:discounts,
    products(admin=false) {return admin?all('SELECT *,stock-reserved available FROM products ORDER BY created_at DESC'):all('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC').map(publicProduct);},
    cart,
    setCart(user,id,quantity) {
      integer(quantity,'Quantidade',0,99); expire();
      const p=one('SELECT * FROM products WHERE id=? AND active=1',id); requireThat(p,404,'Produto não encontrado.');
      requireThat(!quantity || quantity<=p.stock-p.reserved,409,'Quantidade indisponível.');
      if(quantity) run('INSERT INTO carts VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity',user.id,id,quantity);
      else run('DELETE FROM carts WHERE user_id=? AND product_id=?',user.id,id);
      return cart(user.id);
    },
    async quote(user,postalCode) {
      expire(); const items=rawCart(user.id); validCart(items); const options=await provider.quote(items,postalCode);
      requireThat(options.length,422,'Não há fretes disponíveis para este CEP.');
      const id=randomUUID(); run('INSERT INTO quotes VALUES(?,?,?,?,?,?)',id,user.id,fingerprint(items),postalCode,JSON.stringify(options),new Date(Date.now()+10*60000).toISOString());
      return {id,options,expires_in:600};
    },
    async checkout(user,input,key) {
      text(key,'Chave de idempotência',16,100); const a=address(input.address);
      const requestHash=hash(JSON.stringify({quote_id:input.quote_id,service_id:input.service_id,address:a,coupon:input.coupon?String(input.coupon).trim().toUpperCase():null})); expire();
      let o=one('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?',user.id,key);
      if(o) requireThat(o.request_hash===requestHash,409,'Chave já utilizada para outro checkout.');
      else o=transaction(db,()=>{
        const items=rawCart(user.id); validCart(items);
        const q=one('SELECT * FROM quotes WHERE id=? AND user_id=? AND expires_at>?',input.quote_id,user.id,now());
        requireThat(q && q.fingerprint===fingerprint(items) && q.postal_code===a.postal_code,409,'Cotação expirada ou carrinho alterado. Calcule o frete novamente.');
        const service=JSON.parse(q.options).find(s=>s.id===input.service_id); requireThat(service,400,'Frete inválido.');
        const subtotal=items.reduce((s,p)=>s+p.price*p.quantity,0); const coupon=discounts.calculate(user,subtotal,input.coupon); integer(subtotal-coupon.discount+service.price,'Total do pedido',1,100000000);
        const id=randomUUID(), time=now(), number=(one('SELECT MAX(number) n FROM orders').n||1000)+1;
        const until=new Date(Date.now()+config.reservationMinutes*60000).toISOString();
        run("INSERT INTO orders(id,number,user_id,status,subtotal,shipping,total,address,shipping_service,idempotency_key,request_hash,reserved_until,created_at,updated_at) VALUES(?,?,?,'awaiting_payment',?,?,?,?,?,?,?,?,?,?)",id,number,user.id,subtotal,service.price,subtotal-coupon.discount+service.price,JSON.stringify(a),JSON.stringify(service),key,requestHash,until,time,time);
        run('UPDATE orders SET discount=?,coupon_code=? WHERE id=?',coupon.discount,coupon.code,id);discounts.reserve(id,user.id,coupon.code);
        for(const p of items) {
          run('UPDATE products SET reserved=reserved+? WHERE id=?',p.quantity,p.id);
          run('INSERT INTO order_items(order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length,fiscal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,p.id,p.sku,p.name,p.price,p.cost,p.quantity,p.weight,p.width,p.height,p.length,p.fiscal);
        }
        run('DELETE FROM carts WHERE user_id=?',user.id); event(id,'awaiting_payment','Pedido criado e estoque reservado.');
        return one('SELECT * FROM orders WHERE id=?',id);
      });
      return this.paymentLink(user,o.id);
    },
    async paymentLink(user,id) {
      expire(); const o=order(id,user); requireThat(o.status==='awaiting_payment',409,'Pedido não está aguardando pagamento.');
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
      return transaction(db,()=>{const o=order(id,user,manage); requireThat(o.status==='awaiting_payment',409,'Somente pedidos sem pagamento podem ser cancelados.'); release(o,'cancelled','Pedido cancelado; reserva liberada.'); audit(user.id,'order.cancel',id); return order(id,user,manage);});
    },
    demoPay(user,id) {
      requireThat(provider.demo,404,'Operação indisponível.'); expire(); const o=order(id,user);
      requireThat(o.status==='awaiting_payment',409,'Pedido fora do prazo de pagamento.');
      return applyPayment({id:`demo-${id}`,external_reference:id,currency_id:'BRL',transaction_amount:o.total/100,status:'approved'});
    },
    saveProduct(user,input,id=null) {
      const p={sku:text(input.sku,'SKU',1,50),name:text(input.name,'Nome',2,120),description:text(input.description,'Descrição',1,2000),category:text(input.category,'Categoria',1,80),price:integer(input.price,'Preço em centavos',1),cost:integer(input.cost,'Custo em centavos'),low_stock:integer(input.low_stock,'Estoque mínimo',0,10000),weight:positive(input.weight,'Peso'),width:positive(input.width,'Largura'),height:positive(input.height,'Altura'),length:positive(input.length,'Comprimento'),color:text(input.color,'Cor',7,7),icon:text(input.icon,'Símbolo',1,8),active:input.active===false?0:1};
      if(input.images!==undefined)p.images=photoIds(db,input.images);
      if(input.fiscal!==undefined)p.fiscal=JSON.stringify(fiscalFields(input.fiscal));
      requireThat(/^#[a-fA-F0-9]{6}$/.test(p.color),400,'Cor inválida.');
      requireThat(!one('SELECT id FROM products WHERE sku=? AND id!=?',p.sku,id||''),409,'SKU já cadastrado.');
      return transaction(db,()=>{
        if(id) {requireThat(one('SELECT id FROM products WHERE id=?',id),404,'Produto não encontrado.'); run(`UPDATE products SET ${Object.keys(p).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(p),id);}
        else {id=randomUUID(); run(`INSERT INTO products(id,${Object.keys(p).join(',')},created_at) VALUES(${Array(Object.keys(p).length+2).fill('?').join(',')})`,id,...Object.values(p),now());}
        audit(user.id,'product.save',id); return one('SELECT * FROM products WHERE id=?',id);
      });
    },
    stock(user,id,delta,reason) {
      integer(delta,'Variação',-100000,100000); requireThat(delta!==0,400,'Informe uma variação diferente de zero.'); text(reason,'Motivo',3,250);
      return transaction(db,()=>{const p=one('SELECT * FROM products WHERE id=?',id); requireThat(p,404,'Produto não encontrado.'); requireThat(p.stock+delta>=p.reserved,409,'O ajuste não pode consumir estoque reservado.');
        run('UPDATE products SET stock=stock+? WHERE id=?',delta,id); run('INSERT INTO movements(product_id,quantity,reason,actor_id,created_at) VALUES(?,?,?,?,?)',id,delta,reason,user.id,now()); audit(user.id,'stock.adjust',id,{delta,reason}); return one('SELECT * FROM products WHERE id=?',id);});
    },
    movements() {return all('SELECT m.*,p.name product_name,u.name actor_name FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.actor_id ORDER BY m.id DESC LIMIT 200');},
    status(user,id,status,input={}) {
      return transaction(db,()=>{const o=order(id,user,true);
        const allowed={paid:['picking'],picking:['ready'],ready:['shipped'],shipped:['delivered']};
        requireThat(o.payment_status==='approved' && o.refunded===0 && allowed[o.status]?.includes(status),409,'Transição não permitida para este pedido.');
        if(status==='shipped'){const note=one('SELECT status,environment FROM invoices WHERE order_id=?',id);if(note)requireThat(note.status==='authorized' && (config.mode==='demo'||note.environment==='production'),409,'O envio exige nota autorizada no ambiente correto.');}
        if(status==='shipped') run('UPDATE orders SET tracking_code=?,tracking_url=? WHERE id=?',text(input.tracking_code,'Rastreio',3,100),safeLink(input.tracking_url),id);
        run('UPDATE orders SET status=?,updated_at=? WHERE id=?',status,now(),id); event(id,status,{picking:'Separação iniciada.',ready:'Pedido embalado e pronto para envio.',shipped:'Pedido enviado à transportadora.',delivered:'Entrega confirmada.'}[status]); audit(user.id,'order.status',id,{status}); return order(id,user,true);});
    },
    async refund(user,id) {
      return locked(`refund-${id}`,async()=>{
        const o=order(id,user,true); requireThat(o.payment_status==='approved',409,'Pagamento não está aprovado.');
        if(provider.demo) return applyPayment({id:o.payment_id,external_reference:id,currency_id:'BRL',transaction_amount:o.total/100,status:'refunded',transaction_amount_refunded:o.total/100});
        await provider.refund(o); audit(user.id,'payment.refund_requested',id); return applyPayment(await provider.payment(o.payment_id));
      });
    },
    async label(user,id,action,input={}) {
      return locked(`label-${id}`,async()=>{
        const o=order(id,user,true); requireThat(['paid','picking','ready'].includes(o.status) && o.payment_status==='approved' && !o.refunded,409,'Pedido indisponível para etiqueta.');
        if(action==='create') {
          requireThat(!o.label_id,409,'Pedido já tem etiqueta.');
          const issued=one('SELECT invoice_key,status,environment FROM invoices WHERE order_id=?',id);
          if(issued) requireThat(issued.status==='authorized' && issued.environment==='production',409,'A etiqueta real exige NF-e autorizada em produção.');
          input.invoice_key=issued?.invoice_key||input.invoice_key;
          requireThat(/^\d{44}$/.test(input.invoice_key||''),400,'Informe a chave de 44 dígitos da NF-e.');
          const labelId=await provider.createLabel({...o,address:JSON.stringify(o.address),shipping_service:JSON.stringify(o.shipping_service)},o.items,input.invoice_key);
          run('UPDATE orders SET label_id=?,updated_at=? WHERE id=?',labelId,now(),id);
        } else {
          requireThat(o.label_id,409,'Crie a etiqueta primeiro.');
          if(action==='buy') {await provider.buyLabel(o.label_id); event(id,o.status,'Compra do frete solicitada ao Melhor Envio.');}
          else if(action==='print') {const url=await provider.printLabel(o.label_id); run('UPDATE orders SET label_url=? WHERE id=?',url,id);}
          else throw new HttpError(400,'Ação de etiqueta inválida.');
        }
        audit(user.id,`shipping.label.${action}`,id); return order(id,user,true);
      });
    },
    async syncTracking(user,id) {
      const o=order(id,user,true); requireThat(o.label_id,409,'Informe uma etiqueta integrada para consultar o provedor.');
      const data=await provider.tracking(o.label_id); const item=data[o.label_id] || data.data?.[o.label_id]; requireThat(item && item.status,502,'Retorno de rastreio inválido.'); const updated=applyTracking(o.label_id,item); audit(user.id,'shipping.sync',id); return {order:updated,tracking:JSON.parse(updated.shipping_data)};
    },
    dashboard(user) {
      expire(); const financial=['admin','finance'].includes(user.role);
      const metrics={products:one('SELECT COUNT(*) n FROM products WHERE active=1').n,low_stock:one('SELECT COUNT(*) n FROM products WHERE active=1 AND stock-reserved<=low_stock').n,orders:one('SELECT COUNT(*) n FROM orders').n,to_ship:one("SELECT COUNT(*) n FROM orders WHERE status IN ('paid','picking','ready')").n};
      if(financial) Object.assign(metrics,{net_revenue:one('SELECT COALESCE(SUM(amount),0) n FROM ledger').n,pending:one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='awaiting_payment'").n,inventory_cost:one('SELECT COALESCE(SUM(cost*stock),0) n FROM products').n});
      return {metrics,recent_orders:this.listOrders(user,true).slice(0,6),alerts:all('SELECT id,name,stock,reserved,stock-reserved available,low_stock FROM products WHERE active=1 AND stock-reserved<=low_stock'),revenue:financial?all("SELECT substr(created_at,1,10) day,SUM(amount) amount FROM ledger GROUP BY day ORDER BY day DESC LIMIT 14"):[]};
    },
    ledger() {return all('SELECT * FROM ledger ORDER BY id DESC LIMIT 500');},
    expense(user,input,key) {
      integer(input.amount,'Valor em centavos',1); text(input.description,'Descrição',3,250); text(key,'Chave',16,100);
      const ref=`expense-${key}`; const existing=one('SELECT * FROM ledger WHERE reference=?',ref);
      if(existing) {requireThat(existing.amount===-input.amount && existing.description===input.description,409,'Chave já utilizada.'); return existing;}
      run("INSERT INTO ledger(type,amount,description,reference,created_at) VALUES('expense',?,?,?,?)",-input.amount,input.description,ref,now()); audit(user.id,'finance.expense',ref); return one('SELECT * FROM ledger WHERE reference=?',ref);
    },
    audits() {return all('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200');}
  };
}
