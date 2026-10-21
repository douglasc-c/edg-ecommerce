import {test,expect} from '@playwright/test';

async function carouselElements(page){
  const carousel=page.getByRole('region',{name:'Diseños de tablas EDG',exact:true});
  await carousel.scrollIntoViewIfNeeded();
  return {carousel,track:carousel.locator('.deck-carousel-track'),window:carousel.locator('.deck-carousel-window')};
}

async function expectMoving(track){
  const initial=(await track.boundingBox()).x;
  await expect.poll(async()=>Math.abs((await track.boundingBox()).x-initial)).toBeGreaterThan(5);
}

async function expectStill(track){
  const movement=await track.evaluate(async element=>{
    const initial=element.getBoundingClientRect().x;
    // Observe a real interval so a brief frame without movement cannot hide a running animation.
    await new Promise(resolve=>setTimeout(resolve,350));
    return Math.abs(element.getBoundingClientRect().x-initial);
  });
  expect(movement).toBeLessThanOrEqual(1);
}

test('el carrusel se pausa al pasar el ratón y continúa al retirarlo',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');
  const {carousel,track}=await carouselElements(page);
  await page.mouse.move(0,0);
  await expectMoving(track);
  await carousel.hover();
  await expect(track).toHaveCSS('animation-play-state','paused');
  await expectStill(track);
  await page.mouse.move(0,0);
  await expectMoving(track);
});

test.describe('carrusel táctil',()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

  test('tocar las tablas no deja detenida la animación automática',async({page})=>{
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto('/');
    const {carousel,track}=await carouselElements(page);
    expect(await page.evaluate(()=>matchMedia('(hover:none)').matches)).toBe(true);
    await expectMoving(track);
    await carousel.tap();
    await expectMoving(track);
    await carousel.tap();
    await expectMoving(track);
  });

  test('el carrusel no necesita un botón de activación con movimiento reducido',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/');
    const {carousel,track}=await carouselElements(page);
    await expect(page.locator('.campaign-play')).toHaveCount(0);
    await expectMoving(track);
    await carousel.tap();
    await expectMoving(track);
    expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)).toBe(true);
  });
});
