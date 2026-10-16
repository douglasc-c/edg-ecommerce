import {test,expect} from '@playwright/test';

const countries=[{code:'ES',name:'España (Península y Baleares)'},{code:'DE',name:'Alemania'},{code:'IT',name:'Italia'},{code:'PT',name:'Portugal'}];
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
  for(const [name,value] of Object.entries({name:'Cliente Europa',email:'customer@example.com',telephone:'+493012345678',address:'Musterstraße',house_number:'12',postal_code:'10115',city:'Berlín',state_province_code:'DE-BE',weight:'1.25',length:'90',width:'25',height:'12',order_reference:'PED-EU-100'}))await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('[name="country_code"]').selectOption('DE');
}

test('envío europeo de prueba: paquete real, tarifa invalidada al editar y simulación sin etiqueta',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const {calls}=await europeFixture(page);
  await page.goto('/#europe-shipping');
  await expect(page.getByRole('heading',{name:'Envíos europeos',exact:true})).toBeVisible();
  await expect(page.getByText('MODO DE PRUEBAS · simulación local',{exact:true})).toBeVisible();
  await expect(page.locator('#eu-shipping-form [name="weight"]')).toHaveValue('');await expect(page.getByLabel('Provincia (código ISO, si se requiere)',{exact:true})).toHaveValue('');
  await page.locator('#eu-shipping-form [name="country_code"]').selectOption('IT');await expect(page.getByLabel('Provincia (código ISO, obligatorio en Italia)',{exact:true})).toHaveAttribute('required','');await page.locator('#eu-shipping-form [name="country_code"]').selectOption('DE');await expect(page.getByLabel('Provincia (código ISO, si se requiere)',{exact:true})).not.toHaveAttribute('required','');
  await page.getByRole('button',{name:'Comprobar conexión'}).click();await expect(page.locator('#eu-connection-result')).toContainText('No se ha contratado ningún envío.');
  await fillShipment(page);await page.getByRole('button',{name:'Consultar tarifas',exact:true}).click();
  await expect(page.locator('#eu-quote-results')).toContainText('9,95');
  await expect(page.locator('#eu-quote-results')).toContainText('Plazo no facilitado');
  expect(calls.quotes[0]).toMatchObject({destination:{country_code:'DE',postal_code:'10115',house_number:'12',state_province_code:'DE-BE'},parcel:{weight:1.25,length:90,width:25,height:12}});
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
