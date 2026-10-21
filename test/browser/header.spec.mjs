import {test,expect} from '@playwright/test';

async function waitForScrollToSettle(page){
  await page.evaluate(()=>new Promise(resolve=>{
    let previous=scrollY,stableFrames=0;
    const check=()=>{
      const current=scrollY;
      stableFrames=Math.abs(current-previous)<0.1?stableFrames+1:0;
      previous=current;
      if(stableFrames>=3)resolve();else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

for(const scenario of [
  {name:'escritorio',viewport:{width:1440,height:1000},reducedMotion:'no-preference'},
  {name:'móvil con movimiento reducido',viewport:{width:390,height:844},reducedMotion:'reduce'},
])test(`el header cambia al desplazar, conserva el foco y no tapa la colección: ${scenario.name}`,async({page})=>{
  await page.setViewportSize(scenario.viewport);
  await page.emulateMedia({reducedMotion:scenario.reducedMotion});
  await page.goto('/');
  const header=page.getByRole('banner');
  const home=header.getByRole('link',{name:'Inicio',exact:true});
  const logo=header.getByRole('link',{name:'EDG',exact:true,includeHidden:true});
  const accessibleLogo=header.getByRole('link',{name:'EDG',exact:true});
  await expect(header).toHaveCSS('background-color','rgb(0, 0, 0)');
  const initialHeight=(await header.boundingBox()).height;
  await expect(logo).toHaveCount(1);
  await expect(accessibleLogo).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
  await logo.evaluate(link=>link.focus());
  await expect(home).toBeFocused();

  await page.evaluate(()=>window.scrollTo(0,400));
  await expect(header).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(accessibleLogo).toBeVisible();
  const scrolledBox=await header.boundingBox();
  expect(Math.abs(scrolledBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(scrolledBox.height-initialHeight)).toBeLessThanOrEqual(1);
  await logo.focus();
  await expect(logo).toBeFocused();

  await page.evaluate(()=>window.scrollTo(0,0));
  await expect(header).toHaveCSS('background-color','rgb(0, 0, 0)');
  await expect(accessibleLogo).toHaveCount(0);
  await expect(home).toBeFocused();
  await logo.evaluate(link=>link.focus());
  await expect(home).toBeFocused();
  expect(Math.abs((await header.boundingBox()).height-initialHeight)).toBeLessThanOrEqual(1);

  if(scenario.reducedMotion==='reduce'){
    for(const element of [header,header.locator('.store-header-brand')]){
      const durations=await element.evaluate(node=>getComputedStyle(node).transitionDuration.split(',').map(value=>parseFloat(value)));
      expect(durations.every(duration=>duration===0)).toBe(true);
    }
  }

  const previousHeader=await header.elementHandle();
  await header.getByRole('link',{name:'Colección',exact:true}).click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect.poll(()=>previousHeader.evaluate(node=>node.isConnected)).toBe(false);
  const collectionTitle=page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true});
  await expect(collectionTitle).toBeInViewport({ratio:1});
  await waitForScrollToSettle(page);
  const titleBox=await collectionTitle.boundingBox(),headerBox=await header.boundingBox();
  expect(titleBox.y).toBeGreaterThanOrEqual(headerBox.y+headerBox.height-1);
  expect(titleBox.y+titleBox.height).toBeLessThanOrEqual(scenario.viewport.height);

  // Inspect the replacement header before its first paint, so a black flash cannot pass by settling later.
  await header.evaluate(current=>{
    window.rebuiltHeaderBackground=null;
    const observer=new MutationObserver(()=>{
      if(current.isConnected)return;
      const replacement=document.querySelector('header');
      if(!replacement)return;
      window.rebuiltHeaderBackground=getComputedStyle(replacement).backgroundColor;
      observer.disconnect();
    });
    observer.observe(current.parentElement,{childList:true});
  });
  await page.locator('.filters').getByRole('button').nth(1).click();
  await expect.poll(()=>page.evaluate(()=>window.rebuiltHeaderBackground)).toBe('rgb(255, 255, 255)');
  await expect(accessibleLogo).toBeVisible();
  await waitForScrollToSettle(page);
  expect(Math.abs((await header.boundingBox()).y)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
