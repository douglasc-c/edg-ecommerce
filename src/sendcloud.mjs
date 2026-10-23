import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, requireThat, safeLink } from './security.mjs';

// Contratos v3: https://sendcloud.dev/llms.txt. No se usa la API v2 ni Idempotency-Key.
const BASE='https://panel.sendcloud.sc/api/v3';
const LABEL_STATUSES=new Set(['READY_TO_SEND','ANNOUNCED','LABELLED']);
const MAX_PDF=10*1024*1024;
const ERROR_CODES=new Set(['unknown_field','invalid','forbidden','invalid_choice','min_value','null','not_found','required','not_a_list','non_field_errors','authentication_failed','validation_error','parcel_announcement_error']);
const ERROR_FIELDS=new Set(['data','attributes','from_address','to_address','parcels','country_code','postal_code','city','address_line_1','state_province_code','dimensions','weight','value','unit','width','height','length','contract_id','carrier_code','calculate_quotes','functionalities','shipping_product_code','shipping_option_code','sender_address_id','from_country_code','to_country_code','from_postal_code','to_postal_code','non_field_errors']);
const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function privateStrings(value,key=''){return ['country_code','state_province_code'].includes(key)?[]:typeof value==='string'?[value]:value&&typeof value==='object'?Object.entries(value).flatMap(([key,value])=>privateStrings(value,key)):[];}
async function rejectionDetails(response,privateValues){
  // Leer solo el JSON de error y limitarlo; nunca registrar el cuerpo completo.
  if(!/\bjson\b/i.test(response.headers.get('content-type')||'')||!response.body)return [];
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return [];}chunks.push(Buffer.from(value));}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const errors=Array.isArray(data?.errors)?data.errors:data?.errors&&typeof data.errors==='object'?[data.errors]:[];
    const hidden=[...new Set(privateValues.filter(value=>typeof value==='string'&&value.length).flatMap(value=>[value,encodeURIComponent(value)]))].sort((a,b)=>b.length-a.length);
    return errors.slice(0,5).filter(error=>error&&typeof error==='object').map(error=>{
      const source=error.source?.pointer??error.source?.parameter;
      const parts=typeof source==='string'?source.split(/[/.]/).filter(Boolean):[];
      const field=parts.length&&parts.length<=8&&parts.every(part=>ERROR_FIELDS.has(part)||/^\d{1,3}$/.test(part))?parts.join('.'):null;
      let detail=typeof error.detail==='string'&&error.detail.length<=1000&&!/[<>]/.test(error.detail)?error.detail:'';
      for(const value of hidden)detail=detail.replace(new RegExp(value.length<3?`\\b${escapeRegex(value)}\\b`:escapeRegex(value),'gi'),'[redactado]');
      detail=detail.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[redactado]').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,300);
      return {...(ERROR_CODES.has(error.code)?{code:error.code}:{}),...(field?{field}:{}),...(detail?{detail}:{})};
    }).filter(error=>Object.keys(error).length);
  }catch{return [];}
  finally{reader.releaseLock();}
}
function identifier(value,label,numeric=false) {
  const id=String(value??'');
  requireThat(numeric?/^[1-9]\d{0,14}$/.test(id):/^[A-Za-z0-9_-]{1,128}$/.test(id),400,`${label} no válido.`);
  return id;
}
function field(value,label,max=200) {
  requireThat(typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\u0000-\u001f]/.test(value),400,`${label} no válido.`);
  return value.trim();
}
function money(value) {
  if(typeof value!=='string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(cents)?cents:null;
}
function safeTrackingUrl(value) {try{return value?safeLink(value):null;}catch{return null;}}
function timestamp(value) {return typeof value==='string' && Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;}
function apiAddress(input,{forQuote=false}={}) {
  requireThat(input && typeof input==='object',400,'Dirección de envío no válida.');
  const country=field(input.country_code,'País',2).toUpperCase();
  requireThat(country==='ES',400,'Solo se admiten destinos en España (Península y Baleares).');
  const postal=field(input.postal_code,'Código postal',5);
  requireThat(/^\d{5}$/.test(postal),400,'El código postal debe contener cinco dígitos.');
  requireThat(!/^(35|38|51|52)/.test(postal),400,'En España solo se admiten la Península y Baleares. Canarias, Ceuta y Melilla requieren una ruta aduanera específica.');
  const result={country_code:country,postal_code:postal,city:field(input.city,'Ciudad',100),address_line_1:field(input.address??input.street??input.address_line_1,'Dirección',200)};
  const house=input.house_number??input.number;
  if(house)result[forQuote?'address_line_1':'house_number']=forQuote?`${result.address_line_1} ${field(String(house),'Número',30)}`:field(String(house),'Número',30);
  // Sendcloud no admite state_province_code para España; se conserva solo en los datos locales.
  if(!forQuote) {
    result.name=field(input.name,'Nombre',150);
    for(const [key,value] of Object.entries({company_name:input.company_name,address_line_2:input.address_2??input.complement??input.address_line_2,email:input.email,phone_number:input.telephone??input.phone??input.phone_number}))if(value)result[key]=field(value,key==='email'?'Correo electrónico':key==='phone_number'?'Teléfono':'Información de dirección',key==='email'?254:200);
  }
  return result;
}
function parcelPayload(parcel) {
  requireThat(parcel && typeof parcel==='object',400,'Bulto no válido.');
  for(const key of ['weight','width','height','length'])requireThat(typeof parcel[key]==='number' && Number.isFinite(parcel[key]) && parcel[key]>0 && parcel[key]<=10000,400,'El peso y las dimensiones del bulto deben ser positivos.');
  return {weight:{value:String(parcel.weight),unit:'kg'},dimensions:{width:String(parcel.width),height:String(parcel.height),length:String(parcel.length),unit:'cm'}};
}
function normalizedStatus(code) {
  const value=String(code||'').toLowerCase();
  if(['announced','ready_to_send','labelled'].includes(value))return 'label_created';
  if(['dropped','accepted','sorted','in_transit','customs'].includes(value))return 'in_transit';
  if(value==='in_delivery')return 'out_for_delivery';
  if(value==='pup')return 'ready_for_pickup';
  if(value==='delivered')return 'delivered';
  if(['cancelled','cancelled_upstream'].includes(value))return 'cancelled';
  if(['announcement_failed','address_error','damaged','missing','delivery_forced','attempted'].includes(value))return 'exception';
  return 'unknown';
}
function receipt(data,parcelId=null) {
  requireThat(data && typeof data==='object' && Array.isArray(data.parcels),502,'Respuesta de remesa no válida de Sendcloud.');
  const shipmentId=identifier(data.id,'Identificador de remesa');
  const parcel=parcelId?data.parcels.find(p=>String(p.id)===String(parcelId)):data.parcels.length===1?data.parcels[0]:null;
  requireThat(parcel,502,'El bulto no pertenece a la remesa o la respuesta contiene varios bultos.');
  const id=identifier(parcel.id,'Identificador de bulto',true);
  const tracking=parcel.tracking_number??parcel.tracking_numbers?.[0]?.tracking_number;
  const status=String(parcel.status?.code||'UNKNOWN');
  return {shipment_id:shipmentId,parcel_id:id,reference:data.external_reference_id??null,tracking_code:typeof tracking==='string'?tracking.slice(0,255):null,tracking_url:safeTrackingUrl(parcel.tracking_url),status:normalizedStatus(status),provider_status:status,occurred_at:timestamp(parcel.updated_at??parcel.announced_at??parcel.created_at),label_available:Array.isArray(parcel.documents)&&parcel.documents.some(d=>(d.document_type??d.type)==='label')};
}
function providerError(message,{status=502,uncertain=false,rejected=false,code='SENDCLOUD_ERROR'}={}) {
  const error=new HttpError(status,message);Object.assign(error,{uncertain,rejected,code});return error;
}
export function sendcloudProvider(config,fetcher=fetch,report=entry=>console.error('Sendcloud API error:',JSON.stringify(entry))) {
  const settings=config.sendcloud||{};
  function credentials() {
    requireThat(settings.publicKey && settings.secretKey,503,'Configura las credenciales de Sendcloud.');
    requireThat(typeof settings.publicKey==='string' && typeof settings.secretKey==='string',503,'Credenciales de Sendcloud no válidas.');
    return `Basic ${Buffer.from(`${settings.publicKey}:${settings.secretKey}`).toString('base64')}`;
  }
  async function request(path,{method='GET',body,accept='application/json',binary=false,allowConflict=false,privateData=[]}={}) {
    // El host es constante y no se siguen redirecciones con credenciales.
    const headers={Authorization:credentials(),Accept:accept};
    if(body)headers['Content-Type']='application/json';
    let response;
    try{response=await fetcher(BASE+path,{method,headers,redirect:'manual',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw providerError('No se ha podido confirmar la respuesta de Sendcloud.',{uncertain:method!=='GET'});}
    // Workers no admite redirect:'error'. El modo manual permite bloquear todos los 3xx sin reenviar credenciales.
    if(response.status>=300 && response.status<400)throw providerError('Sendcloud ha devuelto una redirección inesperada. No se ha seguido para proteger las credenciales.',{uncertain:method!=='GET',code:'SENDCLOUD_REDIRECT'});
    if(!response.ok && !(allowConflict && response.status===409)) {
      const status=response.status===404?404:[400,422].includes(response.status)?422:[401,403,429].includes(response.status)?503:502;
      let message=response.status===404?'Remesa o documento no encontrado en Sendcloud.':status===503?'Sendcloud no está disponible o requiere revisar las credenciales.':'Sendcloud ha rechazado la solicitud. Revisa los datos en su panel.';
      const operation=path==='/shipping-options'?'quote':path.startsWith('/addresses/sender-addresses/')?'sender':null;
      let provider;
      if(operation){
        const errors=await rejectionDetails(response,[settings.publicKey,settings.secretKey,settings.webhookSecret,headers.Authorization,headers.Authorization.slice(6),...privateStrings(privateData)]);
        provider={name:'sendcloud',operation,status:response.status,errors};
        report({...provider,errors:errors.map(({detail,...error})=>error)});
        message=operation==='quote'?`No se han podido consultar las tarifas en Sendcloud (HTTP ${response.status}).`:`No se ha podido consultar el remitente en Sendcloud (HTTP ${response.status}).`;
        const detail=errors.map(error=>[error.field,error.detail].filter(Boolean).join(': ')).filter(Boolean).join(' ');
        if(detail)message+=` ${detail}`;
      }
      const error=providerError(message,{status,uncertain:method!=='GET'&&response.status>=500,rejected:response.status>=400&&response.status<500});
      if(provider)error.provider=provider;
      throw error;
    }
    if(binary) {
      requireThat((response.headers.get('content-type')||'').split(';')[0]==='application/pdf',502,'Sendcloud no ha devuelto un PDF.');
      const declared=Number(response.headers.get('content-length')||0);
      requireThat(Number.isFinite(declared) && declared<=MAX_PDF,502,'La etiqueta supera el tamaño permitido.');
      const chunks=[];let size=0;
      if(response.body) {
        const reader=response.body.getReader();
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PDF){await reader.cancel();throw new HttpError(502,'La etiqueta supera el tamaño permitido.');}chunks.push(Buffer.from(value));}}
        finally{reader.releaseLock();}
      }
      const bytes=Buffer.concat(chunks);
      requireThat(bytes.subarray(0,5).toString()==='%PDF-',502,'El documento recibido no es una etiqueta PDF válida.');
      return bytes;
    }
    let data;try{data=await response.json();}catch{throw providerError('Respuesta JSON no válida de Sendcloud.',{uncertain:method!=='GET'});}
    return {data,status:response.status};
  }
  async function shipment(id) {
    const {data}=await request(`/shipments/${identifier(id,'Identificador de remesa')}`);
    requireThat(data?.data && String(data.data.id)===String(id),502,'La remesa recibida no coincide con la solicitada.');
    return data.data;
  }
  async function lookup(reference) {
    reference=field(reference,'Referencia de envío',100);
    const {data}=await request(`/shipments?${new URLSearchParams({external_reference_id:reference,page_size:'2'})}`);
    requireThat(Array.isArray(data?.data),502,'Respuesta de búsqueda de remesas no válida.');
    requireThat(data.data.every(row=>row.external_reference_id===reference),502,'Sendcloud ha devuelto una referencia distinta de la solicitada.');
    requireThat(data.data.length<=1,409,'Hay varias remesas con la misma referencia. Revisa el panel de Sendcloud.');
    return data.data.length?receipt(data.data[0]):null;
  }
  function confirmed(result) {
    if(['label_created','in_transit','out_for_delivery','ready_for_pickup','delivered'].includes(result.status))return result;
    const error=providerError('Ya existe una remesa sin etiqueta confirmada. Consulta la referencia en Sendcloud antes de volver a emitir.',{uncertain:true,code:'SENDCLOUD_UNCERTAIN'});
    Object.assign(error,{shipment_id:result.shipment_id,parcel_id:result.parcel_id});throw error;
  }
  return {
    async sender() {
      const id=identifier(settings.senderAddressId,'Identificador del remitente',true);
      const {data}=await request(`/addresses/sender-addresses/${id}`);
      const sender=data?.data;
      requireThat(sender && String(sender.id)===id && sender.country_code==='ES',502,'El remitente configurado debe ser una dirección española de Sendcloud.');
      return {id:sender.id,name:sender.name,company_name:sender.company_name||'',address:sender.address_line_1,house_number:sender.house_number||'',address_2:sender.address_line_2||'',postal_code:sender.postal_code,city:sender.city,country_code:sender.country_code,email:sender.email||'',telephone:sender.phone_number||'',...(sender.state_province_code&&sender.state_province_code!=='null'?{state_province_code:sender.state_province_code}:{})};
    },
    async quote({sender,destination,parcel}) {
      requireThat(sender?.country_code==='ES',400,'El origen del envío debe estar en España.');
      const pack=parcelPayload(parcel);
      const {data}=await request('/shipping-options',{method:'POST',body:{from_address:apiAddress(sender,{forQuote:true}),to_address:apiAddress(destination,{forQuote:true}),parcels:[pack],calculate_quotes:true},privateData:[sender,destination]});
      requireThat(Array.isArray(data?.data),502,'Respuesta de cotización de Sendcloud no válida.');
      const options=[];
      for(const option of data.data) {
        if(option.code==='sendcloud:letter')continue;
        if(option.quote_error || option.functionalities?.returns || option.functionalities?.labelless || option.requirements?.export_documents || option.requirements?.is_service_point_required || option.functionalities?.last_mile&&option.functionalities.last_mile!=='home_delivery')continue;
        if(typeof option.code!=='string' || !option.code || option.code.length>500 || !Array.isArray(option.quotes))continue;
        const billed=option.parcel_billed_weights?.[0],billedWeight=billed?.unit==='kg'?Number(billed.value):parcel.weight;
        const quotes=option.quotes.filter(q=>{
          const min=q.weight?.min,max=q.weight?.max;
          return (!min||min.unit==='kg'&&Number(min.value)<=billedWeight)&&(!max||max.unit==='kg'&&Number(max.value)>=billedWeight)&&q.price?.total?.currency==='EUR'&&money(q.price.total.value)!==null;
        });
        if(!quotes.length)continue;
        // Si hay bandas solapadas, se conserva el importe mayor para evitar infracotizar.
        const quote=quotes.reduce((a,b)=>money(a.price.total.value)>=money(b.price.total.value)?a:b);
        const contract=option.contract?.id??null;
        if(contract!==null && (!Number.isSafeInteger(contract)||contract<=0))continue;
        options.push({id:`${option.code}|${contract??''}`,name:String(option.name||option.code).slice(0,250),carrier:String(option.carrier?.name||option.carrier?.code||'Sendcloud').slice(0,100),price:money(quote.price.total.value),currency:'EUR',days:Number.isSafeInteger(quote.lead_time)&&quote.lead_time>=0?Math.ceil(quote.lead_time/24):null,shipping_option_code:option.code,contract_id:contract});
      }
      return options;
    },
    lookup,
    async create({reference,sender,destination,parcel,option}) {
      // Las pruebas se simulan localmente: ni sendcloud:letter ni otro POST crea etiquetas de prueba.
      requireThat(settings.environment==='live',409,'La creación real de etiquetas está desactivada en modo de prueba.');
      reference=field(reference,'Referencia de envío',100);
      requireThat(sender?.country_code==='ES' && String(sender.id)===String(settings.senderAddressId),400,'El remitente no coincide con la configuración de Sendcloud.');
      requireThat(typeof option?.shipping_option_code==='string' && option.shipping_option_code.length>0 && option.shipping_option_code.length<=500 && option.currency==='EUR',400,'Servicio de envío no válido.');
      requireThat(option.shipping_option_code!=='sendcloud:letter',400,'La carta sin franqueo de Sendcloud no es un servicio de transporte real.');
      const properties={shipping_option_code:option.shipping_option_code};
      if(option.contract_id!==null && option.contract_id!==undefined){requireThat(Number.isSafeInteger(option.contract_id)&&option.contract_id>0,400,'Contrato de envío no válido.');properties.contract_id=option.contract_id;}
      const body={external_reference_id:reference,reference,from_address:{sender_address_id:Number(identifier(settings.senderAddressId,'Identificador del remitente',true))},to_address:apiAddress(destination),parcels:[parcelPayload(parcel)],ship_with:{type:'shipping_option_code',properties},label_details:{mime_type:'application/pdf',dpi:72}};
      const existing=await lookup(reference);if(existing)return confirmed(existing);
      let result;
      try {
        const response=await request('/shipments/announce',{method:'POST',body,allowConflict:true});
        if(response.status===409) {
          const found=await lookup(reference);
          if(found)return confirmed(found);
          throw providerError('Sendcloud ha informado de una referencia duplicada sin una remesa consultable.',{uncertain:true});
        }
        const data=response.data?.data;
        result=receipt(data);
        requireThat(data.external_reference_id===reference,502,'La referencia de la remesa no coincide.');
        if(data.errors?.length || !LABEL_STATUSES.has(result.provider_status))throw providerError('La remesa no tiene una etiqueta confirmada. Consulta su estado antes de repetir la operación.',{uncertain:true});
        return result;
      }catch(error) {
        if(error.rejected)throw error;
        // Se reconcilia por la referencia única documentada; nunca se repite el POST.
        try{const found=await lookup(reference);if(found)return confirmed(found);}catch{}
        const uncertain=providerError('No se ha podido confirmar la etiqueta. Reconcilia la referencia en Sendcloud antes de volver a emitir.',{uncertain:true,code:'SENDCLOUD_UNCERTAIN'});
        const known=result||error;
        if(known.shipment_id)Object.assign(uncertain,{shipment_id:known.shipment_id,parcel_id:known.parcel_id});
        throw uncertain;
      }
    },
    async retrieve(shipmentId,parcelId) {
      parcelId=identifier(parcelId,'Identificador de bulto',true);
      const result=receipt(await shipment(shipmentId),parcelId);
      if(!result.tracking_code)return result;
      const {data}=await request(`/parcels/tracking/${encodeURIComponent(result.tracking_code)}`);
      requireThat(data && Array.isArray(data.events) && Array.isArray(data.tracking_numbers) && data.tracking_numbers.some(t=>t.tracking_number===result.tracking_code),502,'El seguimiento recibido no coincide con el bulto.');
      const latest=data.events.filter(e=>e.event_type!=='claim').sort((a,b)=>(Date.parse(b.event_at)||0)-(Date.parse(a.event_at)||0))[0];
      if(!latest)return result;
      const phase=latest.phase,exception=latest.exception;
      const providerStatus=phase==='none'&&exception?exception:phase;
      const status=phase==='none' && exception && exception!=='none'?['cancelled','cancelled_upstream'].includes(exception)?'cancelled':'exception':normalizedStatus(providerStatus);
      return {...result,status,provider_status:providerStatus||'unknown',occurred_at:timestamp(latest.event_at),tracking_url:safeTrackingUrl(data.tracking_numbers.find(t=>t.tracking_number===result.tracking_code)?.tracking_url)||result.tracking_url,event_at:timestamp(latest.event_at)};
    },
    async label(shipmentId,parcelId) {
      parcelId=identifier(parcelId,'Identificador de bulto',true);
      receipt(await shipment(shipmentId),parcelId);
      return request(`/parcels/${parcelId}/documents/label`,{accept:'application/pdf',binary:true});
    },
    verifyWebhook(headers,raw) {
      const secret=settings.webhookSecret||settings.secretKey;
      requireThat(typeof secret==='string' && secret.length>0,503,'Configura la firma del webhook de Sendcloud.');
      requireThat(Buffer.isBuffer(raw)||raw instanceof Uint8Array,400,'El webhook requiere el cuerpo original sin modificar.');
      const signature=typeof headers?.get==='function'?headers.get('sendcloud-signature'):Object.entries(headers||{}).find(([name])=>name.toLowerCase()==='sendcloud-signature')?.[1];
      requireThat(typeof signature==='string' && /^[a-fA-F0-9]{64}$/.test(signature),401,'Firma de Sendcloud no válida.');
      const expected=createHmac('sha256',secret).update(raw).digest();
      requireThat(timingSafeEqual(expected,Buffer.from(signature,'hex')),401,'Firma de Sendcloud no válida.');
      return true;
    }
  };
}
