import {test,expect} from '@playwright/test';

test('el administrador confirma la eliminación de productos y categorías vacías',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByLabel('Correo electrónico',{exact:true}).fill('admin@example.com');
  await page.getByLabel('Contraseña',{exact:true}).fill('UI-exclusive-fixture-2026');
  await page.locator('#auth-form').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hola, Administrador.'})).toBeVisible();
  await page.getByRole('link',{name:'Productos',exact:true}).click();
  await page.getByRole('button',{name:'Categorías',exact:true}).click();
  const category='Categoría para eliminar',name='Producto para eliminar';
  await page.locator('#category-form').getByLabel('Nueva categoría').fill(category);
  await page.getByRole('button',{name:'Añadir categoría',exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('Categoría guardada.');
  const categoryForm=page.locator(`.category-edit-form[data-previous=${JSON.stringify(category)}]`);
  await expect(categoryForm).toBeVisible();
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();

  const {csrf}=await (await page.request.get('/api/auth/me')).json();
  const headers={Origin:new URL(page.url()).origin,'X-CSRF-Token':csrf};
  const productResponse=await page.request.post('/api/admin/products',{headers,data:{
    sku:'UI-DELETE-1',name,description:'Producto temporal para probar la eliminación',category,
    price:10000,cost:3000,low_stock:1,weight:.5,width:10,height:10,length:10,color:'#445566',icon:'◇'
  }});
  expect(productResponse.status()).toBe(201);
  const product=await productResponse.json();
  expect((await page.request.post(`/api/admin/products/${product.id}/stock`,{headers,data:{delta:2,reason:'Entrada de prueba'}})).status()).toBe(200);
  await page.reload();
  const row=page.getByRole('row').filter({hasText:name});
  await expect(row).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());
  await row.getByRole('button',{name:`Eliminar ${name}`,exact:true}).click();
  await expect(row).toBeVisible();
  await row.screenshot({path:testInfo.outputPath('product-delete-actions.png')});

  await page.getByRole('button',{name:'Categorías',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await categoryForm.getByRole('button',{name:'Eliminar categoría',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('productos asociados');
  await expect(categoryForm).toBeVisible();
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await row.getByRole('button',{name:`Eliminar ${name}`,exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('Producto eliminado.');
  await expect(row).toHaveCount(0);
  expect((await (await page.request.get('/api/products')).json()).some(item=>item.id===product.id)).toBe(false);
  expect((await (await page.request.get('/api/admin/products')).json()).some(item=>item.id===product.id)).toBe(false);

  await page.getByRole('button',{name:'Categorías',exact:true}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await categoryForm.getByRole('button',{name:'Eliminar categoría',exact:true}).click();
  await expect(categoryForm).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await categoryForm.getByRole('button',{name:'Eliminar categoría',exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('Categoría eliminada.');
  await expect(categoryForm).toHaveCount(0);
  expect((await (await page.request.get('/api/categories')).json()).some(item=>item.name===category)).toBe(false);
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Categorías',exact:true}).click();
  await expect(categoryForm).toHaveCount(0);

  await page.setViewportSize({width:320,height:844});
  const emptyCategory='Categoría móvil';
  await page.locator('#category-form').getByLabel('Nueva categoría').fill(emptyCategory);
  await page.getByRole('button',{name:'Añadir categoría',exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('Categoría guardada.');
  const mobileForm=page.locator(`.category-edit-form[data-previous=${JSON.stringify(emptyCategory)}]`);
  await mobileForm.scrollIntoViewIfNeeded();
  const overflow=await page.locator('dialog').evaluate(dialog=>dialog.scrollWidth>dialog.clientWidth);
  expect(overflow).toBe(false);
  await mobileForm.screenshot({path:testInfo.outputPath('category-delete-mobile.png')});
  page.once('dialog',dialog=>dialog.accept());
  await mobileForm.getByRole('button',{name:'Eliminar categoría',exact:true}).click();
  await expect(page.locator('#toast')).toHaveText('Categoría eliminada.');
  await expect(mobileForm).toHaveCount(0);
  expect(errors).toEqual([]);
});
