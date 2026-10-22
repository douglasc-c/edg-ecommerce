import {test,expect} from '@playwright/test';

const firstVideo='5cABW1VGMCE';
const secondVideo='KDz0vLjBz_4';
const playButton=(page,id)=>page.locator(`.skate-featured-grid [data-action="play-skate"][data-id="${id}"]`);

test.beforeEach(async({page})=>{
  // Exercise our player lifecycle without depending on YouTube availability.
  await page.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#333"/></svg>'}));
  await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><body><button>Vídeo de prueba</button></body></html>'}));
});

test('SKATE abre y se recarga sin sesión ni dependencia del catálogo',async({page})=>{
  let catalogRequests=0;
  await page.route('**/api/products',route=>{catalogRequests++;return route.fulfill({status:503,json:{error:'Catálogo temporalmente no disponible'}});});
  await page.route('**/api/categories',route=>route.fulfill({status:503,json:{error:'Categorías temporalmente no disponibles'}}));
  for(const load of [()=>page.goto('/#skate'),()=>page.reload()]){
    const response=await load();
    expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers()['content-security-policy']).toContain('frame-src https://www.youtube-nocookie.com;');
    await expect(page.locator('.skate-page').getByRole('heading',{name:'SKATE',exact:true})).toBeVisible();
    await expect(page.locator('.skate-featured-grid .skate-film')).toHaveCount(2);
    await expect(playButton(page,firstVideo)).toBeVisible();
    await expect(playButton(page,secondVideo)).toBeVisible();
    await expect(page.locator('.skate-page iframe')).toHaveCount(0);
    await expect(page.locator('#dialog')).not.toBeVisible();
  }
  expect(catalogRequests).toBe(0);
});

test('los destacados se reproducen bajo demanda y solo mantienen un reproductor',async({page})=>{
  await page.goto('/#skate');
  const first=playButton(page,firstVideo);
  await expect(first).toBeVisible();
  await expect(page.locator('.skate-page iframe')).toHaveCount(0);
  await first.focus();
  await page.keyboard.press('Enter');
  let frame=page.locator('.skate-page iframe');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src',new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${firstVideo}\\?`));
  const source=new URL(await frame.getAttribute('src'));
  expect(source.searchParams.get('autoplay')).toBe('1');
  expect(source.searchParams.get('playsinline')).toBe('1');
  await expect(frame).toBeFocused();
  await expect(page.locator(`.skate-featured-grid a[href="https://www.youtube.com/watch?v=${firstVideo}"]`)).toBeVisible();

  await playButton(page,secondVideo).click();
  frame=page.locator('.skate-page iframe');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src',new RegExp(`/embed/${secondVideo}\\?`));
  await expect(playButton(page,firstVideo)).toBeVisible();
  await expect(page.locator(`.skate-featured-grid a[href="https://www.youtube.com/watch?v=${secondVideo}"]`)).toBeVisible();

  await page.evaluate(()=>{location.hash='cart';});
  await expect(page.locator('.skate-page')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('el menú lateral identifica SKATE, cierra con Escape y permite volver a la tienda',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#skate');
  const drawer=page.locator('#store-menu');
  const open=page.getByRole('button',{name:'Abrir menú',exact:true});
  await open.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link',{name:'SKATE',exact:true})).toHaveAttribute('aria-current','page');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(open).toBeFocused();

  await open.click();
  await page.setViewportSize({width:1001,height:844});
  await expect(drawer).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/store-menu-visible/);
  await expect(open).toBeHidden();
  await expect(page.getByRole('banner').getByRole('link',{name:'Inicio',exact:true})).toBeFocused();
  await page.setViewportSize({width:1000,height:844});
  await expect(open).toBeVisible();

  await open.click();
  await drawer.getByRole('link',{name:'Inicio',exact:true}).click();
  await expect(page).toHaveURL(/#store$/);
  await expect(drawer).not.toBeVisible();
  await page.locator('.store-header .toplinks').getByRole('link',{name:'Skate',exact:true}).click();
  await expect(page).toHaveURL(/#skate$/);
  await expect(page.locator('.skate-page h1')).toHaveText('SKATE');
});

test('en móvil los capítulos conservan el reproductor y la página no desborda',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#skate');
  await playButton(page,firstVideo).click();
  const frame=page.locator('.skate-page iframe');
  await expect(frame).toHaveCount(1);
  const originalFrame=await frame.elementHandle();
  await page.locator('.skate-section-nav [data-section="historia"]').click();
  await expect(page).toHaveURL(/#skate$/);
  await expect(page.locator('#skate-historia')).toBeInViewport();
  expect(await originalFrame.evaluate(node=>node.isConnected)).toBe(true);
  await expect(frame).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('skate-mobile-history.png')});
});


test('el archivo se amplía y todos los enlaces conservan el vídeo seleccionado',async({page})=>{
  await page.goto('/#skate');
  const cards=page.locator('.skate-archive-grid .skate-film');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('.skate-archive-grid .skate-film:visible')).toHaveCount(3);
  const more=page.locator('[data-action="skate-more"]');
  await more.click();
  await expect(page.locator('.skate-archive-grid .skate-film:visible')).toHaveCount(6);
  await expect(more).toHaveAttribute('aria-expanded','true');
  const links=await cards.locator('a').evaluateAll(nodes=>nodes.map(n=>n.href));
  expect(new Set(links).size).toBe(6);
  expect(links.every(url=>url.startsWith('https://www.youtube.com/watch?v='))).toBe(true);
  await more.click();
  await expect(page.locator('.skate-archive-grid .skate-film:visible')).toHaveCount(3);
});
