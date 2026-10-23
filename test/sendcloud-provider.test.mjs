import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { sendcloudProvider } from '../src/sendcloud.mjs';

const BASE='https://panel.sendcloud.sc/api/v3';
const config={sendcloud:{environment:'live',publicKey:'public-example',secretKey:'secret-example',webhookSecret:'signature-example',senderAddressId:17}};
const sender={id:17,name:'Equipo EDG',company_name:'EDG',address:'Carrer de Mallorca',house_number:'10',address_2:'Almacén',postal_code:'08001',city:'Barcelona',country_code:'ES',email:'warehouse@example.test',telephone:'+34930000000'};
const destination={name:'Cliente de prueba',address:'Calle Mayor',house_number:'20',postal_code:'28001',city:'Madrid',country_code:'ES',email:'buyer@example.test',telephone:'+34910000000'};
const parcel={weight:2.4,width:25,height:12,length:85};
const option={id:'dhl:parcel|44',name:'DHL Parcel',carrier:'DHL',price:890,currency:'EUR',days:2,shipping_option_code:'dhl:parcel',contract_id:44};
const shipment=(overrides={})=>({id:'shipment-uuid',external_reference_id:'edg-shipping-123',parcels:[{id:500,tracking_number:'TRACK-123',tracking_url:'https://tracking.example.test/TRACK-123',status:{code:'READY_TO_SEND'},updated_at:'2026-10-16T10:00:00Z',documents:[{document_type:'label',link:'http://127.0.0.1/private'}]}],...overrides});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function mock(steps) {
  const calls=[];
  const fetcher=async(url,init)=>{
    const step=steps.shift();assert.ok(step,`Solicitud inesperada: ${url}`);
    calls.push({url,init});assert.equal(url,BASE+step.path);assert.equal(init.method,step.method||'GET');assert.equal(init.redirect,'manual');
    assert.equal(init.headers.Authorization,'Basic '+Buffer.from('public-example:secret-example').toString('base64'));
    return typeof step.result==='function'?step.result(url,init):step.result;
  };
  return {fetcher,calls,done(){assert.equal(steps.length,0,'Quedan solicitudes simuladas sin consumir.');}};
}

test('consulta el remitente configurado por ID y normaliza su dirección sin datos fiscales',async()=>{
  const m=mock([{path:'/addresses/sender-addresses/17',result:json({data:{id:17,name:sender.name,company_name:'EDG',address_line_1:sender.address,house_number:'10',address_line_2:'Almacén',postal_code:'08001',city:'Barcelona',country_code:'ES',email:sender.email,phone_number:sender.telephone,tax_numbers:[{name:'VAT',value:'no-publicar'}],state_province_code:'null'}})}]);
  assert.deepEqual(await sendcloudProvider(config,m.fetcher).sender(),sender);m.done();
});

test('bloquea redirecciones del remitente sin reenviar credenciales ni exponer Location',async()=>{
  for(const status of [301,302,303,307,308]) {
    const location='https://other.example.test/private?token=never-expose';
    const m=mock([{path:'/addresses/sender-addresses/17',result:new Response(null,{status,headers:{Location:location}})}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher).sender(),error=>error.status===502 && error.code==='SENDCLOUD_REDIRECT' && error.uncertain===false && !error.message.includes(location) && !error.message.includes('never-expose'));
    assert.equal(m.calls.length,1);m.done();
  }
});

test('rechaza un remitente de otro país o un ID distinto',async()=>{
  for(const data of [{id:17,country_code:'FR'},{id:18,country_code:'ES'}]) {
    const m=mock([{path:'/addresses/sender-addresses/17',result:json({data})}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher).sender(),{status:502});m.done();
  }
});

test('cotiza con objetos de dirección y bulto completo mediante shipping-options v3',async()=>{
  const m=mock([{path:'/shipping-options',method:'POST',result:json({data:[{code:'dhl:parcel',name:'DHL Parcel',carrier:{name:'DHL'},contract:{id:44},functionalities:{last_mile:'home_delivery'},quotes:[{lead_time:25,price:{total:{value:'8.90',currency:'EUR'}}}]}]})}]);
  const options=await sendcloudProvider(config,m.fetcher).quote({sender,destination,parcel});
  assert.deepEqual(options,[option]);
  const body=JSON.parse(m.calls[0].init.body);
  assert.deepEqual(body.parcels,[{weight:{value:'2.4',unit:'kg'},dimensions:{width:'25',height:'12',length:'85',unit:'cm'}}]);
  assert.equal(body.from_address.country_code,'ES');assert.equal(body.to_address.country_code,'ES');assert.equal(body.to_address.address_line_1,'Calle Mayor 20');assert.equal(body.calculate_quotes,true);
  assert.equal(body.to_country_code,undefined);assert.equal(body.weight,undefined);m.done();
});

test('omite la provincia española del origen y destino al cotizar Península y Baleares',async()=>{
  for(const target of [
    {...destination,state_province_code:'ES-M'},
    {...destination,postal_code:'07001',city:'Palma',state_province_code:'ES-PM'},
    {...destination,state:'ES-M'},
  ]){
    const origin={...sender,...(target.state?{state:'ES-B'}:{state_province_code:'ES-B'})};
    const original=structuredClone({sender:origin,destination:target});
    const m=mock([{path:'/shipping-options',method:'POST',result:json({data:[]})}]);
    assert.deepEqual(await sendcloudProvider(config,m.fetcher).quote({sender:origin,destination:target,parcel}),[]);
    const body=JSON.parse(m.calls[0].init.body);
    for(const address of [body.from_address,body.to_address]){
      assert.equal(Object.hasOwn(address,'state_province_code'),false);
      assert.equal(Object.hasOwn(address,'state'),false);
      assert.equal(address.country_code,'ES');
    }
    assert.equal(body.from_address.postal_code,origin.postal_code);
    assert.equal(body.to_address.postal_code,target.postal_code);
    assert.equal(body.to_address.city,target.city);
    assert.deepEqual({sender:origin,destination:target},original);m.done();
  }
});

test('conserva el motivo JSON:API de una tarifa rechazada y registra solo código y campo',async()=>{
  const reports=[],errors=[{status:'400',code:'invalid',detail:'Invalid contract.',source:{pointer:'/contract_id'}}];
  const m=mock([{path:'/shipping-options',method:'POST',result:json({errors},400)}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher,entry=>reports.push(entry)).quote({sender,destination,parcel}),error=>{
    assert.equal(error.status,422);assert.equal(error.rejected,true);
    assert.equal(error.message,'No se han podido consultar las tarifas en Sendcloud (HTTP 400). contract_id: Invalid contract.');
    assert.deepEqual(error.provider,{name:'sendcloud',operation:'quote',status:400,errors:[{code:'invalid',field:'contract_id',detail:'Invalid contract.'}]});
    return true;
  });
  assert.deepEqual(reports,[{name:'sendcloud',operation:'quote',status:400,errors:[{code:'invalid',field:'contract_id'}]}]);
  assert.equal(m.calls.length,1);m.done();
});

test('acepta un error JSON:API individual con un parámetro de filtro conocido',async()=>{
  const m=mock([{path:'/shipping-options',method:'POST',result:json({errors:{code:'invalid_choice',detail:'Unsupported carrier.',source:{parameter:'carrier_code'}}},400)}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher,()=>{}).quote({sender,destination,parcel}),error=>{
    assert.deepEqual(error.provider.errors,[{code:'invalid_choice',field:'carrier_code',detail:'Unsupported carrier.'}]);return true;
  });m.done();
});

test('distingue el fallo del remitente y conserva el estado remoto de acceso o disponibilidad',async()=>{
  for(const [remote,status] of [[400,422],[401,503],[403,503],[404,404],[422,422],[429,503],[500,502],[503,502]]){
    const reports=[],m=mock([{path:'/addresses/sender-addresses/17',result:json({errors:[{code:'not_found',detail:'Sender address unavailable.'}]},remote)}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher,entry=>reports.push(entry)).sender(),error=>{
      assert.equal(error.status,status);assert.equal(error.provider.status,remote);assert.equal(error.provider.operation,'sender');
      assert.equal(error.message,`No se ha podido consultar el remitente en Sendcloud (HTTP ${remote}). Sender address unavailable.`);return true;
    });
    assert.equal(reports[0].status,remote);m.done();
  }
});

test('oculta credenciales y datos de las direcciones en los detalles de tarifas y en los logs',async()=>{
  const basic=Buffer.from('public-example:secret-example').toString('base64'),reports=[];
  const privateValues=[config.sendcloud.publicKey,config.sendcloud.secretKey,config.sendcloud.webhookSecret,basic,
    sender.address,sender.company_name,sender.postal_code,sender.city,destination.name,destination.address,destination.house_number,destination.postal_code,destination.city,destination.email,destination.telephone];
  const detail='Rejected values: '+privateValues.join(' | ')+' | '+encodeURIComponent(destination.address)+' | https://example.test/?token=private';
  const m=mock([{path:'/shipping-options',method:'POST',result:json({errors:[{code:'invalid',detail,source:{pointer:'/to_address/postal_code'}}]},422)}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher,entry=>reports.push(entry)).quote({sender,destination,parcel}),error=>{
    const output=JSON.stringify([error.message,error.provider,reports]);
    for(const value of privateValues)assert.ok(!output.includes(value),`No debe exponer ${value}`);
    assert.ok(!output.includes('token=private'));assert.match(error.message,/\[redactado\]/);
    assert.equal(error.provider.errors[0].field,'to_address.postal_code');return true;
  });m.done();
});

test('no muestra HTML, JSON malformado ni campos desconocidos de los errores del proveedor',async()=>{
  for(const response of [
    new Response('<!DOCTYPE html><h1>private error</h1>',{status:502,headers:{'content-type':'text/html'}}),
    new Response('{private invalid JSON',{status:502,headers:{'content-type':'application/json'}}),
    json({errors:[{code:'private-code',detail:'<script>private data</script>',source:{pointer:'/to_address/private-address'}}]},422),
  ]){
    const m=mock([{path:'/shipping-options',method:'POST',result:response}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher,()=>{}).quote({sender,destination,parcel}),error=>{
      assert.ok(!JSON.stringify([error.message,error.provider]).includes('private'));assert.deepEqual(error.provider.errors,[]);return true;
    });m.done();
  }
});

test('cancela el cuerpo de error excesivo y mantiene un diagnóstico de estado seguro',async()=>{
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(16385)));},cancel(){cancelled=true;}});
  const m=mock([{path:'/shipping-options',method:'POST',result:new Response(body,{status:500,headers:{'content-type':'application/json'}})}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher,()=>{}).quote({sender,destination,parcel}),error=>error.status===502&&error.provider.status===500&&error.provider.errors.length===0);
  assert.equal(cancelled,true);m.done();
});

test('descarta tarifas sin precio EUR, con errores, devolución, aduana, punto de recogida o sin etiqueta',async()=>{
  const base={code:'carrier:service',quotes:[{price:{total:{value:'3.00',currency:'EUR'}}}]};
  const rows=[{...base,quote_error:{code:'missing'}},{...base,quotes:[]},{...base,quotes:[{price:{total:{value:'3.00',currency:'USD'}}}]},{...base,quotes:[{price:{total:{value:'NaN',currency:'EUR'}}}]},{...base,functionalities:{returns:true}},{...base,functionalities:{labelless:true}},{...base,requirements:{export_documents:true}},{...base,requirements:{is_service_point_required:true}},{...base,functionalities:{last_mile:'service_point'}},{...base,contract:{id:0}}];
  const m=mock([{path:'/shipping-options',method:'POST',result:json({data:rows})}]);
  assert.deepEqual(await sendcloudProvider(config,m.fetcher).quote({sender,destination,parcel}),[]);m.done();
});

test('selecciona bandas aplicables al peso facturado y no infracotiza bandas solapadas',async()=>{
  const q=(min,max,value)=>({weight:{min:{unit:'kg',value:min},max:{unit:'kg',value:max}},price:{total:{value,currency:'EUR'}}});
  const m=mock([{path:'/shipping-options',method:'POST',result:json({data:[{code:'carrier:service',parcel_billed_weights:[{unit:'kg',value:'4.0'}],quotes:[q('0','3','2.00'),q('3','5','8.50'),q('3','6','9.00')]}]})}]);
  const result=await sendcloudProvider(config,m.fetcher).quote({sender,destination,parcel});assert.equal(result[0].price,900);m.done();
});

test('valida países, medidas y credenciales antes de llamar a la red',async()=>{
  const api=sendcloudProvider(config,()=>{assert.fail('No debe llamar a la red.');});
  for(const change of [{country_code:'FR'},{country_code:'DE',postal_code:'10115'},{country_code:'IT',postal_code:'20121',state_province_code:'IT-MI'},{country_code:'PT',postal_code:'1234-567'},...['35001','38001','51001','52001','2800','abcde'].map(postal_code=>({postal_code}))]) {
    await assert.rejects(api.quote({sender,destination:{...destination,...change},parcel}),{status:400});
    await assert.rejects(api.create({reference:'edg-shipping-123',sender,destination:{...destination,...change},parcel,option}),{status:400});
  }
  await assert.rejects(api.quote({sender,destination,parcel:{...parcel,weight:0}}),{status:400});
  await assert.rejects(sendcloudProvider({sendcloud:{senderAddressId:17}},()=>assert.fail('No debe llamar a la red.')).sender(),{status:503});
});

test('cotiza Baleares como destino nacional y transmite su código postal completo',async()=>{
  const m=mock([{path:'/shipping-options',method:'POST',result:json({data:[]})}]);
  assert.deepEqual(await sendcloudProvider(config,m.fetcher).quote({sender,destination:{...destination,postal_code:'07001',city:'Palma'},parcel}),[]);
  const body=JSON.parse(m.calls[0].init.body);assert.equal(body.to_address.country_code,'ES');assert.equal(body.to_address.postal_code,'07001');m.done();
});

test('el modo test nunca crea etiquetas reales, tampoco sendcloud:letter',async()=>{
  const api=sendcloudProvider({sendcloud:{...config.sendcloud,environment:'test'}},()=>assert.fail('No debe llamar a la red.'));
  await assert.rejects(api.create({reference:'edg-shipping-123',sender,destination,parcel,option:{...option,shipping_option_code:'sendcloud:letter'}}),{status:409});
});

test('excluye sendcloud:letter aunque tenga tarifa EUR y conserva cartas comerciales de otros transportistas',async()=>{
  const priced={quotes:[{price:{total:{value:'3.00',currency:'EUR'}}}]};
  const m=mock([{path:'/shipping-options',method:'POST',result:json({data:[{...priced,code:'sendcloud:letter',name:'Unstamped letter'},{...priced,code:'correos:carta',name:'Carta comercial'}]})}]);
  const options=await sendcloudProvider(config,m.fetcher).quote({sender,destination,parcel});
  assert.deepEqual(options.map(item=>item.shipping_option_code),['correos:carta']);m.done();
});

test('el modo live rechaza sendcloud:letter antes de buscar referencias o emitir etiquetas',async()=>{
  const api=sendcloudProvider(config,()=>assert.fail('No debe llamar a la red.'));
  await assert.rejects(api.create({reference:'edg-shipping-123',sender,destination,parcel,option:{...option,shipping_option_code:'sendcloud:letter'}}),{status:400});
});

test('anuncia una sola vez con external_reference_id único y sin Idempotency-Key inventado',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:json({data:shipment()},201)}]);
  const result=await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option});
  assert.equal(result.shipment_id,'shipment-uuid');assert.equal(result.parcel_id,'500');assert.equal(result.status,'label_created');
  const body=JSON.parse(m.calls[1].init.body);assert.equal(body.external_reference_id,'edg-shipping-123');assert.deepEqual(body.from_address,{sender_address_id:17});assert.deepEqual(body.ship_with,{type:'shipping_option_code',properties:{shipping_option_code:'dhl:parcel',contract_id:44}});assert.equal(body.to_address.house_number,'20');assert.equal(body.label_details.mime_type,'application/pdf');assert.equal(m.calls[1].init.headers['Idempotency-Key'],undefined);m.done();
});

test('omite la provincia española de cotizaciones guardadas al anunciar un envío',async()=>{
  for(const province of [{state_province_code:'ES-M'},{state:'ES-M'}]){
    const target={...destination,...province},original=structuredClone(target);
    const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:json({data:shipment()},201)}]);
    const result=await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination:target,parcel,option});
    assert.equal(result.status,'label_created');
    const body=JSON.parse(m.calls[1].init.body);
    assert.deepEqual(body.to_address,{country_code:'ES',postal_code:'28001',city:'Madrid',address_line_1:'Calle Mayor',house_number:'20',name:destination.name,email:destination.email,phone_number:destination.telephone});
    assert.deepEqual(target,original);m.done();
  }
});

test('reutiliza una remesa confirmada por referencia sin emitir otro POST',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[shipment()]})}]);
  assert.equal((await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option})).parcel_id,'500');assert.equal(m.calls.length,1);m.done();
});

test('una remesa existente sin etiqueta confirmada se conserva como incierta sin otro POST',async()=>{
  const pending=shipment({parcels:[{id:500,status:{code:'ANNOUNCING'}}]});
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[pending]})}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option}),{status:502,uncertain:true,shipment_id:'shipment-uuid',parcel_id:'500'});m.done();
});

test('reconcilia una respuesta incierta sin repetir la emisión',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:()=>{throw new Error('timeout');}},{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[shipment()]})}]);
  assert.equal((await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option})).status,'label_created');assert.equal(m.calls.filter(c=>c.init.method==='POST').length,1);m.done();
});

test('marca la creación como incierta si no puede reconciliar y no permite reintento automático',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:json({},503)},{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option}),{status:502,uncertain:true,code:'SENDCLOUD_UNCERTAIN'});assert.equal(m.calls.filter(c=>c.init.method==='POST').length,1);m.done();
});

test('una redirección al crear conserva el resultado incierto y solo consulta para conciliar',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:new Response(null,{status:307,headers:{Location:'https://other.example.test/announce'}})},{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option}),{status:502,uncertain:true,code:'SENDCLOUD_UNCERTAIN'});
  assert.equal(m.calls.filter(call=>call.init.method==='POST').length,1);m.done();
});

test('concilia una redirección de emisión con la remesa existente sin volver a contratar',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:new Response(null,{status:308,headers:{Location:'https://other.example.test/announce'}})},{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[shipment()]})}]);
  const result=await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option});
  assert.equal(result.shipment_id,'shipment-uuid');assert.equal(m.calls.filter(call=>call.init.method==='POST').length,1);m.done();
});

test('una referencia duplicada HTTP409 se reconcilia con GET',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:json({data:shipment()},409)},{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[shipment()]})}]);
  assert.equal((await sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option})).shipment_id,'shipment-uuid');m.done();
});

test('rechazo HTTP422 definitivo no desencadena nueva emisión ni búsqueda posterior',async()=>{
  const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:[]})},{path:'/shipments/announce',method:'POST',result:json({errors:[{detail:'dato privado del proveedor'}]},422)}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher).create({reference:'edg-shipping-123',sender,destination,parcel,option}),error=>error.status===422&&error.rejected===true&&!error.message.includes('dato privado'));m.done();
});

test('lookup verifica la referencia devuelta y rechaza resultados ambiguos',async()=>{
  for(const rows of [[shipment({external_reference_id:'otro-envio'})],[shipment(),shipment({id:'shipment-2'})]]) {
    const m=mock([{path:'/shipments?external_reference_id=edg-shipping-123&page_size=2',result:json({data:rows})}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher).lookup('edg-shipping-123'));m.done();
  }
});

test('el rastreo consulta la remesa y después el seguimiento canónico del bulto correcto',async()=>{
  const m=mock([{path:'/shipments/shipment-uuid',result:json({data:shipment()})},{path:'/parcels/tracking/TRACK-123',result:json({events:[{event_type:'carrier',event_at:'2026-10-16T12:30:00Z',phase:'delivered',exception:'none'}],tracking_numbers:[{tracking_number:'TRACK-123',tracking_url:'https://carrier.example.test/track'}]})}]);
  const result=await sendcloudProvider(config,m.fetcher).retrieve('shipment-uuid',500);assert.equal(result.status,'delivered');assert.equal(result.occurred_at,'2026-10-16T12:30:00.000Z');assert.equal(result.tracking_url,'https://carrier.example.test/track');m.done();
});

test('una excepción canónica y una entrega forzada no se confunden con entrega confirmada',async()=>{
  for(const event of [{phase:'none',exception:'address_error'},{phase:'delivery_forced',exception:'none'}]) {
    const m=mock([{path:'/shipments/shipment-uuid',result:json({data:shipment()})},{path:'/parcels/tracking/TRACK-123',result:json({events:[{...event,event_type:'carrier',event_at:'2026-10-16T12:30:00Z'}],tracking_numbers:[{tracking_number:'TRACK-123'}]})}]);
    assert.equal((await sendcloudProvider(config,m.fetcher).retrieve('shipment-uuid','500')).status,'exception');m.done();
  }
});

test('no descarga la etiqueta de un bulto ajeno a la remesa',async()=>{
  const m=mock([{path:'/shipments/shipment-uuid',result:json({data:shipment()})}]);
  await assert.rejects(sendcloudProvider(config,m.fetcher).label('shipment-uuid',501),{status:502});m.done();
});

test('descarga el PDF autenticado desde una ruta fija e ignora los enlaces del proveedor',async()=>{
  const pdf=Buffer.from('%PDF-1.7\ncontenido de prueba');
  const m=mock([{path:'/shipments/shipment-uuid',result:json({data:shipment()})},{path:'/parcels/500/documents/label',result:new Response(pdf,{headers:{'content-type':'application/pdf'}})}]);
  assert.deepEqual(await sendcloudProvider(config,m.fetcher).label('shipment-uuid',500),pdf);assert.equal(m.calls[1].init.headers.Accept,'application/pdf');m.done();
});

test('no acepta identificadores que puedan alterar la URL de descarga',async()=>{
  const api=sendcloudProvider(config,()=>assert.fail('No debe llamar a la red.'));
  await assert.rejects(api.label('https://evil.example.test/secret',500),{status:400});
  await assert.rejects(api.label('shipment-uuid','500/../../secret'),{status:400});
});

test('rechaza redirecciones, contenido HTML y documentos que exceden el límite',async()=>{
  for(const response of [new Response('<html>error</html>',{headers:{'content-type':'text/html'}}),new Response('no es PDF',{headers:{'content-type':'application/pdf'}}),new Response('%PDF-1.7',{headers:{'content-type':'application/pdf','content-length':String(11*1024*1024)}}),new Response(null,{status:302,headers:{location:'https://evil.example.test/'}})]) {
    const m=mock([{path:'/shipments/shipment-uuid',result:json({data:shipment()})},{path:'/parcels/500/documents/label',result:response}]);
    await assert.rejects(sendcloudProvider(config,m.fetcher).label('shipment-uuid',500));m.done();
  }
});

test('verifica HMAC SHA256 sobre bytes originales y detecta cambios de espacios o firma',()=>{
  const raw=Buffer.from('{"parcel": {"id": 500}}');
  const signature=createHmac('sha256','signature-example').update(raw).digest('hex');
  const api=sendcloudProvider(config,()=>assert.fail('No debe llamar a la red.'));
  assert.equal(api.verifyWebhook(new Headers({'Sendcloud-Signature':signature}),raw),true);
  assert.equal(api.verifyWebhook({'Sendcloud-Signature':signature.toUpperCase()},raw),true);
  assert.throws(()=>api.verifyWebhook({'sendcloud-signature':signature},Buffer.from(JSON.stringify(JSON.parse(raw)))),{status:401});
  assert.throws(()=>api.verifyWebhook({'sendcloud-signature':'0'.repeat(64)},raw),{status:401});
  assert.throws(()=>api.verifyWebhook({},raw),{status:401});
  const official=sendcloudProvider({sendcloud:{webhookSecret:'secretkey'}});
  assert.equal(official.verifyWebhook({'sendcloud-signature':'1eed4b3d41f4653ac64fd56f1bf1cbfd349e4482cbc11dff7134bd93e5da4b0a'},Buffer.from('{"key": "value"}')),true);
});
