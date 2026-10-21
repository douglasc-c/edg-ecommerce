import {test,expect} from '@playwright/test';

const INTRO='/edg-intro.mp4';
const LOOP='/edg-logo-tremor-loop.mp4';

function heroElements(page){
  const hero=page.getByRole('region',{name:'EDG Skateboards',exact:true});
  return {
    hero,
    intro:hero.locator('#campaign-intro'),
    loop:hero.locator('#campaign-video'),
    description:hero.getByText('Skateboarding y cultura urbana.',{exact:true}),
    collection:hero.getByRole('link',{name:/Explorar la colección/,includeHidden:true}),
    play:hero.getByRole('button',{name:'Reproducir animación',exact:true}),
    pause:hero.getByRole('button',{name:'Pausar animación',exact:true}),
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

test('la intro termina antes de mostrar la colección y activar el loop; la pausa persiste al volver',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const requests=mediaRequests(page);
  await observeMediaEvents(page);
  let releaseIntro;
  const introGate=new Promise(resolve=>releaseIntro=resolve);
  await page.route(`**${INTRO}`,async route=>{await introGate;await route.continue();});
  try{
    await page.goto('/',{waitUntil:'domcontentloaded'});
    const {hero,intro,loop,description,collection,play,pause}=heroElements(page);
    await expect(hero).toBeVisible();
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
    await expectPlaying(loop);

    const events=await page.evaluate(()=>window.heroMediaEvents);
    const introPlaying=events.findIndex(event=>event.type==='playing'&&event.source===INTRO);
    const introEnded=events.findIndex(event=>event.type==='ended'&&event.source===INTRO&&event.trusted);
    const loopPlaying=events.findIndex(event=>event.type==='playing'&&event.source===LOOP);
    expect(introPlaying).toBeGreaterThanOrEqual(0);
    expect(introEnded).toBeGreaterThan(introPlaying);
    expect(loopPlaying).toBeGreaterThan(introEnded);

    await pause.click();
    await expect(loop).toHaveJSProperty('paused',true);
    await expect(play).toBeVisible();
    const introRequestCount=requests.filter(path=>path===INTRO).length;
    const introPlayCount=events.filter(event=>event.type==='playing'&&event.source===INTRO).length;
    await page.getByRole('banner').getByRole('link',{name:/Carrito/}).click();
    await expect(hero).toHaveCount(0);
    await page.getByRole('link',{name:'Inicio',exact:true}).click();
    await expect(collection).toBeVisible();
    await expect(description).toBeVisible();
    await expect(loop).toHaveJSProperty('paused',true);
    await expect(play).toBeVisible();
    await play.click();
    await expectPlaying(loop);
    expect(requests.filter(path=>path===INTRO)).toHaveLength(introRequestCount);
    expect(await page.evaluate(()=>window.heroMediaEvents.filter(event=>event.type==='playing'&&event.source==='/edg-intro.mp4').length)).toBe(introPlayCount);
    expect(errors).toEqual([]);
  }finally{
    releaseIntro();
  }
});

test('movimiento reducido muestra el contenido sin descargar MP4 y solo reproduce el loop por petición',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const requests=mediaRequests(page);
  await page.goto('/');
  const {intro,loop,description,collection,play,pause}=heroElements(page);
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expect(play).toBeVisible();
  await expect(intro).toHaveJSProperty('paused',true);
  await expect(loop).toHaveJSProperty('paused',true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(requests).toEqual([]);

  await play.click();
  await expectPlaying(loop);
  await expect(pause).toBeVisible();
  await expect(intro).toHaveJSProperty('paused',true);
  expect(requests).toContain(LOOP);
  expect(requests).not.toContain(INTRO);
});

test('una intro no encontrada mantiene la colección accesible y reproduce el loop',async({page})=>{
  await page.route(`**${INTRO}`,route=>route.fulfill({status:404,contentType:'text/plain',body:'Intro not found'}));
  await page.goto('/');
  const {loop,description,collection,pause}=heroElements(page);
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expectPlaying(loop);
  await expect(pause).toBeVisible();
  await collection.click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true})).toBeInViewport();
});

test('el bloqueo del autoplay revela el contenido y permite iniciar el loop manualmente',async({page})=>{
  await page.addInitScript(()=>{
    const nativePlay=HTMLMediaElement.prototype.play;
    let manualPlaybackAllowed=false;
    document.addEventListener('click',event=>{if(event.isTrusted)manualPlaybackAllowed=true;},true);
    window.autoplayRejections=0;
    HTMLMediaElement.prototype.play=function(){
      if(!manualPlaybackAllowed){
        window.autoplayRejections++;
        return Promise.reject(new DOMException('Autoplay blocked for this test','NotAllowedError'));
      }
      return nativePlay.call(this);
    };
  });
  await observeMediaEvents(page);
  await page.goto('/');
  const {intro,loop,description,collection,play,pause}=heroElements(page);
  await expect.poll(()=>page.evaluate(()=>window.autoplayRejections)).toBeGreaterThan(0);
  await expect(description).toBeVisible();
  await expect(collection).toBeVisible();
  await expect(play).toBeVisible();
  await expect(intro).toHaveJSProperty('paused',true);
  await expect(loop).toHaveJSProperty('paused',true);
  await play.click();
  await expectPlaying(loop);
  await expect(pause).toBeVisible();
  const playing=await page.evaluate(()=>window.heroMediaEvents.filter(event=>event.type==='playing'));
  expect(playing.some(event=>event.source===LOOP)).toBe(true);
  expect(playing.some(event=>event.source===INTRO)).toBe(false);
});
