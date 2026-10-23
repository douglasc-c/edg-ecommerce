import {test,expect} from '@playwright/test';

const languageSelect=page=>page.locator('.store-header [data-language-select]');
const countryHint=(country,language)=>({country,suggested_language:language,language_source:'country'});

async function configureCountry(page,getHint){
  await page.route('**/api/config',async route=>{
    const response=await route.fetch(),config=await response.json();
    await route.fulfill({response,json:{...config,mode:'catalog',currency:'EUR',checkout_enabled:false,...getHint()}});
  });
}

test('el país elige el idioma inicial y la elección manual prevalece tras recargar',async({page})=>{
  let hint=countryHint('BR','pt-BR');
  await configureCountry(page,()=>hint);
  await page.goto('/');
  const select=languageSelect(page),header=page.locator('.store-header');
  await expect(select).toHaveValue('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
  await expect(header.getByRole('link',{name:'Início',exact:true})).toBeVisible();
  await expect(page.locator('#catalog h2')).toHaveText('A COLEÇÃO.');
  expect(await page.evaluate(()=>localStorage.getItem('edg.language'))).toBeNull();
  expect(await select.locator('option').allTextContents()).toEqual(['🇪🇸','🇬🇧','🇧🇷']);
  for(const name of ['Español','English','Português do Brasil'])await expect(select.getByRole('option',{name,exact:true})).toHaveCount(1);
  await expect(select).toHaveAccessibleName('Idioma');

  await select.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(select).toHaveAccessibleName('Language');
  await expect(header.getByRole('link',{name:'Home',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('edg.language'))).toBe('en');
  hint=countryHint('ES','es');
  await page.reload();
  await expect(select).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#catalog h2')).toHaveText('THE COLLECTION.');
  await select.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await expect(header.getByRole('link',{name:'Inicio',exact:true})).toBeVisible();
});

test('cambiar idioma conserva el catálogo, el vídeo y los formularios y traduce las páginas editoriales',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await configureCountry(page,()=>countryHint('ES','es'));
  const customCategory='Ver mi colección',customProduct='EDG QA categoría singular 42';
  let productRequests=0;
  await page.route('**/api/products',async route=>{
    productRequests++;
    const response=await route.fetch(),products=await response.json();
    products[0]={...products[0],name:'Inicio',description:'LA COLECCIÓN.',category:'Camiseta',price:12990,
      variants:(products[0].variants||[]).map(variant=>({...variant,price:12990,price_override:null}))};
    products[1]={...products[1],name:customProduct,category:customCategory};
    await route.fulfill({response,json:products});
  });
  await page.goto('/');
  const select=languageSelect(page),header=page.locator('.store-header');
  await expect(select).toHaveValue('es');
  const customFilter=page.locator(`[data-action="filter"][data-category="${customCategory}"]`);
  const customTile=page.locator(`[data-action="collection"][data-category="${customCategory}"] strong`);
  await expect(customFilter).toHaveText(customCategory);
  await expect(page.locator('#product-grid .product').filter({has:page.getByRole('heading',{name:customProduct,exact:true})}).locator('.product-info .muted')).toHaveText(customCategory);
  await page.locator('#product-search').fill('Inicio');
  await page.locator('[data-action="filter"][data-category="Camiseta"]').click();
  await expect(page.locator('#product-grid .product')).toHaveCount(1);
  await page.evaluate(()=>{window.__languageVideo=document.querySelector('#campaign-video');window.scrollTo({top:600,behavior:'instant'});});
  await expect(header).toHaveClass(/is-scrolled/);
  // Header scroll direction is covered in header.spec; this test preserves the
  // actual scroll position while changing language, even on a shorter catalog.
  const scroll=await page.evaluate(()=>window.scrollY),requestsBeforeSwitch=productRequests;
  for(const [language,locale,heading] of [['en','en-GB','THE COLLECTION.'],['pt-BR','pt-BR','A COLEÇÃO.']]){
    await select.selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await expect(page.locator('#catalog h2')).toHaveText(heading);
    await expect(page.locator('#product-search')).toHaveValue('Inicio');
    await expect(page.locator('[data-action="filter"][data-category="Camiseta"]')).toHaveClass(/active/);
    await expect(page.locator('#product-grid .product')).toHaveCount(1);
    await expect(page.locator('#product-grid h3')).toHaveText('Inicio');
    await expect(customFilter).toHaveText(customCategory);
    await expect(customTile).toHaveText(customCategory);
    await expect(page.locator('#product-grid .product-price')).toHaveText(new Intl.NumberFormat(locale,{style:'currency',currency:'EUR'}).format(129.9));
    expect(await page.evaluate(()=>document.querySelector('#campaign-video')===window.__languageVideo)).toBe(true);
    expect(Math.abs(await page.evaluate(()=>window.scrollY)-scroll)).toBeLessThanOrEqual(2);
    expect(productRequests).toBe(requestsBeforeSwitch);
  }
  await page.locator('#product-grid [data-action="product"]').click();
  const modal=page.locator('#dialog');
  await expect(modal.locator('#dialog-title')).toHaveText('Inicio');
  await expect(modal.getByText('LA COLECCIÓN.',{exact:true})).toBeVisible();
  await modal.locator('[data-action="close"]').click();

  await page.evaluate(()=>{window.location.hash='skate';});
  await expect(page.locator('#skate-title')).toBeVisible();
  await expect(page.locator('.skate-hero-copy p')).toHaveText('Nossa história se escreve nas ruas.');
  await expect(page).toHaveTitle('SKATE · História e vídeos · EDG Skateboards');
  await select.selectOption('en');
  await expect(page.locator('.skate-hero-copy p')).toHaveText('Our story is written in the streets.');
  await expect(page).toHaveTitle('SKATE · History and videos · EDG Skateboards');
  await page.evaluate(()=>{window.location.hash='musica';});
  await expect(page.locator('#music-title')).toHaveText('MUSIC');
  await expect(page.locator('.skate-hero-copy p')).toHaveText('Brazilian roots. Rap made in Barcelona.');
  await expect(page).toHaveTitle('MUSIC · History and albums · EDG');
  await select.selectOption('pt-BR');
  await expect(page.locator('#music-title')).toHaveText('MÚSICA');
  await expect(page.locator('.skate-hero-copy p')).toHaveText('Raízes brasileiras. Rap feito em Barcelona.');
  await expect(page).toHaveTitle('MÚSICA · História e discos · EDG');

  await header.locator('[data-action="login"]').click();
  const email=modal.locator('[name="email"]'),password=modal.locator('[name="password"]');
  await email.fill('typed@example.test');
  await password.fill('Contenido que debe permanecer');
  await page.evaluate(()=>{window.__languageForm=document.querySelector('#auth-form');window.EDGI18n.setLanguage('en');});
  await expect(modal.locator('#dialog-title')).toHaveText('Welcome');
  await expect(email).toHaveAccessibleName('Email');
  await expect(password).toHaveAccessibleName('Password');
  await expect(email).toHaveValue('typed@example.test');
  await expect(password).toHaveValue('Contenido que debe permanecer');
  expect(await page.evaluate(()=>document.querySelector('#auth-form')===window.__languageForm)).toBe(true);
  await page.evaluate(()=>window.EDGI18n.setLanguage('es'));
  await expect(modal.locator('#dialog-title')).toHaveText('Te damos la bienvenida');
  await expect(email).toHaveValue('typed@example.test');
  expect(errors).toEqual([]);
});

test('el selector de banderas cabe en el menú móvil al inicio y tras desplazarse',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await configureCountry(page,()=>countryHint('GB','en'));
  await page.goto('/');
  const select=languageSelect(page),header=page.locator('.store-header');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('en');
  const fits=async()=>{
    const bounds=await select.evaluate(element=>{
      const box=element.getBoundingClientRect(),header=element.closest('.store-header').getBoundingClientRect();
      return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,headerTop:header.top,headerBottom:header.bottom,viewport:window.innerWidth};
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerTop);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.headerBottom);
  };
  await fits();
  await header.locator('[data-action="open-store-menu"]').click();
  await expect(page.locator('#store-menu').getByRole('link',{name:'MUSIC',exact:true})).toBeVisible();
  await page.locator('[data-action="close-store-menu"]').click();
  await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));
  await expect(header).toHaveClass(/is-scrolled/);
  await page.evaluate(()=>window.scrollTo({top:450,behavior:'instant'}));
  await expect(header).not.toHaveClass(/is-scroll-hidden/);
  await select.selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
  await expect(select).toHaveAccessibleName('Idioma');
  await fits();
});
