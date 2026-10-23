import {test,expect} from '@playwright/test';

const countries=[{code:'ES',name:'España (Península y Baleares)'}];
async function europeFixture(page,{environment='test',configured=true,creationStatus,provider='sendcloud'}={}){
  const calls={quotes:[],creates:[],checks:0,syncs:0};const rows=[];
  const status={provider:'sendcloud',environment,configured,missing:configured?[]:['SENDCLOUD_PUBLIC_KEY','SENDCLOUD_SECRET_KEY'],origin:{city:'Barcelona',country_code:'ES'},countries,webhook_url:'https://store.example.com/api/webhooks/sendcloud',checkout_enabled:false};
  await page.route('**/api/config',route=>route.fulfill({json:{mode:'catalog',currency:'EUR',shipping_provider:provider,checkout_enabled:false}}));
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{id:'shipping-ui',name:'Gestión Europa',role:'shipping',permissions:['dashboard','shipping']},csrf:'ui-sendcloud-csrf'}}));
  await page.route('**/api/admin/europe-shipping/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/admin/europe-shipping',''),method=request.method();
    if(path==='/status')return route.fulfill({json:status});
    if(path==='/check'){calls.checks++;return route.fulfill({json:{sender:{city:'Barcelona',country_code:'ES'}}});}
    if(path==='/quote'){
      const input=request.postDataJSON();calls.quotes.push(input);
      return route.fulfill({json:{id:`quote-${calls.quotes.length}`,environment,currency:'EUR',...input,options:[{id:'service-1',name:'Entrega europea de prueba',carrier:'Transportista de prueba',price:995,currency:'EUR',days:null}],expires_at:new Date(Date.now()+600000).toISOString()}});
    }
    if(path==='/shipments'&&method==='GET')return route.fulfill({json:rows});
    if(path==='/shipments'&&method==='POST'){
      const body=request.postDataJSON();calls.creates.push({body,key:request.headers()['idempotency-key']});
      const input=calls.quotes.at(-1),row={id:`shipment-${rows.length+1}`,reference:`EU-${rows.length+1}`,quote_id:body.quote_id,order_reference:body.order_reference,environment,status:creationStatus||(environment==='test'?'simulated':'label_created'),...input,service:{id:'service-1',name:'Entrega europea de prueba'},price:995,currency:'EUR',provider_shipment_id:environment==='test'?null:'provider-123',tracking_code:environment==='test'?null:'TRACK-123',tracking_url:environment==='test'?null:'https://tracking.example.com/TRACK-123',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),events:[{message:environment==='test'?'Simulación local guardada.':'Etiqueta creada.',created_at:new Date().toISOString()}]};
      rows.unshift(row);if(row.status==='unknown')return route.fulfill({status:502,json:{error:'Respuesta incierta. Concilia el envío sin repetir la compra.'}});if(row.status==='rejected')return route.fulfill({status:422,json:{error:'Solicitud rechazada por Sendcloud.'}});return route.fulfill({json:row});
    }
    const found=path.match(/^\/shipments\/(shipment-\d+)(\/sync)?$/);
    if(found){const row=rows.find(item=>item.id===found[1]);if(found[2]){calls.syncs++;row.status=environment==='test'?'simulated':'label_created';}return route.fulfill({json:row});}
    return route.fulfill({status:404,json:{error:'Ruta de prueba no encontrada.'}});
  });
  return{calls,rows,status};
}
async function fillShipment(page){
  const form=page.locator('#eu-shipping-form');
  for(const [name,value] of Object.entries({name:'Cliente Europa',email:'customer@example.com',telephone:'+34931234567',address:'Carrer de Mallorca',house_number:'12',postal_code:'08001',city:'Barcelona',state_province_code:'ES-B',weight:'1.25',length:'90',width:'25',height:'12',order_reference:'PED-EU-100'}))await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('[name="country_code"]').selectOption('ES');
}

test('envío europeo de prueba: paquete real, tarifa invalidada al editar y simulación sin etiqueta',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const {calls}=await europeFixture(page);
  await page.goto('/#europe-shipping');
  await expect(page.getByRole('heading',{name:'Envíos europeos',exact:true})).toBeVisible();
  await expect(page.getByText('MODO DE PRUEBAS · simulación local',{exact:true})).toBeVisible();
  await expect(page.locator('#eu-shipping-form [name="weight"]')).toHaveValue('');await expect(page.getByLabel('Provincia (código ISO, si se requiere)',{exact:true})).toHaveValue('');
  await expect(page.getByText('Envíos nacionales desde Barcelona a la Península y Baleares.',{exact:true})).toBeVisible();
  await expect(page.locator('#eu-shipping-form [name="country_code"] option')).toHaveText(['España (Península y Baleares)']);
  await expect(page.locator('#eu-shipping-form [name="country_code"]')).toHaveValue('ES');
  await expect(page.getByLabel('Provincia (código ISO, si se requiere)',{exact:true})).not.toHaveAttribute('required','');
  await expect(page.getByLabel('Provincia (código ISO, si se requiere)',{exact:true})).toHaveAttribute('placeholder','p. ej., ES-B');
  await page.getByRole('button',{name:'Comprobar conexión'}).click();await expect(page.locator('#eu-connection-result')).toContainText('No se ha contratado ningún envío.');
  await fillShipment(page);await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();
  await expect(page.locator('#eu-quote-results')).toContainText('9,95');
  await expect(page.locator('#eu-quote-results')).toContainText('Plazo no facilitado');
  expect(calls.quotes[0]).toMatchObject({destination:{country_code:'ES',postal_code:'08001',house_number:'12',state_province_code:'ES-B'},parcel:{weight:1.25,length:90,width:25,height:12}});
  await page.locator('#eu-shipping-form [name="weight"]').fill('1.5');
  await expect(page.getByRole('button',{name:'Simular envío',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();
  await page.getByRole('button',{name:'Simular envío',exact:true}).click();await expect(page.locator('dialog')).toContainText('No se crea etiqueta real');
  await page.getByRole('button',{name:'Guardar simulación',exact:true}).click();
  await expect(page.locator('.eu-shipment')).toHaveCount(1);await expect(page.locator('.eu-shipment')).toContainText('Sin etiqueta real, sin franqueo y sin entrega');
  await expect(page.getByRole('link',{name:/Descargar etiqueta PDF/})).toHaveCount(0);expect(calls.creates).toHaveLength(1);expect(calls.creates[0].body).toMatchObject({quote_id:'quote-2',service_id:'service-1',order_reference:'PED-EU-100',confirm_live:false});expect(calls.creates[0].key).toMatch(/^[a-f\d-]{36}$/i);
  await page.getByRole('button',{name:'Consultar estado',exact:true}).click();expect(calls.syncs).toBe(1);
  await page.getByRole('button',{name:'Ver detalles',exact:true}).click();await expect(page.locator('dialog')).toContainText('Simulación local sin etiqueta real');await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('europe-shipping-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('contratación real exige confirmación y permite conciliar una respuesta incierta sin repetirla',async({page})=>{
  const {calls}=await europeFixture(page,{environment:'live',creationStatus:'unknown'});
  await page.goto('/#europe-shipping');await fillShipment(page);await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();await page.getByRole('button',{name:'Revisar contratación',exact:true}).click();
  await expect(page.locator('dialog')).toContainText('ENVÍO REAL · puede generar cargos');
  await page.getByRole('button',{name:'Contratar envío y generar etiqueta',exact:true}).click();expect(calls.creates).toHaveLength(0);
  await page.locator('dialog input[name="confirm_live"]').check();await page.getByRole('button',{name:'Contratar envío y generar etiqueta',exact:true}).click();
  await expect(page.locator('.eu-shipment')).toContainText('Pendiente de conciliación');expect(calls.creates).toHaveLength(1);expect(calls.creates[0].body.confirm_live).toBe(true);
  await expect(page.getByRole('button',{name:'Revisar contratación',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Preparar otro envío',exact:true}).click();await fillShipment(page);await page.locator('#eu-shipping-form [name="order_reference"]').fill('PED-EU-101');await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();await expect(page.getByRole('button',{name:'Revisar contratación',exact:true})).toBeEnabled();expect(calls.creates).toHaveLength(1);
  await page.getByRole('button',{name:'Consultar / conciliar',exact:true}).click();
  await expect(page.locator('.eu-shipment')).toContainText('Etiqueta creada');expect(calls.creates).toHaveLength(1);expect(calls.syncs).toBe(1);
  await expect(page.getByRole('link',{name:'Descargar etiqueta PDF ↗',exact:true})).toHaveAttribute('href','/api/admin/europe-shipping/shipments/shipment-1/label');
});

test('la configuración pendiente impide cotizar y no solicita credenciales en el navegador',async({page})=>{
  const {calls}=await europeFixture(page,{configured:false});await page.goto('/#europe-shipping');
  await expect(page.getByText('SENDCLOUD_SECRET_KEY',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Consultar tarifas',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Comprobar conexión',exact:true})).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);expect(calls.quotes).toHaveLength(0);
});

test('un rechazo definitivo consume la cotización sin presentarlo como resultado incierto',async({page})=>{
  const {calls}=await europeFixture(page,{environment:'live',creationStatus:'rejected'});await page.goto('/#europe-shipping');await fillShipment(page);await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();await page.getByRole('button',{name:'Revisar contratación',exact:true}).click();await page.locator('dialog input[name="confirm_live"]').check();await page.getByRole('button',{name:'Contratar envío y generar etiqueta',exact:true}).click();
  await expect(page.locator('.eu-shipment')).toContainText('Solicitud rechazada');await expect(page.locator('.eu-uncertain')).toHaveCount(0);await expect(page.getByRole('button',{name:'Revisar contratación',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Consultar tarifas',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();await expect(page.getByRole('button',{name:'Revisar contratación',exact:true})).toBeEnabled();expect(calls.creates).toHaveLength(1);expect(calls.quotes).toHaveLength(2);
});

for(const [language,prefix] of [['en','Sendcloud rates could not be retrieved (HTTP 400).'],['pt-BR','Não foi possível consultar as tarifas no Sendcloud (HTTP 400).']]){
  test(`muestra el motivo de la tarifa rechazada en ${language} y conserva el formulario`,async({page})=>{
    const {calls}=await europeFixture(page);
    await page.addInitScript(language=>localStorage.setItem('edg.language',language),language);
    await page.route('**/api/admin/europe-shipping/quote',route=>route.fulfill({status:422,json:{error:'No se han podido consultar las tarifas en Sendcloud (HTTP 400). contract_id: Invalid contract.',provider:{name:'sendcloud',operation:'quote',status:400,errors:[{code:'invalid',field:'contract_id',detail:'Invalid contract.'}]}}}));
    await page.goto('/#europe-shipping');await fillShipment(page);
    await page.locator('#eu-shipping-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toHaveText(`${prefix} contract_id: Invalid contract.`);
    await expect(page.locator('#eu-quote-results [role="alert"]')).toHaveText(`${prefix} contract_id: Invalid contract.`);
    await expect(page.locator('#eu-shipping-form [name="postal_code"]')).toHaveValue('08001');
    await expect(page.locator('#eu-shipping-form [name="weight"]')).toHaveValue('1.25');
    await expect(page.locator('#eu-shipping-form button[type="submit"]')).toBeEnabled();
    await expect(page.locator('.eu-shipment')).toHaveCount(0);expect(calls.creates).toHaveLength(0);
  });
}
