import {test,expect} from '@playwright/test';

const videos=['rCEez-8asOg','LdxB1RLR0lo'];
const playButton=(page,id)=>page.locator(`.music-page [data-action="play-music"][data-id="${id}"]`);

test.beforeEach(async({page})=>{
  // Test our page and player lifecycle independently of YouTube availability.
  await page.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#333"/></svg>'}));
  await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><body><button>Vídeo de prueba</button></body></html>'}));
});

test('MÚSICA abre y se recarga sin sesión ni dependencia del catálogo',async({page})=>{
  let catalogRequests=0;
  for(const endpoint of ['products','categories']){
    await page.route(`**/api/${endpoint}`,route=>{catalogRequests++;return route.fulfill({status:503,json:{error:'Catálogo temporalmente no disponible'}});});
  }
  for(const load of [()=>page.goto('/#musica'),()=>page.reload()]){
    const response=await load();
    expect(response.status()).toBe(200);
    expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers()['content-security-policy']).toContain('frame-src https://www.youtube-nocookie.com;');
    await expect(page.locator('.music-page h1')).toHaveText('MÚSICA');
    await expect(page).toHaveTitle(/MÚSICA.*EDG/);
    await expect(page.locator('#musica-videos .skate-film')).toHaveCount(2);
    await expect(page.locator('.music-page iframe')).toHaveCount(0);
    await expect(page.locator('#dialog')).not.toBeVisible();
    for(const id of videos)await expect(playButton(page,id)).toBeVisible();
    await expect(page.locator('.music-timeline li time')).toHaveText(['2010','2012','2016','2018','2020','2025']);
  }
  expect(catalogRequests).toBe(0);
});

test('los dos vídeos se reproducen bajo demanda y el anterior se detiene',async({page})=>{
  await page.goto('/#musica');
  await playButton(page,videos[0]).focus();
  await page.keyboard.press('Enter');
  let frame=page.locator('.music-page iframe');
  await expect(frame).toHaveCount(1);
  let source=new URL(await frame.getAttribute('src'));
  expect(source.origin).toBe('https://www.youtube-nocookie.com');
  expect(source.pathname).toBe(`/embed/${videos[0]}`);
  expect(source.searchParams.get('autoplay')).toBe('1');
  expect(source.searchParams.get('playsinline')).toBe('1');
  await expect(frame).toBeFocused();

  await playButton(page,videos[1]).click();
  frame=page.locator('.music-page iframe');
  await expect(frame).toHaveCount(1);
  source=new URL(await frame.getAttribute('src'));
  expect(source.pathname).toBe(`/embed/${videos[1]}`);
  await expect(playButton(page,videos[0])).toBeVisible();
  for(const id of videos){
    const fallback=page.locator(`#musica-videos a[href="https://www.youtube.com/watch?v=${id}"]`);
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('target','_blank');
  }

  await page.evaluate(()=>{location.hash='cart';});
  await expect(page.locator('.music-page')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('el menú lateral y los enlaces del sitio conectan con MÚSICA',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#skate');
  const drawer=page.locator('#store-menu');
  await page.getByRole('button',{name:'Abrir menú',exact:true}).click();
  await drawer.getByRole('link',{name:'MÚSICA',exact:true}).click();
  await expect(page).toHaveURL(/#musica$/);
  await expect(page.locator('.music-page h1')).toHaveText('MÚSICA');
  await expect(drawer).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/store-menu-visible/);
  const open=page.getByRole('button',{name:'Abrir menú',exact:true});
  await open.click();
  await expect(drawer.getByRole('link',{name:'MÚSICA',exact:true})).toHaveAttribute('aria-current','page');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(page.locator('.store-header a[href="#musica"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.footer a[href="#musica"]')).toHaveCount(1);

  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.store-header a[href="#skate"]').click();
  await expect(page).toHaveURL(/#skate$/);
  await page.locator('.store-header a[href="#musica"]').click();
  await expect(page).toHaveURL(/#musica$/);
  await expect(page.locator('.music-page h1')).toHaveText('MÚSICA');
});

test('los capítulos no reconstruyen el reproductor y las portadas mantienen su tamaño',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/#musica');
  await playButton(page,videos[0]).click();
  const originalFrame=await page.locator('.music-page iframe').elementHandle();
  const covers=page.locator('.music-album-grid .music-album img');
  await expect(covers).toHaveCount(5);

  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await page.locator('.music-page .skate-section-nav [data-section="discos"]').click();
    await expect(page).toHaveURL(/#musica$/);
    await expect(page.locator('#musica-discos')).toBeInViewport();
    expect(await originalFrame.evaluate(node=>node.isConnected)).toBe(true);
    await expect(page.locator('.music-page iframe')).toHaveCount(1);
    await expect.poll(()=>covers.evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
    const sizes=await covers.evaluateAll(images=>images.map(img=>{
      const style=getComputedStyle(img),rect=img.getBoundingClientRect();
      return {source:img.getAttribute('src'),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:rect.width,height:rect.height,border:style.borderTopWidth,radius:style.borderTopLeftRadius,shadow:style.boxShadow};
    }));
    for(const cover of sizes){
      expect(cover.source).toMatch(/^\/music\//);
      expect(cover.naturalWidth).toBe(cover.naturalHeight);
      expect(Math.abs(cover.width-cover.height)).toBeLessThan(1);
      expect(Math.abs(cover.width-sizes[0].width)).toBeLessThan(1);
      expect(cover.border).toBe('0px');
      expect(cover.radius).toBe('0px');
      expect(cover.shadow).toBe('none');
    }
    const viewport=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    expect(viewport.scrollWidth,`La página no debe desbordar a ${viewport.width}px`).toBeLessThanOrEqual(viewport.width);
    if(width===320){
      const headerLinks=page.locator('.store-header .toplinks a');
      const lastHeaderLink=headerLinks.last();
      await headerLinks.first().focus();
      for(let index=1;index<await headerLinks.count();index++)await page.keyboard.press('Tab');
      await expect(lastHeaderLink).toBeFocused();
      await expect.poll(()=>lastHeaderLink.evaluate(node=>{
        const rect=node.getBoundingClientRect(),nav=node.parentElement;
        if(rect.left>=-1&&rect.right<=innerWidth+1)return 'visible';
        return JSON.stringify({left:rect.left,right:rect.right,scrollLeft:nav.scrollLeft,clientWidth:nav.clientWidth,scrollWidth:nav.scrollWidth,activeElement:document.activeElement?.textContent});
      })).toBe('visible');
    }
  }
  await page.locator('.music-page .skate-section-nav [data-section="historia"]').click();
  await expect(page.locator('#musica-historia')).toBeInViewport();
  expect(await originalFrame.evaluate(node=>node.isConnected)).toBe(true);
});
