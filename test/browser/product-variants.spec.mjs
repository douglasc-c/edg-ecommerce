import {test,expect} from '@playwright/test';
import sharp from 'sharp';

async function admin(page){
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByLabel('Correo electrónico',{exact:true}).fill('admin@example.com');
  await page.getByLabel('Contraseña',{exact:true}).fill('UI-exclusive-fixture-2026');
  await page.locator('#auth-form').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hola, Administrador.'})).toBeVisible();
}
async function headers(page){
  const {csrf}=await (await page.request.get('/api/auth/me')).json();
  return {Origin:new URL(page.url()).origin,'X-CSRF-Token':csrf};
}
const stockCell=(row,size)=>row.locator(`.variant-cell[data-size="${size}"]`);

test('crear una estampa con colores, fotos y existencias independientes y comprar dos variaciones',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await admin(page);await page.getByRole('link',{name:'Productos',exact:true}).click();
  await page.getByRole('button',{name:'+ Nuevo producto',exact:true}).click();
  const form=page.locator('#product-form');
  const name='Camiseta UI Variaciones',sku='UI-VARIATIONS-1';
  await form.getByLabel('Nombre',{exact:true}).fill(name);
  await form.getByLabel('SKU',{exact:true}).fill(sku);
  await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('Camiseta');
  await form.locator('[name="price"]').fill('29.90');
  await form.getByLabel('Descripción',{exact:true}).fill('La misma estampa con inventario por color y talla.');
  for(const size of ['S','L','XL'])await form.getByRole('checkbox',{name:size,exact:true}).check();
  await form.getByRole('textbox',{name:'Nombre del color 1',exact:true}).fill('Negro');
  const blackRow=form.locator('.variant-color-row').nth(0);
  await stockCell(blackRow,'S').locator('.variant-stock-input').fill('2');
  await stockCell(blackRow,'XL').locator('.variant-stock-input').fill('1');
  await stockCell(blackRow,'S').locator('details summary').click();
  await stockCell(blackRow,'S').locator('.variant-low-stock-input').fill('1');
  await stockCell(blackRow,'S').locator('details summary').click();
  const blackPhoto=await sharp({create:{width:32,height:32,channels:3,background:'#111111'}}).png().toBuffer();
  await blackRow.locator('.variant-photo-input').setInputFiles({name:'negro.png',mimeType:'image/png',buffer:blackPhoto});
  await expect(blackRow.locator('.variant-color-photos img')).toHaveCount(1);
  await form.getByRole('button',{name:'+ Añadir color',exact:true}).click();
  await form.getByRole('textbox',{name:'Nombre del color 2',exact:true}).fill('Blanco');
  await form.getByLabel('Muestra del color 2',{exact:true}).fill('#ffffff');
  const whiteRow=form.locator('.variant-color-row').nth(1);
  for(const size of ['S','XL'])await stockCell(whiteRow,size).locator('.variant-offered').uncheck();
  await stockCell(whiteRow,'L').locator('.variant-stock-input').fill('3');
  const whitePhoto=await sharp({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer();
  await whiteRow.locator('.variant-photo-input').setInputFiles({name:'blanco.png',mimeType:'image/png',buffer:whitePhoto});
  await expect(whiteRow.locator('.variant-color-photos img')).toHaveCount(1);
  await expect(form.locator('#variant-allocation-total')).toContainText('6');
  await page.screenshot({path:testInfo.outputPath('variant-editor.png'),fullPage:true});
  await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
  await expect(page.locator('#dialog')).toBeHidden();
  const p=(await (await page.request.get('/api/admin/products')).json()).find(p=>p.sku===sku);
  expect(p.stock).toBe(6);expect(p.variants).toHaveLength(4);
  expect(p.variants.find(v=>v.color_name==='Negro'&&v.size==='L').stock).toBe(0);
  expect(p.variants.some(v=>v.color_name==='Blanco'&&v.size==='S')).toBe(false);
  const black=p.variants.find(v=>v.color_name==='Negro'&&v.size==='S');
  const white=p.variants.find(v=>v.color_name==='Blanco'&&v.size==='L');
  expect(black.low_stock).toBe(1);
  await page.getByRole('row').filter({hasText:sku}).getByRole('button',{name:'Editar',exact:true}).click();
  await expect(form.locator('.variant-color-row')).toHaveCount(2);
  await expect(stockCell(form.locator('.variant-color-row').nth(0),'S').locator('.variant-stock-input')).toHaveAttribute('readonly','');
  await page.locator('#dialog').getByRole('button',{name:'Cerrar',exact:true}).click();

  await page.goto('/#store');
  // Variants created together can share a timestamp; their UUID order does
  // not promise that Negro is the first color in the returned catalog.
  await expect(page.locator('.product').filter({has:page.getByRole('heading',{name,exact:true})}).locator('.product-photo')).toHaveAttribute('src',p.variants[0].images[0]);
  await page.getByRole('button',{name:`Añadir ${name}`,exact:true}).click();
  await expect(page.locator('#variant-selection')).toBeVisible();
  await page.getByRole('button',{name:'Negro',exact:true}).click();
  await expect(page.locator('[data-action="add-selected"]')).toBeDisabled();
  await expect(page.getByRole('button',{name:'L Agotado',exact:true})).toBeDisabled();
  await expect(page.locator('#selected-product-image img')).toHaveAttribute('src',black.images[0]);
  await page.locator('[data-action="choose-size"]').filter({hasText:/^S$/}).click();
  await page.getByRole('button',{name:'Añadir al carrito',exact:true}).click();
  await expect(page.locator('#dialog')).toBeHidden();
  await page.getByRole('button',{name:`Añadir ${name}`,exact:true}).click();
  await page.getByRole('button',{name:'Blanco',exact:true}).click();
  await expect(page.locator('#selected-product-image img')).toHaveAttribute('src',white.images[0]);
  await expect(page.locator('[data-action="choose-size"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Añadir al carrito',exact:true}).click();
  await page.locator('.topactions').getByRole('link',{name:/Carrito/}).click();
  await expect(page.locator('.cart-row').filter({hasText:name})).toHaveCount(2);
  const blackCart=page.locator('.cart-row').filter({hasText:'Negro · S'}),whiteCart=page.locator('.cart-row').filter({hasText:'Blanco · L'});
  await whiteCart.getByRole('button',{name:'Aumentar cantidad',exact:true}).click();
  await expect(blackCart.locator('.quantity>span')).toHaveText('1');
  await expect(whiteCart.locator('.quantity>span')).toHaveText('2');
  await page.screenshot({path:testInfo.outputPath('variant-cart.png'),fullPage:true});
  await page.getByRole('button',{name:'Continuar con el envío'}).click();
  for(const [label,value] of [['Nombre del destinatario','Cliente Variantes'],['Teléfono','41999999999'],['CPF / CNPJ','12345678901'],['Código postal (CEP)','80010000'],['Calle / Avenida','Calle Prueba'],['Número','10'],['Barrio','Centro'],['Ciudad','Curitiba'],['Estado (UF)','PR']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Calcular envío'}).click();
  await page.getByRole('button',{name:'Confirmar pedido'}).click();
  await expect(page.locator('#dialog .order-variant')).toHaveCount(2);
  expect((await page.locator('#dialog .order-variant').allTextContents()).sort()).toEqual(['Negro · S','Blanco · L'].sort());
  await page.getByRole('button',{name:'Simular pago aprobado'}).click();
  await expect(page.getByText('Pago confirmado.',{exact:true})).toBeVisible();
  const paid=(await (await page.request.get('/api/admin/products')).json()).find(row=>row.id===p.id);
  expect(paid.stock).toBe(3);expect(paid.reserved).toBe(0);
  expect(paid.variants.find(v=>v.id===black.id).stock).toBe(1);
  expect(paid.variants.find(v=>v.id===white.id).stock).toBe(1);
  expect(errors).toEqual([]);
});

test('móvil: distribuir el saldo antiguo exige el total exacto y conserva existencias',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await admin(page);const auth=await headers(page),sku='UI-VARIANT-MIGRATION';
  const created=await page.request.post('/api/admin/products',{headers:auth,data:{
    sku,name:'Camiseta para distribuir',description:'Existencias antiguas sin desglose por talla.',category:'Camiseta',sizes:['S','L'],
    price:2990,cost:1000,low_stock:2,weight:.5,width:20,height:5,length:25,color:'#f0f0f0',icon:'◇',
  }});expect(created.status()).toBe(201);const p=await created.json();
  expect((await page.request.post(`/api/admin/products/${p.id}/stock`,{headers:auth,data:{delta:5,reason:'Saldo físico anterior'}})).status()).toBe(200);
  await page.goto('/#store');
  await expect(page.getByRole('button',{name:'Añadir Camiseta para distribuir',exact:true})).toBeDisabled();
  await page.goto('/#products');
  const row=page.getByRole('row').filter({hasText:sku});
  await expect(row).toContainText('Pendiente de distribuir');
  await row.getByRole('button',{name:'Editar',exact:true}).click();
  const form=page.locator('#product-form');
  await expect(form.locator('.variant-migration-note')).toContainText('5');
  await form.getByRole('textbox',{name:'Nombre del color 1',exact:true}).fill('Negro');
  const color=form.locator('.variant-color-row');
  await stockCell(color,'S').locator('.variant-stock-input').fill('2');
  await stockCell(color,'L').locator('.variant-stock-input').fill('2');
  await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
  await expect(form.locator('#product-form-error')).toContainText('exactamente');
  expect((await (await page.request.get('/api/admin/products')).json()).find(row=>row.id===p.id).variants_enabled).toBe(false);
  await stockCell(color,'L').locator('.variant-stock-input').fill('3');
  await expect(form.locator('#variant-allocation-total')).toHaveText('Unidades distribuidas: 5 / 5');
  await page.screenshot({path:testInfo.outputPath('migration-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
  await expect(page.locator('#dialog')).toBeHidden();
  await page.reload();await row.getByRole('button',{name:'Editar',exact:true}).click();
  await expect(stockCell(form.locator('.variant-color-row'),'S').locator('.variant-stock-input')).toHaveValue('2');
  await expect(stockCell(form.locator('.variant-color-row'),'L').locator('.variant-stock-input')).toHaveValue('3');
  expect(errors).toEqual([]);
});
