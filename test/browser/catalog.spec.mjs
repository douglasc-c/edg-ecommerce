import {test,expect} from '@playwright/test';
test('el catálogo en euros muestra productos y bloquea las compras en la interfaz',async({page})=>{
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({response,json:{...config,mode:'catalog',currency:'EUR',checkout_enabled:false}});
  });
  await page.goto('/');
  await page.waitForSelector('.demo');
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await expect(page).toHaveTitle('EDG Commerce · Tienda y gestión');
  await expect(page.locator('.demo')).toContainText('TIENDA EN PREPARACIÓN');
  const products=await (await page.request.get('/api/products')).json();
  await expect(page.locator('.product-price').first()).toHaveText(new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(products[0].price/100));
  for(const button of await page.locator('.product-add').all())await expect(button).toBeDisabled();
  await page.locator('.product-visual').first().click();
  await expect(page.getByRole('button',{name:'Disponible próximamente',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.goto('/#cart');
  await expect(page.getByText('Próximamente podrás comprar',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Continuar con el envío/})).toHaveCount(0);
});
