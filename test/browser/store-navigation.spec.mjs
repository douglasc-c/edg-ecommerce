import {test,expect} from '@playwright/test';

test.use({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});

async function expectHeroPlaybackAtTop(page){
  const hero=page.getByRole('region',{name:'EDG Skateboards',exact:true});
  const video=hero.locator('video');
  await expect(hero).toBeVisible();
  let maximumScroll=0,sawIntro=false;
  await expect.poll(async()=>{
    const state=await video.evaluate(media=>({source:media.currentSrc,time:media.currentTime,paused:media.paused,scroll:window.scrollY}));
    maximumScroll=Math.max(maximumScroll,Math.abs(state.scroll));
    sawIntro||=state.source.endsWith('/edg-intro.mp4')&&!state.paused&&state.time>0;
    // Observe through the content reveal, without waiting for another full logo cycle.
    return sawIntro&&state.source.endsWith('/edg-logo-tremor-loop.mp4')&&!state.paused&&state.time>.75;
  },{timeout:6000,intervals:[100]}).toBe(true);
  expect(maximumScroll,'Opening the store must keep the hero at the top throughout playback and reveal').toBeLessThanOrEqual(1);
}

test('abrir y recargar #catalog conserva el hero y los enlaces llevan a la colección al pulsarlos',async({page})=>{
  await page.goto('/#catalog',{waitUntil:'domcontentloaded'});
  await expectHeroPlaybackAtTop(page);
  await expect(page).toHaveURL(/#catalog$/);

  await page.reload({waitUntil:'domcontentloaded'});
  await expectHeroPlaybackAtTop(page);

  const collection=page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true});
  await page.getByRole('link',{name:/Explorar la colección/}).click();
  await expect(collection).toBeInViewport({ratio:1});

  const header=page.getByRole('banner');
  await header.getByRole('link',{name:'Inicio',exact:true}).click();
  await expect(page).toHaveURL(/#store$/);
  await page.mouse.wheel(0,-5000);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await header.getByRole('link',{name:'Colección',exact:true}).click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(collection).toBeInViewport({ratio:1});
});
