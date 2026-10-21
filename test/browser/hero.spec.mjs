import {test,expect} from '@playwright/test';

const INTRO='/edg-intro.mp4';
const LOOP='/edg-logo-tremor-loop.mp4';

function heroElements(page){
  const hero=page.getByRole('region',{name:'EDG Skateboards',exact:true});
  return {
    hero,
    intro:hero.locator('#campaign-intro'),
    loop:hero.locator('#campaign-video'),
    poster:hero.locator('img[src="/edg-logo-tremor-poster.png"]'),
    description:hero.getByText('Skateboarding y cultura urbana.',{exact:true}),
    collection:hero.getByRole('link',{name:/Explorar la colección/,includeHidden:true}),
  };
}

function mediaRequests(page){
  const requests=[];
  page.on('request',request=>{
    const pathname=new URL(request.url()).pathname;
    if(pathname.endsWith('.mp4'))requests.push(pathname);
  });
  return requests;
}

async function expectPlaying(video){
  await expect.poll(()=>video.evaluate(media=>!media.paused&&media.currentTime>0)).toBe(true);
}

async function expectNoPlaybackControls(hero){
  await expect(hero.getByRole('button',{includeHidden:true})).toHaveCount(0);
  await expect(hero.locator('video[controls]')).toHaveCount(0);
}

async function expectStaticHero({hero,intro,loop,poster,description,collection}){
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expect(poster).toBeVisible();
  await expect(poster).toHaveCSS('opacity','1');
  await expect.poll(()=>poster.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  for(const video of [intro,loop]){
    await expect(video).toHaveJSProperty('paused',true);
    await expect(video).toHaveCSS('opacity','0');
  }
  await expectNoPlaybackControls(hero);
}

async function observeMediaEvents(page){
  await page.addInitScript(()=>{
    window.heroMediaEvents=[];
    for(const type of ['playing','ended'])document.addEventListener(type,event=>{
      const media=event.target;
      if(!(media instanceof HTMLVideoElement))return;
      window.heroMediaEvents.push({type,source:new URL(media.currentSrc,location.href).pathname,trusted:event.isTrusted});
    },true);
  });
}

test('la intro termina antes de mostrar la colección y activar el loop sin controles ni repetirse al volver',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const requests=mediaRequests(page);
  await observeMediaEvents(page);
  let releaseIntro;
  const introGate=new Promise(resolve=>releaseIntro=resolve);
  await page.route(`**${INTRO}`,async route=>{await introGate;await route.continue();});
  try{
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const {hero,intro,loop,description,collection}=heroElements(page);
    await expect(hero).toBeVisible();
    await expectNoPlaybackControls(hero);
    await expect.poll(()=>requests.includes(INTRO)).toBe(true);
    await expect(description).toBeHidden();
    await expect(collection).toHaveCount(1);
    await expect(collection).toBeHidden();
    await expect(loop).toHaveJSProperty('paused',true);

    releaseIntro();
    await expectPlaying(intro);
    await expect(description).toBeHidden();
    await expect(collection).toBeHidden();
    await expect(loop).toHaveJSProperty('paused',true);
    await expect(intro).toHaveJSProperty('ended',true,{timeout:10000});
    await expect(description).toBeVisible();
    await expect(collection).toBeVisible();
    await expect(hero.getByText('ORIGINAL . BARCELONA',{exact:true})).toBeVisible();
    await expect(hero.getByText('EDG / Skateboards',{exact:true})).toHaveCount(0);
    await expectPlaying(loop);

    const events=await page.evaluate(()=>window.heroMediaEvents);
    const introPlaying=events.findIndex(event=>event.type==='playing'&&event.source===INTRO);
    const introEnded=events.findIndex(event=>event.type==='ended'&&event.source===INTRO&&event.trusted);
    const loopPlaying=events.findIndex(event=>event.type==='playing'&&event.source===LOOP);
    expect(introPlaying).toBeGreaterThanOrEqual(0);
    expect(introEnded).toBeGreaterThan(introPlaying);
    expect(loopPlaying).toBeGreaterThan(introEnded);

    const introRequestCount=requests.filter(path=>path===INTRO).length;
    const introPlayCount=events.filter(event=>event.type==='playing'&&event.source===INTRO).length;
    await page.getByRole('banner').getByRole('link',{name:/Carrito/}).click();
    await expect(hero).toHaveCount(0);
    await page.getByRole('link',{name:'Inicio',exact:true}).click();
    await expect(collection).toBeVisible();
    await expect(description).toBeVisible();
    await expectNoPlaybackControls(hero);
    await expectPlaying(loop);
    expect(requests.filter(path=>path===INTRO)).toHaveLength(introRequestCount);
    expect(await page.evaluate(()=>window.heroMediaEvents.filter(event=>event.type==='playing'&&event.source==='/edg-intro.mp4').length)).toBe(introPlayCount);
    expect(errors).toEqual([]);
  }finally{
    releaseIntro();
  }
});

test('movimiento reducido muestra contenido y poster estático sin controles ni descargas MP4',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests=mediaRequests(page);
  await page.goto('/');
  await expectStaticHero(heroElements(page));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(requests).toEqual([]);
});

test('una intro no encontrada mantiene la colección accesible y reproduce el loop',async({page})=>{
  await page.route(`**${INTRO}`,route=>route.fulfill({status:404,contentType:'text/plain',body:'Intro not found'}));
  await page.goto('/');
  const {hero,loop,description,collection}=heroElements(page);
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expectPlaying(loop);
  await expectNoPlaybackControls(hero);
  await collection.click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true})).toBeInViewport();
});

test('el bloqueo del autoplay conserva contenido accesible y poster estático sin controles',async({page})=>{
  await page.addInitScript(()=>{
    window.autoplayRejections=0;
    HTMLMediaElement.prototype.play=function(){
      window.autoplayRejections++;
      return Promise.reject(new DOMException('Autoplay blocked for this test','NotAllowedError'));
    };
  });
  await observeMediaEvents(page);
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>window.autoplayRejections)).toBeGreaterThan(0);
  await expectStaticHero(heroElements(page));
  const playing=await page.evaluate(()=>window.heroMediaEvents.filter(event=>event.type==='playing'));
  expect(playing).toEqual([]);
});
