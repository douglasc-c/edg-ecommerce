import {test,expect} from '@playwright/test';

const INTRO='/edg-intro-mobile.mp4';
const LOOP='/edg-logo-tremor-loop.mp4';
const INTRO_IMAGE='/edg-intro-mobile-animated.webp';
const LOOP_IMAGE='/edg-logo-tremor-mobile-animated.webp';
const INTRO_DURATION=3.4;
const INTRO_LAST_FRAME=INTRO_DURATION-1/30;

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
  await expect.poll(()=>video.evaluate((media,path)=>!media.paused&&media.currentTime>0&&media.dataset.activeSrc===path,source)).toBe(true);
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

async function observeMediaEvents(page,{blockIntroEnded=false}={}){
  await page.addInitScript(({intro,blockIntroEnded})=>{
    window.heroMediaEvents=[];window.heroMediaFrames=[];window.heroReveals=[];
    const observed=new WeakSet(),revealed=new WeakSet();
    const observeFrames=media=>{
      if(observed.has(media)||typeof media.requestVideoFrameCallback!=='function')return;
      observed.add(media);
      const onFrame=(now,metadata)=>{
        if(!media.isConnected||media.dataset.activeSrc!==intro)return;
        window.heroMediaFrames.push({source:media.dataset.activeSrc,currentSrc:media.currentSrc,at:now,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames,expectedDisplayTime:metadata.expectedDisplayTime});
        media.requestVideoFrameCallback(onFrame);
      };
      media.requestVideoFrameCallback(onFrame);
    };
    for(const type of ['playing','ended','waiting'])document.addEventListener(type,event=>{
      const media=event.target;
      if(!(media instanceof HTMLVideoElement)||media.id!=='campaign-video')return;
      const blocked=blockIntroEnded&&type==='ended'&&media.dataset.activeSrc===intro;
      window.heroMediaEvents.push({type,source:media.dataset.activeSrc,currentSrc:media.currentSrc,currentTime:media.currentTime,at:performance.now(),trusted:event.isTrusted,blocked});
      if(type==='playing'&&media.dataset.activeSrc===intro)observeFrames(media);
      // Keep the real decoder and frames, but prevent the app from receiving
      // native intro completion. A backend that omits ended has the same state.
      if(blocked)event.stopImmediatePropagation();
    },true);
    new MutationObserver(()=>{
      const campaign=document.querySelector('.campaign.is-ready');
      if(!campaign||revealed.has(campaign))return;
      revealed.add(campaign);
      const collection=campaign.querySelector('.campaign-cta');
      window.heroReveals.push({at:performance.now(),collectionVisible:!!collection&&getComputedStyle(collection).visibility==='visible'});
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  },{intro:INTRO,blockIntroEnded});
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
    await expect.poll(()=>page.evaluate(({source,lastFrame,duration})=>
      window.heroMediaEvents.some(event=>event.type==='ended'&&event.source===source&&event.trusted&&event.currentTime>=duration-.001)
      ||window.heroMediaFrames.some(frame=>frame.source===source&&frame.mediaTime>=lastFrame-.001),
    {source:INTRO,lastFrame:INTRO_LAST_FRAME,duration:INTRO_DURATION}),{timeout:10000}).toBe(true);
    await expect(description).toBeVisible();
    await expect(collection).toBeVisible();
    await expect(hero.getByText('ORIGINAL . BARCELONA',{exact:true})).toBeVisible();
    await expect(hero.getByText('EDG / Skateboards',{exact:true})).toHaveCount(0);
    await expectPlaying(video,LOOP);
    await expect(video).toHaveJSProperty('loop',false);
    await expectLoopRepeats(video);

    const {events,frames,reveals}=await page.evaluate(()=>({events:window.heroMediaEvents,frames:window.heroMediaFrames,reveals:window.heroReveals}));
    const introPlaying=events.findIndex(event=>event.type==='playing'&&event.source===INTRO);
    const introEnded=events.find(event=>event.type==='ended'&&event.source===INTRO&&event.trusted&&event.currentTime>=INTRO_DURATION-.001);
    const finalFrame=frames.find(frame=>frame.source===INTRO&&frame.mediaTime>=INTRO_LAST_FRAME-.001);
    const loopPlaying=events.findIndex(event=>event.type==='playing'&&event.source===LOOP);
    expect(introPlaying).toBeGreaterThanOrEqual(0);
    expect(Boolean(introEnded||finalFrame),'The complete intro must end natively or present its actual final frame').toBe(true);
    const completedAt=introEnded?.at??finalFrame.expectedDisplayTime;
    expect(completedAt).toBeGreaterThan(events[introPlaying].at);
    expect(loopPlaying).toBeGreaterThan(introPlaying);
    expect(events[loopPlaying].at).toBeGreaterThanOrEqual(completedAt);
    expect(events[loopPlaying].at-completedAt,'The loop must not wait for the 8-second watchdog').toBeLessThan(1000);
    expect(reveals[0].at).toBeGreaterThanOrEqual(completedAt);
    expect(reveals[0].at-completedAt).toBeLessThan(1000);
    expect(reveals[0].collectionVisible).toBe(true);

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
    expect(await page.evaluate(source=>window.heroMediaEvents.filter(event=>event.type==='playing'&&event.source===source).length,INTRO)).toBe(introPlayCount);
    expect(requests).not.toContain(INTRO_IMAGE);
    expect(requests).not.toContain(LOOP_IMAGE);
    expect(errors).toEqual([]);
  }finally{
    releaseIntro();
  }
});

test('el último cuadro real completa la intro aunque ended no llegue al reproductor',async({page})=>{
  const requests=mediaRequests(page),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await observeMediaEvents(page,{blockIntroEnded:true});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const elements=heroElements(page),{video,description,collection}=elements;
  await expectPlaying(video,INTRO);
  await expect(description).toBeHidden();
  await expect(collection).toBeHidden();
  await expect.poll(()=>page.evaluate(({source,lastFrame})=>window.heroMediaFrames.some(frame=>frame.source===source&&frame.mediaTime>=lastFrame-.001),{source:INTRO,lastFrame:INTRO_LAST_FRAME}),{timeout:10000}).toBe(true);
  await expectPlaying(video,LOOP);
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expectNoPlaybackControls(elements);

  const {events,frames,reveals}=await page.evaluate(()=>({events:window.heroMediaEvents,frames:window.heroMediaFrames,reveals:window.heroReveals}));
  const finalFrame=frames.find(frame=>frame.source===INTRO&&frame.mediaTime>=INTRO_LAST_FRAME-.001);
  const loopPlaying=events.find(event=>event.type==='playing'&&event.source===LOOP);
  expect(finalFrame.currentSrc).toMatch(/^blob:/);
  expect(finalFrame.mediaTime).toBeCloseTo(INTRO_LAST_FRAME,3);
  expect(finalFrame.presentedFrames).toBeGreaterThan(1);
  expect(events.filter(event=>event.type==='ended'&&event.source===INTRO).every(event=>event.trusted&&event.blocked)).toBe(true);
  expect(loopPlaying.at).toBeGreaterThan(finalFrame.expectedDisplayTime);
  expect(loopPlaying.at-finalFrame.expectedDisplayTime,'The loop must start within 1 second of the decoded final frame').toBeLessThan(1000);
  expect(reveals[0].at).toBeGreaterThan(finalFrame.expectedDisplayTime);
  expect(reveals[0].at-finalFrame.expectedDisplayTime,'The CTA must appear within 1 second of the decoded final frame').toBeLessThan(1000);
  expect(reveals[0].collectionVisible).toBe(true);
  expect(requests.filter(path=>path.endsWith('-animated.webp'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('la campaña y el carrusel arrancan automáticamente sin un control de activación',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests=mediaRequests(page);
  await page.goto('/');
  const elements=heroElements(page),{video}=elements;
  await expectPlaying(video,INTRO);
  await expectNoPlaybackControls(elements);
  await expect(page.locator('.deck-carousel-track')).toHaveCSS('animation-name','deck-scroll');
  await expect(video).toHaveAttribute('data-active-src',LOOP,{timeout:10000});
  await expectPlaying(video,LOOP);
  expect(requests).not.toContain(INTRO_IMAGE);
  expect(requests).not.toContain(LOOP_IMAGE);
});

test('una intro no encontrada mantiene la colección accesible y reproduce el loop',async({page})=>{
  // Mobile fetches the complete clip before assigning a media source, so a 404
  // must advance to the loop without relying on an HTMLMediaElement error event.
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

test('en una conexión móvil lenta descarga la intro antes de reproducirla y prepara el loop sin cortes',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Network throttling uses Chromium CDP.');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await observeMediaEvents(page);
  const network=await page.context().newCDPSession(page);
  try{
    await network.send('Network.enable');
    await network.send('Network.setCacheDisabled',{cacheDisabled:true});
    await network.send('Network.emulateNetworkConditions',{
      offline:false,latency:150,downloadThroughput:750000/8,uploadThroughput:750000/8,connectionType:'cellular3g',
    });
    // Use the actual HTTP responses and native media decoder under throttling.
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const elements=heroElements(page),{video,description,collection}=elements;
    await expect.poll(()=>page.evaluate(source=>window.heroMediaEvents.some(event=>event.type==='ended'&&event.source===source&&event.trusted),INTRO),{timeout:30000,intervals:[150]}).toBe(true);
    await expect(video).toHaveAttribute('data-active-src',LOOP,{timeout:10000});
    await expectPlaying(video,LOOP);
    await expect(description).toBeVisible();
    await expect(collection).toBeVisible();
    await expectNoPlaybackControls(elements);
    await expect(video).toHaveJSProperty('loop',false);

    const events=await page.evaluate(()=>window.heroMediaEvents);
    const playingIndex=events.findIndex(event=>event.type==='playing'&&event.source===INTRO&&event.trusted);
    const endedIndex=events.findIndex(event=>event.type==='ended'&&event.source===INTRO&&event.trusted);
    expect(playingIndex).toBeGreaterThanOrEqual(0);
    expect(endedIndex).toBeGreaterThan(playingIndex);
    const introPlaying=events[playingIndex],introEnded=events[endedIndex];
    expect(introPlaying.currentSrc).toMatch(/^blob:/);
    expect(introEnded.currentSrc).toBe(introPlaying.currentSrc);
    expect(introEnded.currentTime).toBeCloseTo(3.4,2);
    expect(events.slice(playingIndex+1,endedIndex).filter(event=>event.type==='waiting'&&event.source===INTRO),'The complete intro must play without waiting for more data').toEqual([]);

    // Resource Timing shares performance.now()'s clock with the native events.
    // This proves actual prebuffering, rather than just checking a preload hint.
    const resources=await page.evaluate(paths=>Object.fromEntries(paths.map(path=>{
      const resource=performance.getEntriesByName(new URL(path,location.href).href,'resource').find(entry=>entry.initiatorType==='fetch');
      return [path,resource?{startTime:resource.startTime,responseEnd:resource.responseEnd,decodedBodySize:resource.decodedBodySize}:null];
    })),[INTRO,LOOP]);
    expect(resources[INTRO]).not.toBeNull();
    expect(resources[INTRO].decodedBodySize).toBeGreaterThan(0);
    expect(resources[INTRO].responseEnd).toBeGreaterThan(0);
    expect(resources[INTRO].responseEnd).toBeLessThanOrEqual(introPlaying.at);
    expect(resources[LOOP]).not.toBeNull();
    expect(resources[LOOP].startTime).toBeGreaterThanOrEqual(introPlaying.at);
    expect(resources[LOOP].startTime).toBeLessThan(introEnded.at);
    expect(errors).toEqual([]);
  }finally{
    await network.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await network.detach();
  }
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
