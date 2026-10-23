import {test,expect} from '@playwright/test';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

const unavailable={
  es:'La tienda no está disponible en este momento. Vuelve a intentarlo más tarde.',
  en:'The store is currently unavailable. Please try again later.',
  'pt-BR':'A loja está indisponível no momento. Tente novamente mais tarde.',
};

for(const scenario of [
  {name:'HTML de error del servidor',status:500,contentType:'text/html',body:'<!DOCTYPE html><h1>Worker exception</h1>',language:'es'},
  {name:'HTML de assets con estado 200',status:200,contentType:'text/html',body:'<!DOCTYPE html><h1>Storefront</h1>',language:'en'},
  {name:'JSON malformado',status:200,contentType:'application/json',body:'<!DOCTYPE html><h1>Invalid JSON</h1>',language:'pt-BR'},
  {name:'problema JSON de Cloudflare',status:500,contentType:'application/problem+json',body:JSON.stringify({title:'Worker threw exception',status:500,error_code:1101,cloudflare_error:true}),language:'en'},
  {name:'acceso denegado de Cloudflare',status:403,contentType:'application/json',body:JSON.stringify({title:'Access denied',status:403,error_code:1010,cloudflare_error:true}),language:'pt-BR'},
  {name:'HTML al consultar la sesión',path:'/auth/me',status:503,contentType:'text/html',body:'<!DOCTYPE html><h1>Service unavailable</h1>',language:'es'},
]){
  test(`muestra un error traducido ante ${scenario.name} y recupera tras recargar`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(language=>localStorage.setItem('edg.language',language),scenario.language);
    await page.route('**/*.mp4',route=>route.abort());
    const url=`**/api${scenario.path||'/config'}`;
    await page.route(url,async route=>{
      expect(route.request().headers().accept).toBe('application/json');
      await route.fulfill({status:scenario.status,contentType:scenario.contentType,body:scenario.body});
    });
    await page.goto('/');
    await expect(page.locator('#app .empty')).toContainText(unavailable[scenario.language]);
    await expect(page.locator('.store-loading')).toHaveCount(0);
    await expect(page.locator('#app')).not.toContainText(/Unexpected token|DOCTYPE|Worker exception|Access denied/);
    expect(errors).toEqual([]);
    await page.unroute(url);
    await page.reload();
    await expect(page.locator('#product-grid .product').first()).toBeVisible();
    await expect(page.locator('#app .empty')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('conserva los mensajes JSON de validación de la aplicación',async({page})=>{
  await page.route('**/api/config',route=>route.fulfill({status:400,json:{error:'Mensaje de validación de la aplicación.'}}));
  await page.goto('/');
  await expect(page.locator('#app .empty')).toContainText('Mensaje de validación de la aplicación.');
});
