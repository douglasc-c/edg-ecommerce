import {test,expect} from '@playwright/test';

const INTRO='/edg-intro.mp4';
const LOOP='/edg-logo-tremor-loop.mp4';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

function heroElements(page){
  const hero=page.getByRole('region',{name:'EDG Skateboards',exact:true});
  return {
    hero,
    video:hero.locator('#campaign-video'),
    play:hero.locator('.campaign-play'),
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

async function expectPlaying(video,source){
  await expect.poll(()=>video.evaluate((media,path)=>!media.paused&&media.currentTime>0&&new URL(media.currentSrc,location.href).pathname===path,source)).toBe(true);
}

async function expectLoopRepeats(video){
  let previous=await video.evaluate(media=>media.currentTime);
  await expect.poll(async()=>{
    const state=await video.evaluate(media=>({time:media.currentTime,paused:media.paused,error:media.error?.code}));
    const repeated=!state.paused&&!state.error&&state.time<previous-1;
    previous=state.time;return repeated;
  },{timeout:10000,intervals:[250]}).toBe(true);
}

async function expectNoPlaybackControls({hero,play}){
  await expect(play).toBeHidden();
  await expect(hero.locator('video[controls]')).toHaveCount(0);
}

async function expectStaticHero({video,poster,description,collection}){
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expect(poster).toBeVisible();
  await expect(poster).toHaveCSS('opacity','1');
  await expect.poll(()=>poster.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(video).toHaveJSProperty('paused',true);
  await expect(video).toHaveCSS('opacity','0');
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
    const elements=heroElements(page),{hero,video,description,collection}=elements;
    await expect(hero).toBeVisible();
    await expectNoPlaybackControls(elements);
    await expect.poll(()=>requests.includes(INTRO)).toBe(true);
    await expect(description).toBeHidden();
    await expect(collection).toHaveCount(1);
    await expect(collection).toBeHidden();
    expect(requests).not.toContain(LOOP);

    releaseIntro();
    await expectPlaying(video,INTRO);
    await expect(description).toBeHidden();
    await expect(collection).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>window.heroMediaEvents.some(event=>event.type==='ended'&&event.source==='/edg-intro.mp4'&&event.trusted)),{timeout:10000}).toBe(true);
    await expect(description).toBeVisible();
    await expect(collection).toBeVisible();
    await expect(hero.getByText('ORIGINAL . BARCELONA',{exact:true})).toBeVisible();
    await expect(hero.getByText('EDG / Skateboards',{exact:true})).toHaveCount(0);
    await expectPlaying(video,LOOP);
    await expect(video).toHaveJSProperty('loop',true);
    await expectLoopRepeats(video);

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
    await expectNoPlaybackControls(elements);
    await expectPlaying(video,LOOP);
    expect(requests.filter(path=>path===INTRO)).toHaveLength(introRequestCount);
    expect(await page.evaluate(()=>window.heroMediaEvents.filter(event=>event.type==='playing'&&event.source==='/edg-intro.mp4').length)).toBe(introPlayCount);
    expect(errors).toEqual([]);
  }finally{
    releaseIntro();
  }
});

test('movimiento reducido no descarga MP4 hasta activar las animaciones expresamente',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests=mediaRequests(page);
  await page.goto('/');
  const elements=heroElements(page),{video,play}=elements;
  await expectStaticHero(elements);
  await expect(play).toHaveText(/Activar animaciones/);
  await expect(play).toBeVisible();
  expect(requests).toEqual([]);
  await expect(page.locator('.deck-carousel-track')).toHaveCSS('animation-name','none');

  await play.tap();
  await expectPlaying(video,INTRO);
  await expectNoPlaybackControls(elements);
  await expect(page.locator('.deck-carousel-track')).toHaveCSS('animation-name','deck-scroll');
  await expect.poll(()=>video.getAttribute('src'),{timeout:10000}).toBe(LOOP);
  await expectPlaying(video,LOOP);
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});

test('una intro no encontrada mantiene la colección accesible y reproduce el loop',async({page})=>{
  await page.route(`**${INTRO}`,route=>route.fulfill({status:404,contentType:'text/plain',body:'Intro not found'}));
  await page.goto('/');
  const elements=heroElements(page),{video,description,collection}=elements;
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expectPlaying(video,LOOP);
  await expectNoPlaybackControls(elements);
  await collection.click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true})).toBeInViewport();
});

test('un toque recupera el autoplay bloqueado y conserva el permiso al cambiar al segundo vídeo',async({page})=>{
  await page.addInitScript(()=>{
    const nativePlay=HTMLMediaElement.prototype.play,unlocked=new WeakSet();
    let withinGesture=false;
    window.autoplayRejections=0;
    document.addEventListener('click',event=>{
      if(!event.isTrusted)return;
      withinGesture=true;setTimeout(()=>withinGesture=false,0);
    },true);
    HTMLMediaElement.prototype.play=function(){
      if(withinGesture)unlocked.add(this);
      if(!unlocked.has(this)){
        window.autoplayRejections++;
        return Promise.reject(new DOMException('A gesture is required for this media element','NotAllowedError'));
      }
      return nativePlay.call(this);
    };
  });
  await observeMediaEvents(page);
  await page.goto('/');
  const elements=heroElements(page),{video,play}=elements;
  await expect.poll(()=>page.evaluate(()=>window.autoplayRejections)).toBeGreaterThan(0);
  await expectStaticHero(elements);
  await expect(play).toBeVisible();
  await expect(play).toHaveText(/Reproducir vídeo/);
  const rejections=await page.evaluate(()=>window.autoplayRejections);

  await play.tap();
  await expectPlaying(video,INTRO);
  await expectNoPlaybackControls(elements);
  await expect.poll(()=>video.getAttribute('src'),{timeout:10000}).toBe(LOOP);
  await expectPlaying(video,LOOP);
  await expectNoPlaybackControls(elements);
  expect(await page.evaluate(()=>window.autoplayRejections)).toBe(rejections);
  expect(await page.evaluate(()=>window.heroMediaEvents.some(event=>event.type==='ended'&&event.source==='/edg-intro.mp4'&&event.trusted))).toBe(true);
});
