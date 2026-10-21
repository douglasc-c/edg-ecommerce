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

  test('movimiento reducido permite deslizar y activar las animaciones voluntariamente',async({page,browserName})=>{
    test.skip(browserName!=='chromium','El gesto táctil nativo usa CDP; Safari requiere la comprobación equivalente en un dispositivo.');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/');
    const {carousel,track,window}=await carouselElements(page);
    await expectStill(track);
    await expect.poll(()=>carousel.getByRole('img').first().evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    const bounds=await window.boundingBox();
    const session=await page.context().newCDPSession(page);
    try{
      const startX=bounds.x+bounds.width*.8;
      const y=bounds.y+bounds.height/2;
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y,id:0}]});
      for(let step=1;step<=12;step++){
        // Pace native touch moves so the browser recognizes a swipe rather than a tap.
        await page.waitForTimeout(30);
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX-step*18,y,id:0}]});
      }
      // Hold before lifting the finger so inertial scrolling does not affect the static check.
      await page.waitForTimeout(200);
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }finally{await session.detach();}
    await expect.poll(()=>window.evaluate(element=>element.scrollLeft)).toBeGreaterThan(100);
    await expectStill(track);
    await page.getByRole('button',{name:'Activar animaciones',exact:true}).click();
    await carousel.scrollIntoViewIfNeeded();
    await expectMoving(track);
    expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)).toBe(true);
  });
});
