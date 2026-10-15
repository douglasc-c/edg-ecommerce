import {test,expect} from '@playwright/test';
test('catálogo em euros exibe vitrine e bloqueia compras na interface',async({page})=>{
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({response,json:{...config,mode:'catalog',currency:'EUR',checkout_enabled:false}});
  });
  await page.goto('/');
  await expect(page.locator('.demo')).toContainText('LOJA EM PREPARAÇÃO');
  await expect(page.locator('.product-price').first()).toContainText('€');
  for(const button of await page.locator('.product-add').all())await expect(button).toBeDisabled();
  await page.locator('.product-visual').first().click();
  await expect(page.getByRole('button',{name:'Disponível em breve',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.goto('/#cart');
  await expect(page.getByText('Compras disponíveis em breve',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Continuar para entrega/})).toHaveCount(0);
});
