import {test,expect} from '@playwright/test';

async function mockEuroShop(page,{admin=false}={}){
  const requests={quotes:[],checkout:[],confirm:[]},created=new Date().toISOString(),until=new Date(Date.now()+72*3600000).toISOString();
  const product={id:'eu-product',sku:'EDG-EU',name:'Camiseta de prueba',category:'Camisetas',price:4000,color:'#ffffff',icon:'◇',images:[],active:true,stock:5,reserved:0,available:5,variants_enabled:false,sizes:[]};
  const address={name:'Cliente Prueba',phone:'+34910000000',street:'Calle Mayor',number:'10',complement:'',postal_code:'28001',city:'Madrid',country_code:'ES'};
  const service={id:'eu-standard',name:'Envío estándar',price:500,days:3};
  let order={id:'order-eu',number:1042,status:'awaiting_payment',payment_status:'pending',currency:'EUR',payment_method:'bank_transfer',payment_environment:'test',customer_name:'Cliente Prueba',customer_email:'customer@example.test',created_at:created,reserved_until:until,total:4500,subtotal:4000,shipping:500,discount:0,refunded:0,address,shipping_service:service,items:[{...product,quantity:1}],events:[],bank_transfer:{bank:'Banco Sabadell',beneficiary:'EDG PRUEBAS',iban:'ES9121000418450200051332',reference:'EDG-1042',due_at:until}};
  let placed=admin;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.postDataJSON();let data;
    if(path==='/api/config')data={name:'EDG Commerce',mode:'catalog',currency:'EUR',checkout_enabled:true,payment_methods:['bank_transfer','stripe'],payment_environment:'test',shipping_provider:'sendcloud',shipping_environment:'test',suggested_language:'es',language_source:'country',country:'ES'};
    else if(path==='/api/auth/me')data={user:{id:admin?'admin':'customer',name:admin?'Administrador':'Cliente Prueba',email:admin?'admin@example.test':'customer@example.test',role:admin?'admin':'customer',permissions:admin?['dashboard','orders','finance','shipping','invoices']:[]},csrf:'csrf-test'};
    else if(path==='/api/products')data=[product];
    else if(path==='/api/categories')data=[{name:'Camisetas',image:null}];
    else if(path==='/api/cart')data={items:placed?[]:[{...product,quantity:1}],subtotal:placed?0:4000};
    else if(path==='/api/orders'||path==='/api/admin/orders')data=placed?[order]:[];
    else if(path==='/api/orders/order-eu')data=order;
    else if(path==='/api/shipping/quote'){requests.quotes.push(body);data={id:'quote-eu',options:[service],expires_in:600};}
    else if(path==='/api/checkout'){requests.checkout.push(body);placed=true;order={...order,address:body.address,payment_method:body.payment_method,...(body.payment_method==='stripe'?{bank_transfer:null,payment_url:'http://localhost:3100/stripe-test'}:{})};data=order;}
    else if(path==='/api/admin/orders/order-eu/confirm-transfer'){requests.confirm.push(body);order={...order,status:'paid',payment_status:'approved',events:[{message:'Pago confirmado.',created_at:created}]};data=order;}
    else return route.fulfill({status:500,json:{error:'Unexpected mock request: '+path}});
    await route.fulfill({json:data});
  });
  await page.route('**/stripe-test',route=>route.fulfill({contentType:'text/html',body:'<h1>Stripe de prueba</h1>'}));
  return {...requests,order:()=>order};
}

async function fillSpanishAddress(page){
  for(const [name,value] of [['name','Cliente Prueba'],['phone','+34910000000'],['street','Calle Mayor'],['number','10'],['postal_code','28001'],['city','Madrid']])await page.locator(`#checkout-form [name=${name}]`).fill(value);
}

test('al vencer un pedido al pulsar pagar se actualizan el estado y las acciones sin recargar',async({page})=>{
  const fixture=await mockEuroShop(page),order={...fixture.order(),payment_method:'stripe',bank_transfer:null};
  const message='El plazo de pago ha vencido y se han liberado las existencias. Crea un nuevo pedido.';
  let expired=false;
  await page.route('**/api/orders**',async route=>{
    if(new URL(route.request().url()).pathname.endsWith('/payment')){
      expired=true;await route.fulfill({status:409,json:{error:message}});return;
    }
    const current={...order,status:expired?'expired':'awaiting_payment'};
    await route.fulfill({json:new URL(route.request().url()).pathname==='/api/orders'?[current]:current});
  });
  await page.goto('/#orders');await page.getByRole('button',{name:'Ver pedido'}).click();
  await page.getByRole('button',{name:'Pagar con tarjeta · Stripe'}).click();
  await expect(page.locator('#dialog .badge')).toHaveText('Caducado');
  await expect(page.getByRole('button',{name:'Pagar con tarjeta · Stripe'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cancelar pedido'})).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText(message);
});

test('checkout EUR: dirección española, transferencia principal y datos del pedido en móvil',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));const requests=await mockEuroShop(page);
  await page.goto('/#cart');await page.getByRole('button',{name:'Continuar con el envío'}).click();
  await expect(page.getByLabel('CPF / CNPJ')).toHaveCount(0);await expect(page.locator('[name=payment_method][value=bank_transfer]')).toBeChecked();await expect(page.locator('[name=payment_method][value=stripe]')).toBeVisible();
  await expect(page.getByText('Simulación: no realices una transferencia real. Usa tarjetas de prueba.',{exact:true})).toBeVisible();
  await fillSpanishAddress(page);await page.getByRole('button',{name:'Calcular envío',exact:true}).click();await expect(page.locator('#place-order')).toBeEnabled();
  expect(requests.quotes[0].address).toMatchObject({country_code:'ES',postal_code:'28001',street:'Calle Mayor'});expect(requests.quotes[0].address).not.toHaveProperty('document');
  await page.locator('[name=street]').fill('Calle Mayor nueva');await expect(page.locator('#place-order')).toBeDisabled();
  await page.getByRole('button',{name:'Calcular envío',exact:true}).click();await page.getByRole('button',{name:'Confirmar pedido'}).click();
  await expect(page.locator('.bank-transfer-details')).toContainText('EDG-1042');await expect(page.locator('.bank-transfer-details')).toContainText('ES9121000418450200051332');
  expect(requests.checkout[0].payment_method).toBe('bank_transfer');expect(requests.checkout[0].address.street).toBe('Calle Mayor nueva');
  await expect(page.getByRole('button',{name:'Simular pago aprobado',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Simular confirmación de transferencia',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.bank-transfer-details')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('eur-transfer-mobile.png'),fullPage:true});expect(errors).toEqual([]);
});

test('checkout EUR: tarjeta Stripe redirige también con COMMERCE_MODE catalog',async({page})=>{
  const requests=await mockEuroShop(page);await page.goto('/#cart');await page.getByRole('button',{name:'Continuar con el envío'}).click();await fillSpanishAddress(page);
  await page.locator('[name=payment_method][value=stripe]').check();await page.getByRole('button',{name:'Calcular envío',exact:true}).click();await page.getByRole('button',{name:'Confirmar pedido'}).click();
  await expect(page).toHaveURL('http://localhost:3100/stripe-test');expect(requests.checkout[0].payment_method).toBe('stripe');
});

test('gestión EUR: confirma una transferencia solo con importe, referencia y comprobación expresa',async({page})=>{
  const requests=await mockEuroShop(page,{admin:true});await page.goto('/#sales');await page.getByRole('button',{name:'Detalles'}).click();
  await expect(page.getByRole('button',{name:/NF-e/})).toHaveCount(0);await page.getByRole('button',{name:'Simular confirmación de transferencia',exact:true}).click();
  await page.getByLabel('Referencia de la simulación').fill('SIM-1042');await page.getByLabel('Importe simulado (€)').fill('45');await page.getByLabel('Confirmo que esta operación es una simulación.').check();await page.getByRole('button',{name:'Confirmar simulación',exact:true}).click();
  await expect(page.getByText('Pago confirmado.',{exact:true})).toBeVisible();expect(requests.confirm).toEqual([{bank_reference:'SIM-1042',amount:4500,confirmed:true}]);
});
