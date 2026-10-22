import {test,expect} from '@playwright/test';

const clothingSizes=['S','L','XL','XXL'];
const expectClothingSizes=async form=>{
  await expect(form.locator('.product-size-options input')).toHaveCount(4);
  await expect(form.locator('.product-size-options span')).toHaveText(clothingSizes);
};
async function openProducts(page){
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByLabel('Correo electrónico',{exact:true}).fill('admin@example.com');
  await page.getByLabel('Contraseña',{exact:true}).fill('UI-exclusive-fixture-2026');
  await page.locator('#auth-form').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hola, Administrador.'})).toBeVisible();
  await page.getByRole('link',{name:'Productos',exact:true}).click();
}

test('el administrador guarda y edita las cuatro tallas de ropa y cambia las opciones con la categoría',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let createRequests=0;
  page.on('request',request=>{
    if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/admin/products')createRequests++;
  });
  await openProducts(page);
  await page.getByRole('button',{name:'+ Nuevo producto',exact:true}).click();

  const name='Producto con varias tallas',sku='UI-MULTISIZES-1';
  const description='Producto para comprobar la selección y edición de varias tallas.';
  const form=page.locator('#product-form'),modal=page.locator('#dialog');
  const row=page.getByRole('row').filter({hasText:sku});
  const selected=form.locator('input[name="sizes"]:checked');
  const saveAndReopen=async()=>{
    await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
    await expect(modal).toBeHidden();
    await page.reload();
    await expect(row).toBeVisible();
    await row.getByRole('button',{name:'Editar',exact:true}).click();
    await expect(form).toBeVisible();
  };
  await form.getByLabel('Nombre',{exact:true}).fill(name);
  await form.getByLabel('SKU',{exact:true}).fill(sku);
  for(const category of ['Sudadera','Camiseta']){
    await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption(category);
    await expectClothingSizes(form);
  }
  await form.locator('[name="price"]').fill('29.90');
  await form.getByLabel('Descripción',{exact:true}).fill(description);
  await expect(form.getByRole('group',{name:'Tallas disponibles',exact:true})).toBeVisible();

  await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Nombre',{exact:true})).toHaveValue(name);
  await expect(form.getByLabel('SKU',{exact:true})).toHaveValue(sku);
  await expect(form.getByLabel('Descripción',{exact:true})).toHaveValue(description);
  await expect(selected).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(createRequests).toBe(0);

  for(const size of ['S','L','XL'])await form.getByRole('checkbox',{name:size,exact:true}).check();
  await saveAndReopen();
  expect(createRequests).toBe(1);
  await expectClothingSizes(form);
  await expect(selected).toHaveCount(3);
  for(const size of ['S','L','XL'])await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();

  await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('Sudadera');
  await expectClothingSizes(form);
  await expect(selected).toHaveCount(3);
  await form.getByRole('checkbox',{name:'XL',exact:true}).uncheck();
  await form.getByRole('checkbox',{name:'XXL',exact:true}).check();
  await saveAndReopen();
  await expect(form.getByRole('combobox',{name:'Categoría',exact:true})).toHaveValue('Sudadera');
  await expectClothingSizes(form);
  await expect(selected).toHaveCount(3);
  for(const size of ['S','L','XXL'])await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();
  await expect(form.getByRole('checkbox',{name:'XL',exact:true})).not.toBeChecked();

  await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('Tabla');
  await expect(form.getByRole('group',{name:'Anchuras disponibles (pulgadas)',exact:true})).toBeVisible();
  await expect(selected).toHaveCount(0);
  await expect(form.getByRole('checkbox',{name:'S',exact:true})).toHaveCount(0);
  for(const size of ['8.0','8.25'])await form.getByRole('checkbox',{name:size,exact:true}).check();
  await saveAndReopen();
  await expect(form.getByRole('combobox',{name:'Categoría',exact:true})).toHaveValue('Tabla');
  await expect(selected).toHaveCount(2);
  for(const size of ['8.0','8.25'])await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();

  await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('Papelería');
  await expect(form.getByRole('checkbox')).toHaveCount(0);
  const freeSizes=form.getByLabel('Tallas (separadas por comas)',{exact:true});
  await expect(freeSizes).toHaveValue('');
  await freeSizes.fill('A5, A4');
  await saveAndReopen();
  await expect(form.getByRole('combobox',{name:'Categoría',exact:true})).toHaveValue('Papelería');
  await expect(freeSizes).toHaveValue('A5, A4');
  await expect(form.getByRole('checkbox')).toHaveCount(0);
  await expect(form.getByLabel('Nombre',{exact:true})).toHaveValue(name);
  expect(errors).toEqual([]);
});

test('en móvil las tallas antiguas no vuelven al editor y se guardan solo las seleccionadas',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openProducts(page);
  const form=page.locator('#product-form'),modal=page.locator('#dialog');
  const sku='UI-LEGACY-SIZES',row=page.getByRole('row').filter({hasText:sku});
  const auth=await page.request.get('/api/auth/me'),{csrf}=await auth.json();
  const created=await page.request.post('/api/admin/products',{headers:{'X-CSRF-Token':csrf,Origin:new URL(page.url()).origin},data:{
    sku,name:'Producto de tallas anteriores',description:'Producto de prueba para revisar tallas anteriores.',
    category:'Camiseta',sizes:['S'],price:2990,cost:1000,low_stock:2,weight:.5,width:20,height:10,length:25,color:'#334455',icon:'◇',
  }});
  expect(created.ok()).toBe(true);
  let updates=0;
  page.on('request',request=>{
    if(request.method()==='PUT'&&new URL(request.url()).pathname.startsWith('/api/admin/products/'))updates++;
  });
  for(const scenario of [
    {category:'Camiseta',legacy:['M','P','S'],selected:['S'],choose:['XL'],saved:['S','XL']},
    {category:'Sudadera',legacy:['PP','G','GG','XGG'],selected:[],choose:['L','XXL'],saved:['L','XXL']},
  ]){
    // Simula la respuesta de un producto histórico; el guardado usa la API real del entorno de prueba.
    const legacyResponse=async route=>{
      const response=await route.fetch(),products=await response.json();
      const product=products.find(product=>product.sku===sku);
      expect(product).toBeTruthy();
      Object.assign(product,{category:scenario.category,size:scenario.legacy[0],sizes:scenario.legacy});
      await route.fulfill({response,json:products});
    };
    await page.route('**/api/admin/products',legacyResponse);
    await page.reload();
    await row.getByRole('button',{name:'Editar',exact:true}).click();
    await expectClothingSizes(form);
    await expect(form.locator('input[name="sizes"]:checked')).toHaveCount(scenario.selected.length);
    for(const size of scenario.selected)await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();
    if(!scenario.selected.length){
      const before=updates;
      await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
      await expect(form).toBeVisible();
      await expect(form.getByRole('checkbox',{name:'S',exact:true})).toHaveAttribute('required','');
      expect(await form.evaluate(element=>element.checkValidity())).toBe(false);
      expect(updates).toBe(before);
    }
    for(const size of scenario.choose)await form.getByRole('checkbox',{name:size,exact:true}).check();
    await page.unroute('**/api/admin/products',legacyResponse);
    const savedResponse=page.waitForResponse(response=>response.request().method()==='PUT'&&new URL(response.url()).pathname.startsWith('/api/admin/products/'));
    await form.getByRole('button',{name:'Guardar producto',exact:true}).click();
    const response=await savedResponse;
    expect(response.ok()).toBe(true);
    expect((await response.json()).sizes).toEqual(scenario.saved);
    await expect(modal).toBeHidden();
    await page.reload();
    await row.getByRole('button',{name:'Editar',exact:true}).click();
    await expectClothingSizes(form);
    await expect(form.getByRole('combobox',{name:'Categoría',exact:true})).toHaveValue(scenario.category);
    await expect(form.locator('input[name="sizes"]:checked')).toHaveCount(scenario.saved.length);
    for(const size of scenario.saved)await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();
    await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
  }
  expect(updates).toBe(2);
  expect(errors).toEqual([]);
});
