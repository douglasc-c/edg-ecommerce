import {test,expect} from '@playwright/test';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

async function holdLoadingScreen(page,check){
  let release;
  const released=new Promise(resolve=>{release=resolve;});
  // Keep the parser open after the actual SVG and its async script. Deferred
  // storefront scripts and DOMContentLoaded must not be needed to animate it.
  await page.route('**/loading-parser-block.js',async route=>{
    await released;
    await route.fulfill({contentType:'application/javascript',body:''});
  });
  await page.route('**/',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace('</body>','<script src="/loading-parser-block.js"></script></body>');
    await route.fulfill({response,body});
  });
  try{
    await page.goto('/',{waitUntil:'commit'});
    const loader=page.locator('#edg-loader');
    await expect(loader).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>!!window.edgGlobe)).toBe(true);
    expect(await page.evaluate(()=>document.readyState)).toBe('loading');
    await check(loader);
  }finally{
    release();
  }
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.store-loading')).toHaveCount(0);
}

async function expectMoving(loader){
  for(const id of ['globe-grid','globe-continents']){
    const path=loader.locator('#'+id);
    const initial=await path.getAttribute('d');
    await expect.poll(()=>path.getAttribute('d')).not.toBe(initial);
  }
}

async function expectStill(loader){
  const changes=await loader.evaluate(async svg=>{
    // Give the media-query change event time to stop the next animation frame.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    let changes=0;
    const observer=new MutationObserver(records=>{changes+=records.length;});
    observer.observe(svg,{attributes:true,attributeFilter:['d'],subtree:true});
    await new Promise(resolve=>setTimeout(resolve,350));
    observer.disconnect();
    return changes;
  });
  expect(changes).toBe(0);
}

for(const legacy of [false,true]){
  test(legacy?'el loading anima con la API antigua de Safari':'el loading anima antes de terminar el HTML y cargar la tienda',async({page})=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.text().startsWith('EDG loading animation could not start.'))errors.push(message.text());});
    if(legacy){
      await page.addInitScript(()=>{
        Object.defineProperties(MediaQueryList.prototype,{
          addEventListener:{configurable:true,value:undefined},
          removeEventListener:{configurable:true,value:undefined},
        });
      });
    }
    await page.emulateMedia({reducedMotion:'no-preference'});
    await holdLoadingScreen(page,async loader=>{
      await expectMoving(loader);
      await page.emulateMedia({reducedMotion:'reduce'});
      await expectStill(loader);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await expectMoving(loader);
      // Retain the detached nodes to check that rendering the store also stops
      // the old animation instead of updating an invisible SVG indefinitely.
      await loader.evaluate(svg=>{
        window.retiredLoader=svg;
      });
    });
    const changes=await page.evaluate(async()=>{
      let changes=0;
      const observer=new MutationObserver(records=>{changes+=records.length;});
      observer.observe(window.retiredLoader,{attributes:true,attributeFilter:['d'],subtree:true});
      await new Promise(resolve=>setTimeout(resolve,350));
      observer.disconnect();
      return changes;
    });
    expect(changes).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('el loading respeta movimiento reducido desde el inicio y puede reanudarse',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await holdLoadingScreen(page,async loader=>{
    await expectStill(loader);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await expectMoving(loader);
  });
});
