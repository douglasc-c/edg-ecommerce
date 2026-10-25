import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, requireThat, integer, text } from './security.mjs';

const BASE='https://api.stripe.com/v1';
const SESSION=/^cs_(?:test_|live_)?[A-Za-z0-9]{1,200}$/;
const PAYMENT_INTENT=/^pi_[A-Za-z0-9]{1,200}$/;
const failed=(message,uncertain=false)=>Object.assign(new HttpError(502,message),{uncertain});
const object=value=>value && typeof value==='object' && !Array.isArray(value);

export function stripeProvider(config,fetcher=fetch) {
  const settings=config.stripe||{},environment=settings.environment||'test';
  function credentials(){
    requireThat(['test','live'].includes(environment),503,'Entorno Stripe no válido.');
    requireThat(typeof settings.secretKey==='string' && new RegExp(`^(?:sk|rk)_${environment}_[A-Za-z0-9]+$`).test(settings.secretKey),503,'Configura una clave de Stripe del entorno seleccionado.');
    return settings.secretKey;
  }
  async function request(path,{method='GET',body,idempotencyKey}={}){
    const headers={Authorization:`Bearer ${credentials()}`,Accept:'application/json'};
    if(body)headers['Content-Type']='application/x-www-form-urlencoded';
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    let response;
    try{response=await fetcher(BASE+path,{method,headers,redirect:'manual',signal:AbortSignal.timeout(15000),...(body?{body:body.toString()}:{})});}
    catch(error){
      console.error('Stripe request failed:',{kind:['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network_error',method});
      throw failed('No se ha podido confirmar la respuesta de Stripe.',method!=='GET');
    }
    if(response.status>=300 && response.status<400)throw failed('Stripe ha devuelto una redirección inesperada.',method!=='GET');
    if(!response.ok){
      let data;try{data=await response.json();}catch{}
      const error=object(data?.error)?data.error:{},details={status:response.status};
      // Solo metadatos técnicos validados: nunca el cuerpo, mensaje, claves o datos del cliente.
      if(['api_error','authentication_error','card_error','idempotency_error','invalid_request_error','permission_error','rate_limit_error'].includes(error.type))details.type=error.type;
      if(typeof error.code==='string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) && !/^(?:(?:sk|rk|pk)_(?:test|live)_|whsec_)/.test(error.code))details.code=error.code;
      const parameters=new Set(body?[...body.keys()].flatMap(key=>[key,key.split('[')[0]]):[]);
      if(typeof error.param==='string' && parameters.has(error.param))details.param=error.param;
      const requestId=response.headers.get('request-id');
      if(typeof requestId==='string' && /^req_[A-Za-z0-9]{1,200}$/.test(requestId))details.request_id=requestId;
      console.error('Stripe request rejected:',details);
      const rejection=failed('Stripe ha rechazado la solicitud. Revisa el estado de la integración.'+(details.request_id?` Referencia: ${details.request_id}.`:''),method!=='GET' && response.status>=500);
      // Un error de validación de expires_at confirma que no se ha creado una sesión.
      if(method==='POST'&&path==='/checkout/sessions'&&response.status===400&&details.type==='invalid_request_error'&&details.param==='expires_at')rejection.checkoutReservationRejected=true;
      throw rejection;
    }
    try{return await response.json();}catch{throw failed('Respuesta JSON no válida de Stripe.',method!=='GET');}
  }
  function session(value){
    requireThat(object(value) && SESSION.test(value.id||'') && value.object==='checkout.session',502,'Respuesta de sesión Stripe no válida.');
    requireThat(value.livemode===(environment==='live'),409,'La sesión Stripe pertenece a otro entorno.');
    requireThat(value.currency==='eur' && Number.isSafeInteger(value.amount_total) && value.amount_total>=1,409,'El importe o la moneda de Stripe no son válidos.');
    requireThat(object(value.metadata) && typeof value.metadata.order_id==='string' && value.metadata.order_id.length>0 && value.metadata.order_id.length<=100 && value.client_reference_id===value.metadata.order_id,409,'La referencia de pedido de Stripe no es válida.');
    requireThat(['paid','unpaid','no_payment_required'].includes(value.payment_status) && (value.payment_intent===null || typeof value.payment_intent==='string' && PAYMENT_INTENT.test(value.payment_intent)) && (value.payment_status!=='paid' || PAYMENT_INTENT.test(value.payment_intent||'')),502,'El estado de pago de Stripe no es válido.');
    return value;
  }
  return {
    async preference(order,items,customer){
      const id=text(order?.id,'Pedido',1,100),total=integer(order.total,'Total del pedido',1,100000000);
      requireThat(!order.currency || String(order.currency).toUpperCase()==='EUR',400,'Stripe solo está habilitado para pedidos en EUR.');
      const expires=Math.floor(Date.parse(order.reserved_until)/1000),time=Math.floor(Date.now()/1000);
      // Repite primero la solicitud original: una respuesta perdida puede ocultar una sesión creada.
      // Stripe valida los 30 minutos mínimos si la clave no tiene un resultado guardado.
      requireThat(Number.isSafeInteger(expires) && expires>time && expires<=time+86400,409,'El plazo de pago ha vencido o la reserva Stripe no es válida.');
      const origin=new URL(config.url).origin;
      const body=new URLSearchParams({mode:'payment',ui_mode:'hosted_page','allowed_payment_method_types[0]':'card',
        billing_address_collection:'auto','phone_number_collection[enabled]':'false','automatic_tax[enabled]':'false',
        allow_promotion_codes:'false',submit_type:'auto',integration_identifier:'hosted_web_0001',origin_context:'web',
        client_reference_id:id,'metadata[order_id]':id,'payment_intent_data[metadata][order_id]':id,
        'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'eur',
        'line_items[0][price_data][unit_amount]':String(total),
        'line_items[0][price_data][product_data][name]':`Pedido #${order.number}`,
        success_url:`${origin}/?payment=success#orders`,cancel_url:`${origin}/?payment=cancelled#orders`,
        expires_at:String(expires)});
      if(customer?.email)body.set('customer_email',text(customer.email,'Correo electrónico',3,254));
      const idempotencyKey=order.stripe_checkout_key?text(order.stripe_checkout_key,'Clave Stripe',1,255):`preference-${id}`;
      const result=session(await request('/checkout/sessions',{method:'POST',body,idempotencyKey}));
      requireThat(result.amount_total===total && result.client_reference_id===id && result.metadata?.order_id===id,409,'La sesión Stripe no coincide con el pedido.');
      let url;try{url=new URL(result.url);}catch{throw failed('Stripe no ha devuelto una página de pago válida.');}
      requireThat(url.protocol==='https:' && url.hostname==='checkout.stripe.com' && !url.username && !url.password,502,'Stripe no ha devuelto una página de pago válida.');
      return {id:result.id,url:url.href};
    },
    async retrieveSession(id){
      requireThat(typeof id==='string' && SESSION.test(id),400,'Identificador de sesión Stripe no válido.');
      const result=session(await request(`/checkout/sessions/${id}`));
      requireThat(result.id===id,409,'La sesión recibida no coincide con la solicitada.');
      return result;
    },
    verifyWebhook(headers,raw){
      requireThat(typeof settings.webhookSecret==='string' && /^whsec_[A-Za-z0-9]+$/.test(settings.webhookSecret),503,'Configura el secreto del webhook de Stripe.');
      requireThat(Buffer.isBuffer(raw) || raw instanceof Uint8Array,400,'El webhook Stripe requiere el cuerpo original.');
      requireThat(raw.byteLength<=262144,413,'Webhook Stripe demasiado grande.');
      const signature=typeof headers?.get==='function'?headers.get('stripe-signature'):Object.entries(headers||{}).find(([key])=>key.toLowerCase()==='stripe-signature')?.[1];
      requireThat(typeof signature==='string' && signature.length<=2000,401,'Firma Stripe no válida.');
      const parts=signature.split(',').map(part=>part.trim().split('='));
      const timestamps=parts.filter(([key])=>key==='t').map(([,value])=>value),signatures=parts.filter(([key,value])=>key==='v1' && /^[a-fA-F0-9]{64}$/.test(value||'')).map(([,value])=>value);
      requireThat(timestamps.length===1 && /^\d{1,12}$/.test(timestamps[0]) && signatures.length>0,401,'Firma Stripe no válida.');
      const timestamp=Number(timestamps[0]);
      requireThat(Math.abs(Math.floor(Date.now()/1000)-timestamp)<=300,401,'Firma Stripe caducada.');
      const expected=createHmac('sha256',settings.webhookSecret).update(`${timestamps[0]}.`).update(raw).digest();
      requireThat(signatures.some(value=>timingSafeEqual(expected,Buffer.from(value,'hex'))),401,'Firma Stripe no válida.');
      let event;try{event=JSON.parse(Buffer.from(raw).toString('utf8'));}catch{throw new HttpError(400,'Evento Stripe no válido.');}
      requireThat(object(event) && /^evt_[A-Za-z0-9]{1,200}$/.test(event.id||'') && typeof event.type==='string' && event.type.length<=150 && object(event.data?.object),400,'Evento Stripe no válido.');
      requireThat(event.livemode===(environment==='live'),409,'El evento Stripe pertenece a otro entorno.');
      return event;
    },
    async refund(paymentIntentId,orderId){
      requireThat(typeof paymentIntentId==='string' && PAYMENT_INTENT.test(paymentIntentId),400,'Identificador de pago Stripe no válido.');
      const id=text(orderId,'Pedido',1,100);
      const body=new URLSearchParams({payment_intent:paymentIntentId,'metadata[order_id]':id});
      const result=await request('/refunds',{method:'POST',body,idempotencyKey:`full-refund-${id}`});
      requireThat(object(result) && /^re_[A-Za-z0-9]{1,200}$/.test(result.id||'') && result.object==='refund' && result.payment_intent===paymentIntentId && result.currency==='eur' && Number.isSafeInteger(result.amount) && result.amount>0 && ['pending','requires_action','succeeded','failed','canceled'].includes(result.status),502,'Respuesta de reembolso Stripe no válida.');
      return result;
    }
  };
}
