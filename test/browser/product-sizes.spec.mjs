import {test,expect} from '@playwright/test';

test('el administrador guarda y edita varias tallas y cambia las opciones con la categoría',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let createRequests=0;
  page.on('request',request=>{
    if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/admin/products')createRequests++;
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByLabel('Correo electrónico',{exact:true}).fill('admin@example.com');
  await page.getByLabel('Contraseña',{exact:true}).fill('UI-exclusive-fixture-2026');
  await page.locator('#auth-form').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hola, Administrador.'})).toBeVisible();
  await page.getByRole('link',{name:'Productos',exact:true}).click();
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
  await form.getByRole('combobox',{name:'Categoría',exact:true}).selectOption('Camiseta');
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

  for(const size of ['S','M','L'])await form.getByRole('checkbox',{name:size,exact:true}).check();
  await saveAndReopen();
  expect(createRequests).toBe(1);
  await expect(selected).toHaveCount(3);
  for(const size of ['S','M','L'])await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();

  await form.getByRole('checkbox',{name:'M',exact:true}).uncheck();
  await form.getByRole('checkbox',{name:'XL',exact:true}).check();
  await saveAndReopen();
  await expect(selected).toHaveCount(3);
  for(const size of ['S','L','XL'])await expect(form.getByRole('checkbox',{name:size,exact:true})).toBeChecked();
  await expect(form.getByRole('checkbox',{name:'M',exact:true})).not.toBeChecked();

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
