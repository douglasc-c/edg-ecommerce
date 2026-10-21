import {test,expect} from '@playwright/test';

const INTRO='/edg-intro.mp4';
const LOOP='/edg-logo-tremor-loop.mp4';
const INTRO_IMAGE='/edg-intro-animated.webp';
const LOOP_IMAGE='/edg-logo-tremor-animated.webp';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

function heroElements(page){
  const hero=page.getByRole('region',{name:'EDG Skateboards',exact:true});
  return {
    hero,
    video:hero.locator('#campaign-video'),
    animation:hero.locator('.campaign-animation'),
    poster:hero.locator('img[src="/edg-logo-tremor-poster.png"]'),
    description:hero.getByText('Skateboarding y cultura urbana.',{exact:true}),
    collection:hero.getByRole('link',{name:/Explorar la colección/,includeHidden:true}),
  };
}

function mediaRequests(page){
  const requests=[];
  page.on('request',request=>{
    const pathname=new URL(request.url()).pathname;
    if(pathname.endsWith('.mp4')||pathname.endsWith('-animated.webp'))requests.push(pathname);
  });
  return requests;
}

async function expectPlaying(video,source){
  await expect.poll(()=>video.evaluate((media,path)=>!media.paused&&media.currentTime>0&&new URL(media.currentSrc,location.href).pathname===path,source)).toBe(true);
}

async function expectLoopRepeats(video){
  let previous=await video.evaluate(media=>media.currentTime);
  let awaitingProgress=false,completed=0;
  await expect.poll(async()=>{
    const state=await video.evaluate(media=>({time:media.currentTime,duration:media.duration,paused:media.paused,seeking:media.seeking,error:media.error?.code}));
    if(state.time<previous-1&&previous>=state.duration-1)awaitingProgress=true;
    // Reaching zero alone can hide a stalled seek. Require playback to advance
    // after each of two natural wraps before accepting continuous playback.
    if(awaitingProgress&&!state.paused&&!state.seeking&&!state.error&&state.time>1){
      completed++;awaitingProgress=false;
    }
    previous=state.time;return completed;
  },{timeout:20000,intervals:[250]}).toBeGreaterThanOrEqual(2);
}

async function expectNoPlaybackControls({hero}){
  await expect(hero.locator('.campaign-play')).toHaveCount(0);
  await expect(hero.getByRole('button')).toHaveCount(0);
  await expect(hero.locator('video[controls]')).toHaveCount(0);
}

async function expectImageMoving(hero){
  const media=hero.locator('.campaign-media');
  const first=await media.screenshot();
  await expect.poll(async()=>!(await media.screenshot()).equals(first),{timeout:4500,intervals:[150]}).toBe(true);
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
    await expect(video).toHaveJSProperty('loop',false);
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
    expect(requests).not.toContain(INTRO_IMAGE);
    expect(requests).not.toContain(LOOP_IMAGE);
    expect(errors).toEqual([]);
  }finally{
    releaseIntro();
  }
});

test('la campaña y el carrusel arrancan automáticamente sin un control de activación',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests=mediaRequests(page);
  await page.goto('/');
  const elements=heroElements(page),{video}=elements;
  await expectPlaying(video,INTRO);
  await expectNoPlaybackControls(elements);
  await expect(page.locator('.deck-carousel-track')).toHaveCSS('animation-name','deck-scroll');
  await expect.poll(()=>video.getAttribute('src'),{timeout:10000}).toBe(LOOP);
  await expectPlaying(video,LOOP);
  expect(requests).not.toContain(INTRO_IMAGE);
  expect(requests).not.toContain(LOOP_IMAGE);
});

test('una intro no encontrada mantiene la colección accesible y reproduce el loop',async({page})=>{
  await page.addInitScript(()=>{
    // Force WebKit's possible ordering: the real failed play() rejects before
    // the application receives the media error notification for that source.
    document.addEventListener('error',event=>{
      const media=event.target;
      if(!event.isTrusted||!(media instanceof HTMLVideoElement)||!media.currentSrc.endsWith('/edg-intro.mp4'))return;
      event.stopImmediatePropagation();
      setTimeout(()=>media.dispatchEvent(new Event('error')),100);
    },true);
  });
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

test('autoplay bloqueado conserva la apertura y el logo animados sin botones ni gestos',async({page})=>{
  await page.addInitScript(()=>{
    window.autoplayRejections=0;window.heroGestures=0;
    for(const type of ['click','touchend','keydown'])document.addEventListener(type,()=>window.heroGestures++,true);
    HTMLMediaElement.prototype.play=function(){
      window.autoplayRejections++;
      return Promise.reject(new DOMException('Autoplay is disabled','NotAllowedError'));
    };
  });
  const requests=mediaRequests(page),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const elements=heroElements(page),{hero,video,animation,description,collection}=elements;
  await expect.poll(()=>page.evaluate(()=>window.autoplayRejections)).toBeGreaterThan(0);
  await expect(animation).toHaveAttribute('src',INTRO_IMAGE);
  await expect(animation).toBeVisible();
  await expect(description).toBeHidden();
  await expect(collection).toBeHidden();
  await expectNoPlaybackControls(elements);
  await expectImageMoving(hero);

  await expect(animation).toHaveAttribute('src',LOOP_IMAGE,{timeout:10000});
  await expect(animation).toBeVisible();
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expectImageMoving(hero);
  await expect(video).toHaveJSProperty('paused',true);
  await expect(video).not.toHaveAttribute('src',/.+/);
  await expectNoPlaybackControls(elements);
  expect(requests).toContain(INTRO_IMAGE);
  expect(requests).toContain(LOOP_IMAGE);
  expect(await page.evaluate(()=>window.heroGestures)).toBe(0);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test('si también falla la imagen animada, el poster y la colección siguen accesibles sin controles',async({page})=>{
  await page.addInitScript(()=>{
    HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Autoplay is disabled','NotAllowedError'));};
  });
  await page.route('**/*-animated.webp',route=>route.fulfill({status:404,contentType:'text/plain',body:'Animation not found'}));
  await page.goto('/');
  const elements=heroElements(page);
  await expectStaticHero(elements);
  await expectNoPlaybackControls(elements);
  await expect(elements.animation).toBeHidden();
});
