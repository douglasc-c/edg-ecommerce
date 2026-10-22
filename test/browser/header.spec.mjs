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

async function headerGeometry(header){
  return header.evaluate(element=>{
    const box=element.getBoundingClientRect();
    return {top:box.top,bottom:box.bottom,height:box.height,mainTop:element.nextElementSibling.getBoundingClientRect().top+scrollY,scroll:scrollY};
  });
}

async function scrollHeader(page,target,hidden,baseline,{inspectMotion=false}={}){
  // Observe actual rendered positions. Waiting for scroll alone can finish
  // while the header's transform is still transitioning.
  const motion=await page.evaluate(({target,hidden,inspectMotion})=>new Promise(resolve=>{
    const header=document.querySelector('.store-header'),samples=[];
    const read=()=>{
      const box=header.getBoundingClientRect();
      return {at:performance.now(),top:box.top,bottom:box.bottom,height:box.height,mainTop:header.nextElementSibling.getBoundingClientRect().top+scrollY,scroll:scrollY,hidden:header.classList.contains('is-scroll-hidden')};
    };
    const started=performance.now();let settled=0,inspection=null;
    // Capture the actual CSS transition in the class-change microtask. A busy
    // runner can miss its entire 280 ms lifetime between two rAF callbacks.
    // Seeking this existing animation proves interpolation independently of
    // that scheduling gap, without changing product styles or their duration.
    const observer=inspectMotion?new MutationObserver(()=>{
      if(inspection||header.classList.contains('is-scroll-hidden')!==hidden)return;
      const animation=header.getAnimations().find(item=>item instanceof CSSTransition&&item.transitionProperty==='transform');
      inspection={found:!!animation,points:[]};
      observer.disconnect();
      if(!animation){inspection.instant=read();return;}
      const originalTime=animation.currentTime;
      try{
        const timing=animation.effect.getTiming();
        inspection.duration=timing.duration;inspection.property=animation.transitionProperty;
        inspection.cssTransition=animation instanceof CSSTransition;
        if(!Number.isFinite(timing.duration)||timing.duration<=0)throw new Error('CSS transform transition has no positive duration');
        animation.pause();
        for(const progress of [0,.25,.5,.75,1]){
          animation.currentTime=timing.delay+timing.duration*progress;
          inspection.points.push({progress,...read()});
        }
      }catch(error){inspection.error=error.message;}
      finally{animation.currentTime=originalTime??0;animation.play();}
    }):null;
    read(); // Establish the before-change style before asking for the scroll.
    observer?.observe(header,{attributes:true,attributeFilter:['class']});
    window.scrollTo({top:target,behavior:'instant'});
    const sample=()=>{
      const state=read();
      samples.push(state);
      const shown=target>=state.mainTop?Math.abs(state.top)<=1:state.top>=-1;
      const complete=state.hidden===hidden&&(hidden?state.bottom<=1:shown)&&Math.abs(state.scroll-target)<=1;
      settled=complete?settled+1:0;
      if(settled>=3||performance.now()-started>2000){observer?.disconnect();resolve({complete:settled>=3,samples,inspection});}
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }),{target,hidden,inspectMotion});
  expect(motion.complete,`Header must ${hidden?'hide':'show'} at scroll ${target}; final state: ${JSON.stringify(motion.samples.at(-1))}`).toBe(true);
  const positions=[...motion.samples,...(motion.inspection?.points||[])];
  expect(Math.max(...positions.map(state=>Math.abs(state.scroll-target))),'The header must not change the requested scroll position').toBeLessThanOrEqual(1);
  expect(Math.max(...positions.map(state=>Math.abs(state.height-baseline.height))),'Sliding must preserve the header height').toBeLessThanOrEqual(1);
  expect(Math.max(...positions.map(state=>Math.abs(state.mainTop-baseline.mainTop))),'Sliding must preserve the main content position in the document').toBeLessThanOrEqual(1);
  return motion;
}

function expectHeaderMotion({samples,inspection},{reducedMotion,mobile},hidden){
  if(!mobile)return;
  expect(inspection,'The class change must be observed before its transition can finish').not.toBeNull();
  expect(inspection.error).toBeUndefined();
  if(reducedMotion==='reduce'){
    expect(inspection.found,'Reduced motion must not create a transform transition').toBe(false);
    expect(hidden?inspection.instant.bottom<=1:Math.abs(inspection.instant.top)<=1).toBe(true);
    const intermediate=samples.filter(state=>state.hidden===hidden&&state.top<-1&&state.bottom>1);
    expect(intermediate,'Reduced motion must switch the header without interpolated positions').toHaveLength(0);
  }else{
    expect(inspection.found,'The mobile header must create a real CSS transform transition').toBe(true);
    expect(inspection.cssTransition).toBe(true);
    expect(inspection.property).toBe('transform');
    expect(inspection.duration).toBeGreaterThan(0);
    const points=inspection.points,start=points[0],end=points.at(-1),middle=points.find(point=>point.progress===.5);
    expect(Math.abs(end.top-start.top),'The transition must cover the full header height').toBeGreaterThanOrEqual(start.height-1);
    expect(middle.top,'Halfway through the real CSS transition must be an intermediate position').toBeGreaterThan(Math.min(start.top,end.top)+.5);
    expect(middle.top).toBeLessThan(Math.max(start.top,end.top)-.5);
    for(let index=1;index<points.length;index++){
      const delta=points[index].top-points[index-1].top;
      expect(hidden?delta:-delta,'The slide must not reverse direction mid-transition').toBeLessThanOrEqual(1);
    }
  }
}

async function expectReadableHeaderControls(header){
  const login=header.getByRole('button',{name:'Iniciar sesión',exact:true});
  const loginWidth=await login.evaluate(button=>({client:button.clientWidth,scroll:button.scrollWidth}));
  expect(loginWidth.scroll,'The login label must remain readable').toBeLessThanOrEqual(loginWidth.client+1);
  const actions=await Promise.all([login.boundingBox(),header.getByRole('link',{name:/^Carrito/}).boundingBox()]);
  for(const link of await header.getByRole('navigation').getByRole('link').all()){
    const nav=await link.boundingBox();
    for(const action of actions){
      const width=Math.max(0,Math.min(nav.x+nav.width,action.x+action.width)-Math.max(nav.x,action.x));
      const height=Math.max(0,Math.min(nav.y+nav.height,action.y+action.height)-Math.max(nav.y,action.y));
      expect(width*height,'Navigation and account/cart controls must not overlap').toBeLessThanOrEqual(1);
    }
  }
}

for(const scenario of [
  {name:'escritorio',viewport:{width:1440,height:1000},mobile:false,reducedMotion:'no-preference'},
  {name:'móvil',viewport:{width:390,height:844},mobile:true,reducedMotion:'no-preference'},
  {name:'móvil con movimiento reducido',viewport:{width:390,height:844},mobile:true,reducedMotion:'reduce'},
])test.describe(scenario.name,()=>{
  test.use({viewport:scenario.viewport,isMobile:scenario.mobile,hasTouch:scenario.mobile,reducedMotion:scenario.reducedMotion});

  test('el header sigue la dirección sin temblar, conserva el foco y respeta la colección',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/');
    const header=page.getByRole('banner');
    const home=header.getByRole('link',{name:'Inicio',exact:true});
    const logo=header.getByRole('link',{name:'EDG',exact:true,includeHidden:true});
    const accessibleLogo=header.getByRole('link',{name:'EDG',exact:true});
    await expect(header).toHaveCSS('background-color','rgb(0, 0, 0)');
    const baseline=await headerGeometry(header);
    expect(baseline.scroll).toBe(0);
    await expectReadableHeaderControls(header);
    await expect(logo).toHaveCount(1);
    await expect(accessibleLogo).toHaveCount(0);
    if(scenario.mobile)expect(await page.evaluate(()=>matchMedia('(hover:none)').matches)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(header.getByRole('button',{name:'Abrir menú',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    await logo.evaluate(link=>link.focus());
    await expect(home).toBeFocused();
    // Direction must be tested without keyboard focus pinning the header open.
    await home.evaluate(link=>link.blur());

    await scrollHeader(page,Math.max(1,Math.floor(baseline.mainTop)-2),false,baseline);
    const hiding=await scrollHeader(page,600,true,baseline,{inspectMotion:scenario.mobile});
    expectHeaderMotion(hiding,scenario,true);
    await expect(header).toHaveCSS('background-color','rgb(255, 255, 255)');
    for(const position of [598,601,599,602])await scrollHeader(page,position,true,baseline);
    // Deliberate upward travel accumulates across small scroll events.
    for(const position of [599,596,593])await scrollHeader(page,position,true,baseline);
    const showing=await scrollHeader(page,590,false,baseline,{inspectMotion:scenario.mobile});
    expectHeaderMotion(showing,scenario,false);
    for(const position of [592,589,591,588])await scrollHeader(page,position,false,baseline);
    await scrollHeader(page,640,true,baseline);

    // A real keyboard action must reveal offscreen controls without scrolling
    // the document to them. Keyboard focus also keeps the header available.
    await page.keyboard.press('Tab');
    await expect.poll(()=>header.evaluate(element=>!!element.querySelector(':focus-visible'))).toBe(true);
    await expect.poll(async()=>Math.abs((await header.boundingBox()).y)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>scrollY)).toBe(640);
    await scrollHeader(page,800,false,baseline);
    await expect(accessibleLogo).toBeVisible();
    await expectReadableHeaderControls(header);
    await logo.focus();
    await expect(logo).toBeFocused();
    await scrollHeader(page,0,false,baseline);
    await expect(header).toHaveCSS('background-color','rgb(0, 0, 0)');
    await expect(accessibleLogo).toHaveCount(0);
    await expect(home).toBeFocused();
    await logo.evaluate(link=>link.focus());
    await expect(home).toBeFocused();

    if(scenario.reducedMotion==='reduce'){
      for(const element of [header,header.locator('.store-header-brand')]){
        const durations=await element.evaluate(node=>getComputedStyle(node).transitionDuration.split(',').map(value=>parseFloat(value)));
        expect(durations.every(duration=>duration===0)).toBe(true);
      }
    }

    // Prevent only this link's navigation so native pointer/touch focus can be
    // checked independently: unlike keyboard focus, it must not pin the header.
    await home.evaluate(link=>{link.blur();link.addEventListener('click',event=>event.preventDefault(),{once:true});});
    if(scenario.mobile)await home.tap();else await home.click();
    expect(await header.evaluate(element=>!!element.querySelector(':focus-visible'))).toBe(false);
    if(scenario.mobile)await expect(home).toHaveCSS('opacity','1');
    await scrollHeader(page,500,true,baseline);
    await scrollHeader(page,450,false,baseline);
    await expectReadableHeaderControls(header);

    const previousHeader=await header.elementHandle();
    await header.getByRole('link',{name:'Colección',exact:true}).click();
    await expect(page).toHaveURL(/#catalog$/);
    await expect.poll(()=>previousHeader.evaluate(node=>node.isConnected)).toBe(false);
    const collectionTitle=page.getByRole('heading',{name:'LA COLECCIÓN.',exact:true});
    await expect(collectionTitle).toBeInViewport({ratio:1});
    await waitForScrollToSettle(page);
    // A fragment jump may precede the replacement header's binder. Establish
    // a real downward movement before testing persistence of the hidden state.
    const collectionScroll=await page.evaluate(()=>scrollY);
    await scrollHeader(page,collectionScroll+24,true,baseline);
    await expect(header).toHaveCSS('background-color','rgb(255, 255, 255)');
    const beforeFilter=await headerGeometry(header);

    // Inspect the replacement before its first paint: its old hidden state and
    // white background must be preserved, with no flash or document movement.
    await header.evaluate(current=>{
      window.rebuiltHeaderState=null;
      const observer=new MutationObserver(()=>{
        if(current.isConnected)return;
        const replacement=document.querySelector('.store-header');
        if(!replacement)return;
        const box=replacement.getBoundingClientRect();
        window.rebuiltHeaderState={background:getComputedStyle(replacement).backgroundColor,hidden:replacement.classList.contains('is-scroll-hidden'),top:box.top,bottom:box.bottom,height:box.height,scroll:scrollY,mainTop:replacement.nextElementSibling.getBoundingClientRect().top+scrollY};
        observer.disconnect();
      });
      observer.observe(current.parentElement,{childList:true});
    });
    await page.locator('.filters').getByRole('button').nth(1).click();
    await expect.poll(()=>page.evaluate(()=>window.rebuiltHeaderState)).not.toBeNull();
    const rebuilt=await page.evaluate(()=>window.rebuiltHeaderState);
    expect(rebuilt.background).toBe('rgb(255, 255, 255)');
    expect(rebuilt.hidden).toBe(true);
    expect(rebuilt.bottom).toBeLessThanOrEqual(1);
    expect(Math.abs(rebuilt.height-baseline.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(rebuilt.mainTop-baseline.mainTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(rebuilt.scroll-beforeFilter.scroll)).toBeLessThanOrEqual(1);
    await waitForScrollToSettle(page);
    expect(Math.abs((await headerGeometry(header)).scroll-beforeFilter.scroll)).toBeLessThanOrEqual(1);

    await scrollHeader(page,beforeFilter.scroll-48,false,baseline);
    const titleBox=await collectionTitle.boundingBox(),headerBox=await header.boundingBox();
    expect(titleBox.y).toBeGreaterThanOrEqual(headerBox.y+headerBox.height-1);
    expect(titleBox.y+titleBox.height).toBeLessThanOrEqual(scenario.viewport.height);
    await expectReadableHeaderControls(header);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
