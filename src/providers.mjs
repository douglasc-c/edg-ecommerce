import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, requireThat, safeLink, allocateCents } from './security.mjs';
const itemDescription=item=>[item.name,item.selected_color,item.selected_size].filter(Boolean).join(' · ');
export function providers(config, fetcher=fetch) {
  const demo=config.mode==='demo';
  async function request(base,path,body,token,extra={},method='POST') {
    let response;
    try {response=await fetcher(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json',...extra},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}catch {throw new HttpError(502,'El proveedor no está disponible. Inténtalo de nuevo.');}
    requireThat(response.ok,502,`El proveedor ha rechazado la solicitud (${response.status}). Revisa las credenciales y los datos en el panel del proveedor.`);
    try {return await response.json();}catch {throw new HttpError(502,'Respuesta no válida del proveedor.');}
  }
  const mp=(path,body,extra={},method='POST')=>request('https://api.mercadopago.com',path,body,config.mpToken,extra,method);
  const me=(path,body)=>request(config.meSandbox?'https://sandbox.melhorenvio.com.br':'https://www.melhorenvio.com.br','/api/v2/me'+path,body,config.meToken,{'User-Agent':`EDG Commerce (${config.supportEmail})`});
  return {
    demo,
    async quote(items, postalCode) {
      if(demo) return [
        {id:'demo-standard',name:'Envío estándar · simulación',price:1990,days:7,packages:[]},
        {id:'demo-express',name:'Envío exprés · simulación',price:3490,days:3,packages:[]}
      ];
      requireThat(config.meToken && config.originPostal && config.supportEmail,503,'Configura Melhor Envio, el correo de asistencia y el código postal brasileño (CEP) de origen.');
      const data=await me('/shipment/calculate',{from:{postal_code:config.originPostal},to:{postal_code:postalCode},products:items.map(p=>({id:p.variant_id||p.id,width:p.width,height:p.height,length:p.length,weight:p.weight,insurance_value:p.price/100,quantity:p.quantity})),options:{receipt:false,own_hand:false}});
      requireThat(Array.isArray(data),502,'Respuesta de cotización no válida.');
      return data.filter(q=>!q.error && Number.isFinite(Number(q.custom_price??q.price)) && Number(q.custom_price??q.price)>=0).map(q=>({id:String(q.id),name:`${q.company?.name||''} ${q.name}`.trim(),price:Math.round(Number(q.custom_price??q.price)*100),days:q.custom_delivery_time??q.delivery_time,packages:q.packages||[]}));
    },
    async preference(order, items, customer) {
      if(demo) return {id:`demo-${order.id}`,url:null};
      requireThat(config.mpToken && config.mpSecret && config.collectorId,503,'Configura las credenciales de pago antes de vender.');
      const parts=allocateCents(order.discount||0,items.map(p=>p.price*p.quantity));
      const paidItems=(order.discount?items.map((p,i)=>({id:p.variant_id||p.product_id,title:`${p.quantity} × ${itemDescription(p)}`,quantity:1,unit_price:(p.price*p.quantity-parts[i])/100,currency_id:'BRL'})).filter(p=>p.unit_price>0):items.map(p=>({id:p.variant_id||p.product_id,title:itemDescription(p),quantity:p.quantity,unit_price:p.price/100,currency_id:'BRL'})));
      const data=await mp('/checkout/preferences',{
        external_reference:order.id,items:[...paidItems,...(order.shipping?[{id:'shipping',title:'Envío',quantity:1,unit_price:order.shipping/100,currency_id:'BRL'}]:[])],
        payer:{email:customer.email},back_urls:{success:`${config.url}/?payment=success#orders`,pending:`${config.url}/?payment=pending#orders`,failure:`${config.url}/?payment=failure#orders`},
        auto_return:'approved',notification_url:`${config.url}/api/webhooks/mercadopago`,expires:true,
        expiration_date_from:new Date(order.created_at).toISOString(),expiration_date_to:new Date(order.reserved_until).toISOString()
      },{'X-Idempotency-Key':`preference-${order.id}`});
      return {id:String(data.id),url:safeLink(data.init_point)};
    },
    verifyWebhook(headers,url) {
      requireThat(!demo && config.mpSecret,503,'Webhook no configurado.');
      const dataId=url.searchParams.get('data.id'); const requestId=headers['x-request-id'];
      const parts=Object.fromEntries(String(headers['x-signature']||'').split(',').map(p=>p.trim().split('=')));
      requireThat(dataId && requestId && /^\d+$/.test(parts.ts||'') && /^[a-f0-9]{64}$/.test(parts.v1||''),401,'Firma no válida.');
      const expected=createHmac('sha256',config.mpSecret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`).digest();
      requireThat(timingSafeEqual(expected,Buffer.from(parts.v1,'hex')),401,'Firma no válida.');
      return dataId;
    },
    verifyShippingWebhook(headers,raw) {
      requireThat(!demo && config.meSecret,503,'Webhook de envío no configurado.');
      const signature=String(headers['x-me-signature']||'');
      requireThat(/^[A-Za-z0-9+/]{43}=$/.test(signature),401,'Firma de envío no válida.');
      const expected=createHmac('sha256',config.meSecret).update(raw).digest();
      const received=Buffer.from(signature,'base64');
      requireThat(received.length===expected.length && timingSafeEqual(received,expected),401,'Firma de envío no válida.');
    },
    async payment(id) {return mp(`/v1/payments/${encodeURIComponent(id)}`,null,{},'GET');},
    async refund(order) {
      requireThat(!demo && order.payment_id,400,'Pago no identificado.');
      return mp(`/v1/payments/${encodeURIComponent(order.payment_id)}/refunds`,{},{'X-Idempotency-Key':`full-refund-${order.id}`});
    },
    async createLabel(order,items,invoiceKey) {
      requireThat(!demo && config.shippingFrom,503,'Configura el remitente para generar etiquetas reales.');
      const a=JSON.parse(order.address), service=JSON.parse(order.shipping_service);
      requireThat(config.shippingFrom.state_register,503,'Configura la inscripción estatal brasileña del remitente.');
      requireThat(service.packages?.length===1,400,'La cotización no contiene los bultos. Genera la etiqueta desde el panel del transportista.');
      const data=await me('/cart',{from:config.shippingFrom,to:{name:a.name,phone:a.phone,email:order.customer_email,document:a.document,address:a.street,number:a.number,complement:a.complement,district:a.district,city:a.city,state_abbr:a.state,country_id:'BR',postal_code:a.postal_code},service:Number(service.id),products:items.map(p=>({name:itemDescription(p),quantity:p.quantity,unitary_value:p.price/100})),volumes:service.packages.map(p=>({height:p.dimensions?.height??p.height,width:p.dimensions?.width??p.width,length:p.dimensions?.length??p.length,weight:p.weight})),options:{insurance_value:order.subtotal/100,receipt:false,own_hand:false,non_commercial:false,invoice:{key:invoiceKey}}});
      return String(data.id);
    },
    async buyLabel(id) {return me('/shipment/checkout',{orders:[id]});},
    async printLabel(id) {
      await me('/shipment/generate',{orders:[id]});
      const data=await me('/shipment/print',{mode:'public',orders:[id]}); return safeLink(data.url);
    },
    async tracking(id) {return me('/shipment/tracking',{orders:[id]});}
  };
}
