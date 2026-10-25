const state={config:null,user:null,csrf:null,products:[],storeCategories:[],categories:[],cart:{items:[],subtotal:0},category:'Todos',search:'',adminProducts:[],adminOrders:[],quote:null,checkoutKey:null};
const $=s=>document.querySelector(s);
const i18n=window.EDGI18n;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Product and customer content must remain exactly as entered.
const literal=v=>`<span translate="no">${escape(v)}</span>`;
const translatedCategories=new Set(['Gorra','Gorras','Camiseta','Camisetas','Sudadera','Sudaderas','Tabla','Tablas','Esenciales','Tecnología','Casa','Papelería']);
const categoryTranslation=name=>translatedCategories.has(name)?'':' translate="no"';
const currencyLabel=()=>state.config?.currency==='EUR'?'€':'R$';
const money=v=>i18n.money(v,state.config?.currency||'BRL');
const date=v=>i18n.date(v);
const roleNames={admin:'Administrador',customer:'Cliente',inventory:'Inventario',finance:'Finanzas',shipping:'Envíos',support:'Atención al cliente'};
const ledgerTypes={income:'Cobro',refund:'Reembolso',expense:'Gasto'};
const auditActions={'europe_shipping.quote':'Tarifa europea consultada','europe_shipping.create':'Envío europeo registrado','europe_shipping.sync':'Seguimiento europeo consultado','invoice.issue':'Emisión de NF-e','invoice.cancel_requested':'Cancelación de NF-e solicitada','media.upload':'Foto subida','user.create':'Usuario creado','user.access':'Permisos de usuario actualizados','coupon.save':'Cupón guardado','coupon.active':'Estado del cupón actualizado','payment.duplicate':'Pago duplicado detectado','order.cancel':'Pedido cancelado','category.rename':'Categoría renombrada','category.create':'Categoría creada','category.update':'Categoría actualizada','category.delete':'Categoría eliminada','product.delete':'Producto eliminado','product.save':'Producto guardado','stock.adjust':'Inventario ajustado','product.variants_create':'Variaciones creadas','product.variants_migrate':'Existencias distribuidas por variación','stock.variant_adjust':'Inventario de variación ajustado','stock.variants_allocate':'Existencias pendientes distribuidas','stock.retired_variant_return':'Devolución pendiente de distribuir','order.status':'Estado del pedido actualizado','payment.refund_requested':'Reembolso solicitado','shipping.label.create':'Etiqueta de envío creada','shipping.label.buy':'Envío comprado','shipping.label.print':'Etiqueta de envío generada','shipping.sync':'Seguimiento actualizado','finance.expense':'Gasto registrado'};
const statuses={awaiting_payment:'Pendiente de pago',paid:'Pagado',picking:'En preparación',ready:'Listo para enviar',shipped:'Enviado',delivered:'Entregado',expired:'Caducado',cancelled:'Cancelado',refunded:'Reembolsado',payment_review:'Pago en revisión',pending:'Pendiente',approved:'Aprobado'};
const badge=s=>`<span class="badge ${escape(s)}">${escape(statuses[s]||s)}</span>`;
const colors=['#f0f0f0','#e5e5e5','#fafafa','#d4d4d4','#eeeeee','#ffffff'];
const productVisual=p=>p.images?.length?`<img translate="no" class="product-photo" src="${escape(p.images[0])}" alt="${escape(p.name)}" loading="lazy">`:`<span class="product-symbol" aria-hidden="true">${escape(p.icon)}</span>`;
const colorClass=c=>`color-${Math.max(1,colors.indexOf(c)+1)}`;
const has=p=>state.user?.permissions.includes(p);
const field=(name,label,value='',type='text',extra='')=>`<label class="field">${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const empty=(title,description='')=>`<div class="empty"><strong>${escape(title)}</strong>${escape(description)}</div>`;
function toast(message,error=false){const t=$('#toast');t.textContent=message;t.className=`show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='',6000);}
async function api(path,options={}) {
  const response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers:{'Accept':'application/json','Content-Type':'application/json',...(state.csrf?{'X-CSRF-Token':state.csrf}:{}),...options.headers},...(options.body?{body:JSON.stringify(options.body)}:{})});
  const contentType=response.headers.get('content-type')||'';
  const unavailable=()=>{
    console.error('EDG API unavailable:',{path:path.split('?')[0],status:response.status,contentType});
    const error=new Error('La tienda no está disponible en este momento. Vuelve a intentarlo más tarde.');
    error.status=response.status;return error;
  };
  if(!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i.test(contentType))throw unavailable();
  let result;
  try{result=await response.json();}catch{throw unavailable();}
  if(!result||typeof result!=='object'||result.cloudflare_error)throw unavailable();
  if(!response.ok){
    if(response.status>=500&&typeof result.error!=='string')throw unavailable();
    const error=new Error(typeof result.error==='string'?result.error:'No se ha podido completar la operación.');
    error.status=response.status;throw error;
  }
  return result;
}
function dialog(title,content,literalTitle=false){const d=$('#dialog');d.classList.remove('product-editor-dialog','product-detail-dialog');d.innerHTML=`<div class="dialog-head"><h2 id="dialog-title"${literalTitle?' translate="no"':''}>${escape(title)}</h2><button class="icon-btn" data-action="close" aria-label="Cerrar">×</button></div><div class="dialog-body">${content}</div>`;if(!d.open)d.showModal();}
function closeDialog(){ $('#dialog').close(); }
const catalogMode=()=>state.config?.checkout_enabled===false||(state.config?.checkout_enabled===undefined&&state.config?.mode==='catalog');
const euroCheckout=()=>state.config?.currency==='EUR';
const paymentTest=()=>euroCheckout()&&state.config?.payment_environment==='test';
const demoBanner=()=>catalogMode()?'<div class="demo">TIENDA EN PREPARACIÓN · Descubre los productos. Próximamente podrás comprar.</div>':paymentTest()?'<div class="demo payment-test-banner">PRUEBAS DE COMPRA · Simulación: no realices una transferencia real. Usa tarjetas de prueba.</div>':state.config.mode==='demo'?'<div class="demo">ENTORNO DE DEMOSTRACIÓN · Pagos y envíos simulados, sin cargos reales.</div>':'';
const brand=()=>`<a class="brand" href="#store"><span class="brand-logo"><img src="/edg-logo.png" alt="EDG"></span></a>`;
let teardownStoreHeader=()=>{};
let teardownSkateNavigation=()=>{};
let storeHeaderHidden=false;
const isStoreHeaderScrolled=()=>window.scrollY>24;
function bindStoreHeader(){
  const header=$('.store-header');
  if(!header)return ()=>{};
  const logo=header.querySelector('.store-header-brand'),home=header.querySelector('.toplinks a[href="#store"]'),main=header.nextElementSibling;
  const controller=new AbortController(),options={signal:controller.signal};
  // Safari can report positions outside the document during elastic scrolling.
  const scrollPosition=()=>Math.max(0,Math.min(window.scrollY,Math.max(0,document.documentElement.scrollHeight-document.documentElement.clientHeight)));
  const hasKeyboardFocus=()=>!!header.querySelector(':focus-visible');
  let frame=0,scrolled,hidden=storeHeaderHidden,lastScroll=scrollPosition(),direction=0,travel=0,hideAfter=0;
  const setHidden=next=>{
    if(next===hidden)return;
    hidden=storeHeaderHidden=next;header.classList.toggle('is-scroll-hidden',next);
  };
  const resetDirection=()=>{lastScroll=scrollPosition();direction=travel=0;};
  const update=()=>{
    frame=0;
    const position=scrollPosition(),delta=position-lastScroll,next=position>24;
    lastScroll=position;
    if(next!==scrolled){
      scrolled=next;
      if(!scrolled&&logo.contains(document.activeElement))home.focus({preventScroll:true});
      header.classList.toggle('is-scrolled',scrolled);
      logo.inert=!scrolled;
      logo.setAttribute('aria-hidden',String(!scrolled));
    }
    // Keep the header in place until content can fill the space behind it.
    if(position<=hideAfter||hasKeyboardFocus()){setHidden(false);direction=travel=0;return;}
    if(!delta)return;
    const nextDirection=Math.sign(delta);
    if(nextDirection!==direction){direction=nextDirection;travel=0;}
    travel+=Math.abs(delta);
    // Ignore tiny reversals without delaying a deliberate change of direction.
    if(travel>=12){setHidden(direction>0);travel=0;}
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  const measure=()=>{
    main.style.setProperty('--store-header-height',`${header.getBoundingClientRect().height}px`);
    hideAfter=main.getBoundingClientRect().top+window.scrollY;
  };
  const resync=()=>{measure();resetDirection();schedule();};
  measure();update();
  const observer=new ResizeObserver(measure);
  observer.observe(header);
  window.addEventListener('scroll',schedule,{passive:true,signal:controller.signal});
  window.addEventListener('resize',resync,options);
  window.addEventListener('pageshow',resync,options);
  header.addEventListener('focusin',event=>{
    if(hasKeyboardFocus()){
      setHidden(false);resetDirection();
      // Reveal keyboard-focused links inside the narrow screen navigation row
      // without moving the page to the sticky header.
      const link=event.target.closest('.toplinks a');
      if(link){
        const nav=link.parentElement,box=link.getBoundingClientRect(),bounds=nav.getBoundingClientRect();
        if(box.left<bounds.left)nav.scrollLeft-=bounds.left-box.left;
        else if(box.right>bounds.right)nav.scrollLeft+=box.right-bounds.right;
      }
    }
  },options);
  return ()=>{controller.abort();observer.disconnect();cancelAnimationFrame(frame);};
}
let teardownCampaignMotion=()=>{};
let campaignIntroComplete=false;
function campaignHero(){
  return `<section class="campaign${campaignIntroComplete?' is-ready':''}" aria-labelledby="campaign-title">
    <span class="eyebrow campaign-reveal">ORIGINAL . BARCELONA</span><h1 id="campaign-title" class="sr-only">EDG Skateboards</h1>
    <div class="campaign-body"><div class="campaign-media">
      <img class="campaign-poster" src="/edg-logo-tremor-poster.png" width="848" height="480" alt="" fetchpriority="high" decoding="async">
      <img class="campaign-animation" width="848" height="480" alt="" decoding="async" data-intro-src="/edg-intro-animated.webp" data-loop-src="/edg-logo-tremor-animated.webp" data-mobile-intro-src="/edg-intro-mobile-animated.webp" data-mobile-loop-src="/edg-logo-tremor-mobile-animated.webp" hidden>
      <video id="campaign-video" class="campaign-video" width="848" height="480" data-intro-src="/edg-intro.mp4" data-mobile-intro-src="/edg-intro-mobile.mp4" data-loop-src="/edg-logo-tremor-loop.mp4" poster="/edg-intro-poster.jpg" muted playsinline preload="none" aria-hidden="true"></video>
    </div><p class="campaign-description campaign-reveal">Skateboarding y cultura urbana.</p><a class="btn campaign-cta campaign-reveal" href="#catalog">Explorar la colección <span aria-hidden="true">↗</span></a></div>
  </section>`;
}
function bindCampaignMotion(){
  const video=$('#campaign-video');
  if(!video)return ()=>{};
  const campaign=video.closest('.campaign'),animation=campaign.querySelector('.campaign-animation');
  const mobile=window.matchMedia('(max-width:760px), (pointer:coarse)').matches;
  const introSource=mobile?video.dataset.mobileIntroSrc:video.dataset.introSrc,loopSource=video.dataset.loopSrc;
  const introImageSource=mobile?animation.dataset.mobileIntroSrc:animation.dataset.introSrc;
  const loopImageSource=mobile?animation.dataset.mobileLoopSrc:animation.dataset.loopSrc;
  const controller=new AbortController(),options={signal:controller.signal};
  const bufferedVideos=new Map(),nextAnimation=new Image();nextAnimation.decoding='async';
  let visible=false,disposed=false,usingImages=false,imageFailed=false,introImageStarted=false;
  let introTimeout,introFrameCallback,introCompletionTimeout,imageLoadTimeout,imageGeneration=0,introFinished=campaignIntroComplete;
  video.muted=video.defaultMuted=true;video.playsInline=true;
  const shouldPlay=()=>!disposed&&visible&&!document.hidden;
  const clearIntroTimer=()=>{
    clearTimeout(introTimeout);introTimeout=undefined;
    clearTimeout(introCompletionTimeout);introCompletionTimeout=undefined;
    if(introFrameCallback!==undefined){video.cancelVideoFrameCallback(introFrameCallback);introFrameCallback=undefined;}
  };
  function watchIntroFrames(){
    if(!mobile||introFinished||usingImages||!video.requestVideoFrameCallback||introFrameCallback!==undefined||introCompletionTimeout!==undefined)return;
    const source=video.getAttribute('src');
    const onFrame=(now,frame)=>{
      introFrameCallback=undefined;
      if(!shouldPlay()||introFinished||usingImages||video.getAttribute('src')!==source)return;
      // The mobile asset is 3.4 s at 30 fps. Some WebKit backends present its
      // final frame but omit ended or report an incorrect element duration.
      // Only a presented final-frame PTS can arm this fallback, never a clock
      // started at play(). Allow its full display time and prefer native ended.
      if(frame.mediaTime>=3.4-1/30-0.001){
        const delay=Math.max(0,frame.expectedDisplayTime-now)+Math.max(0,3.4-frame.mediaTime)*1000+150;
        introCompletionTimeout=setTimeout(()=>{
          introCompletionTimeout=undefined;
          if(shouldPlay()&&!introFinished&&!usingImages&&video.getAttribute('src')===source)finishIntro();
        },delay);
      }else introFrameCallback=video.requestVideoFrameCallback(onFrame);
    };
    introFrameCallback=video.requestVideoFrameCallback(onFrame);
  }
  function prepareVideo(source){
    if(bufferedVideos.has(source))return bufferedVideos.get(source);
    const request=new AbortController(),entry={request,url:null,failed:false};
    bufferedVideos.set(source,entry);
    entry.timeout=setTimeout(()=>request.abort(),12000);
    // These short mobile clips must be completely downloaded before playback.
    // preload/canplaythrough are hints and can still allow mid-intro buffering.
    fetch(source,{signal:request.signal,priority:source===introSource?'high':'low'}).then(response=>{
      if(!response.ok)throw new Error('Campaign video unavailable');
      return response.blob();
    }).then(blob=>{
      if(disposed||usingImages)return;
      if(request.signal.aborted)throw new Error('Campaign download timed out');
      entry.url=URL.createObjectURL(blob);
    }).catch(()=>{entry.failed=true;}).finally(()=>{
      clearTimeout(entry.timeout);
      if(!disposed&&!usingImages)updatePlayback();
    });
    return entry;
  }
  function clearVideoBuffers(){
    for(const entry of bufferedVideos.values()){
      clearTimeout(entry.timeout);entry.request.abort();
      if(entry.url)URL.revokeObjectURL(entry.url);
    }
    bufferedVideos.clear();
  }
  function clearAnimation(){
    imageGeneration++;
    clearTimeout(imageLoadTimeout);imageLoadTimeout=undefined;
    animation.hidden=true;animation.removeAttribute('src');campaign.classList.remove('has-animation');
  }
  function showContent({still=false}={}){
    campaign.classList.add('is-ready');
    if(still)campaign.classList.remove('has-video');
  }
  function finishIntro(){
    if(disposed||introFinished)return;
    introFinished=campaignIntroComplete=true;clearIntroTimer();
    // The final-frame poster covers both video and animated-image source changes.
    showContent({still:true});updatePlayback();
  }
  function showStill(){
    imageFailed=true;introFinished=campaignIntroComplete=true;
    clearIntroTimer();clearAnimation();nextAnimation.removeAttribute('src');showContent({still:true});
  }
  function showAnimation(){
    if(imageFailed)return;
    const source=introFinished?loopImageSource:introImageSource;
    if(animation.getAttribute('src')===source)return;
    clearAnimation();
    // A failed or slow alternative must not indefinitely hide the collection.
    imageLoadTimeout=setTimeout(showStill,12000);
    animation.src=source;
  }
  function useAnimatedImages(){
    if(disposed||usingImages)return;
    usingImages=true;clearIntroTimer();video.pause();
    campaign.classList.remove('has-video');
    // Video autoplay can be refused by iOS. The same frames remain automatic
    // through animated images, without adding playback controls or needing a tap.
    video.removeAttribute('src');delete video.dataset.activeSrc;video.load();clearVideoBuffers();updatePlayback();
  }
  function updatePlayback(){
    if(!shouldPlay()){
      video.pause();clearIntroTimer();
      if(usingImages){
        if(!introFinished&&introImageStarted){introFinished=campaignIntroComplete=true;showContent({still:true});}
        clearAnimation();
      }
      return;
    }
    if(usingImages){showAnimation();return;}
    const source=introFinished?loopSource:introSource;
    let playbackURL=source;
    if(mobile){
      const prepared=prepareVideo(source);
      if(prepared.failed){if(introFinished)useAnimatedImages();else finishIntro();return;}
      if(!prepared.url)return;
      playbackURL=prepared.url;
    }
    if(video.getAttribute('src')!==playbackURL){
      campaign.classList.remove('has-video');
      video.loop=false;video.preload='auto';
      video.poster=introFinished?'/edg-logo-tremor-poster.png':'/edg-intro-poster.jpg';
      video.dataset.activeSrc=source;video.src=playbackURL;
    }
    if(!introFinished&&!introTimeout){
      introTimeout=setTimeout(()=>{introTimeout=undefined;if(shouldPlay()&&!introFinished)finishIntro();},8000);
    }
    if(video.paused)video.play().then(()=>{
      if(usingImages||!shouldPlay())video.pause();
    }).catch(error=>{
      if(disposed||usingImages||playbackURL!==video.getAttribute('src')||!shouldPlay()||error.name==='AbortError')return;
      if(error.name==='NotAllowedError'||introFinished)useAnimatedImages();
      else finishIntro();
    });
  }
  animation.addEventListener('load',async()=>{
    if(disposed||!usingImages||imageFailed||!animation.getAttribute('src')||!animation.complete||!animation.naturalWidth)return;
    if(!shouldPlay()){updatePlayback();return;}
    const generation=imageGeneration,source=animation.getAttribute('src');
    try{await animation.decode();}catch{
      if(!disposed&&usingImages&&generation===imageGeneration&&source===animation.getAttribute('src')&&shouldPlay())showStill();
      return;
    }
    if(disposed||imageFailed||generation!==imageGeneration||source!==animation.getAttribute('src'))return;
    if(!shouldPlay()){updatePlayback();return;}
    clearTimeout(imageLoadTimeout);imageLoadTimeout=undefined;
    animation.hidden=false;campaign.classList.add('has-animation');
    if(!introFinished){
      introImageStarted=true;clearIntroTimer();
      // Prepare the second image during the intro, before its first display.
      if(!nextAnimation.getAttribute('src'))nextAnimation.src=loopImageSource;
      // This asset contains the original 3.4-second intro and plays exactly once.
      introTimeout=setTimeout(finishIntro,3400);
    }
  },options);
  animation.addEventListener('error',()=>{if(usingImages&&!disposed&&animation.getAttribute('src'))showStill();},options);
  video.addEventListener('playing',()=>{
    if(!usingImages&&shouldPlay()){
      campaign.classList.add('has-video');
      if(mobile&&!introFinished){watchIntroFrames();prepareVideo(loopSource);}
    }
    else video.pause();
  },options);
  video.addEventListener('ended',()=>{
    if(usingImages||!video.ended)return;
    if(!introFinished)return finishIntro();
    // Explicit replay avoids the stalled native loop seek in WebKit backends.
    video.currentTime=0;updatePlayback();
  },options);
  video.addEventListener('error',()=>{
    if(disposed||usingImages||!video.error)return;
    if(!introFinished)finishIntro();
    else useAnimatedImages();
  },options);
  document.addEventListener('visibilitychange',updatePlayback,options);
  window.addEventListener('pageshow',updatePlayback,options);
  if(introFinished)showContent({still:true});
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;updatePlayback();});
  observer.observe(campaign);
  return ()=>{
    if(!introFinished&&(video.currentTime>0||introImageStarted))campaignIntroComplete=true;
    disposed=true;observer.disconnect();controller.abort();clearIntroTimer();clearAnimation();
    video.pause();if(video.getAttribute('src')){video.removeAttribute('src');video.load();}
    clearVideoBuffers();nextAnimation.removeAttribute('src');
  };
}
function legalLinks(newTab=false){
  const attributes=newTab?' target="_blank" rel="noopener noreferrer"':'';
  return [['privacidad','Política de privacidad'],['terminos','Términos de uso y compra'],['devoluciones','Política de devoluciones']].map(([path,label])=>`<a href="/${path}/"${attributes}>${label}</a>`).join('');
}
function legalFormNotice(){
  return `<aside class="form-legal"><p>EDG SKATEBOARDS S.L. trata tus datos para gestionar tu cuenta y tus pedidos (ejecución del contrato), cumplir obligaciones legales y proteger la tienda (interés legítimo). Sus proveedores de alojamiento, pago, envío y correo pueden tratar datos fuera del Espacio Económico Europeo. Consulta cómo ejercer tus derechos y la información completa en la política de privacidad.</p><nav aria-label="Información legal">${legalLinks(true)}</nav><p>Los enlaces legales se abren en otra pestaña.</p></aside>`;
}
function storeShell(content) {
  const count=state.cart.items.reduce((s,p)=>s+p.quantity,0);
  const scrolled=isStoreHeaderScrolled();
  return `${demoBanner()}<header class="topbar store-header${scrolled?' is-scrolled':''}${scrolled&&storeHeaderHidden?' is-scroll-hidden':''}"><div class="store-header-brand"${scrolled?'':' inert aria-hidden="true"'}>${brand()}</div><button type="button" class="store-menu-open" data-action="open-store-menu" aria-label="Abrir menú" aria-controls="store-menu" aria-expanded="false"><span aria-hidden="true">☰</span><span class="store-menu-open-label">Menú</span></button><nav class="toplinks"><a href="#store">Inicio</a><a href="#catalog">Colección</a><a href="#skate"${location.hash==='#skate'?' aria-current="page"':''}>Skate</a><a href="#musica"${location.hash==='#musica'?' aria-current="page"':''}>Música</a><a href="#orders">Mis pedidos</a>${has('dashboard')?'<a href="#admin">Gestión</a>':''}</nav><div class="topactions">${state.user?`<button class="btn small" data-action="account">${literal(state.user.name.split(' ')[0])} · <span>Mi cuenta</span></button>`:'<button class="btn small" data-action="login">Iniciar sesión</button>'}<a class="btn small" href="#cart">Carrito <span class="cart-count">${count}</span></a>${i18n.selector()}</div></header><main class="store-main">${skateStoreMenu()}${content}<footer class="footer"><span>© ${new Date().getFullYear()} EDG</span><nav aria-label="Enlaces del pie de página"><a href="#catalog">Colección</a><a href="#skate">Skate</a><a href="#musica">Música</a><a href="#orders">Mis pedidos</a><a href="#cart">Carrito</a></nav><nav class="footer-legal" aria-label="Información legal">${legalLinks()}</nav><a class="footer-brand" href="#store"><img class="sr-only" src="/edg-footer-logo.png" alt="EDG" width="1122" height="125" loading="lazy" decoding="async"></a></footer></main>`;
}
const activeVariants=p=>(p.variants||[]).filter(v=>v.active!==false&&v.active!==0);
const legacyNeedsAllocation=p=>!p.variants_enabled&&productSizeValues(p).length>1;
const variantDescription=p=>[p.selected_color,p.selected_size].filter(Boolean).join(' · ');
const colorSwatch=hex=>`<svg class="color-swatch" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="11" fill="${/^#[a-f0-9]{6}$/i.test(hex)?hex:'#111111'}" stroke="#b5b5b5"/></svg>`;
function productCards(){
  const items=state.products.filter(p=>(state.category==='Todos'||p.category===state.category)&&`${p.name} ${p.sku}`.toLowerCase().includes(state.search.toLowerCase()));
  return items.length?items.map(p=>{const variants=activeVariants(p),palette=[...new Map(variants.map(v=>[v.color_name,v.color_hex])).entries()],pending=legacyNeedsAllocation(p),available=p.variants_enabled?variants.some(v=>v.available>0):p.available>0,prices=variants.map(v=>v.price),price=prices.length?Math.min(...prices):p.price;return `<article class="product"><button class="product-visual ${colorClass(p.color)}" data-action="product" data-id="${p.id}" aria-label="Ver ${escape(p.name)}">${productVisual({...p,images:p.images?.length?p.images:variants.find(v=>v.images?.length)?.images||[]})}</button><div class="product-info"><span class="muted"${categoryTranslation(p.category)}>${escape(p.category)}</span><h3 translate="no">${escape(p.name)}</h3>${palette.length?`<div class="product-color-preview" aria-label="Colores disponibles">${palette.slice(0,6).map(([name,hex])=>`<span title="${escape(name)}">${colorSwatch(hex)}</span>`).join('')}${palette.length>6?`<small>+${palette.length-6}</small>`:''}</div>`:''}<div class="product-bottom"><span class="product-price">${prices.some(value=>value!==price)?'<small>Desde </small>':''}${money(price)}</span><button class="product-add" data-action="add" data-id="${p.id}" ${!available||pending||catalogMode()?'disabled':''} aria-label="Añadir ${escape(p.name)}">+</button></div></div></article>`;}).join(''):empty('No se han encontrado productos','Cambia la búsqueda o la categoría.');
}
function categoryCards(){
  return [...new Set(state.products.map(p=>p.category))].map((name,index)=>{
    const category=state.storeCategories.find(c=>c.name.toLowerCase()===name.toLowerCase());
    return `<button class="category-tile${category?.image?' has-image':''}" data-action="collection" data-category="${escape(name)}">${category?.image?`<img class="category-background" src="${escape(category.image)}" alt="" loading="lazy" decoding="async">`:''}<span class="eyebrow">EDG / 0${index+1}</span><strong${categoryTranslation(name)}>${escape(name)}</strong><span>Explorar la selección ↗</span></button>`;
  }).join('');
}
const deckDesigns=[['g61','Love my life'],['g99','Daniel Morán'],['63','EDG multicolor'],['121','Marcos Mama'],['197','Roger Silva'],['221','Natsuo Yashima'],['240','In Gaudí we trust'],['257','Barcelona'],['15','Daniel Mordzin'],['19','EDG Elite pixel'],['28','EDG pirámide'],['47','EDG tricolor'],['55','Mordzin Barcelona'],['92','Roger Silva lettering'],['101','EDG Elite surf']];
// Shuffle once per page load; both loop copies and later renders share this order.
const shuffledDeckDesigns=(()=>{
  const designs=[...deckDesigns];
  for(let i=designs.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [designs[i],designs[j]]=[designs[j],designs[i]];
  }
  return designs;
})();
function deckCarousel(){
  const group=duplicate=>`<div class="deck-carousel-group" ${duplicate?'aria-hidden="true"':''}>${shuffledDeckDesigns.map(([id,label])=>`<img src="/shape-${id}.webp" alt="${duplicate?'':escape(`Tabla EDG · ${label}`)}" width="1200" height="300" loading="lazy" decoding="async">`).join('')}</div>`;
  return `<section class="deck-carousel" aria-label="Diseños de tablas EDG"><div class="deck-carousel-window"><div class="deck-carousel-track">${group(false)}${group(true)}</div></div></section>`;
}
function storePage(){return storeShell(`${campaignHero()}${deckCarousel()}<section id="catalog" class="collection-section"><div class="section-head"><div><span class="eyebrow">Descubre / La selección EDG</span><h2>LA COLECCIÓN.</h2></div><span class="collection-count">${state.products.length} productos</span></div><div class="filters">${['Todos',...new Set(state.products.map(p=>p.category))].map(c=>`<button class="filter ${state.category===c?'active':''}" data-action="filter" data-category="${escape(c)}"${c==='Todos'?'':categoryTranslation(c)}>${escape(c)}</button>`).join('')}<label class="search"><span class="sr-only">Buscar productos</span><input id="product-search" placeholder="Buscar en la colección…" value="${escape(state.search)}"></label></div><div class="product-grid" id="product-grid">${productCards()}</div></section><section class="category-section"><div class="section-head"><h2>DESCUBRE MÁS.</h2><a href="#catalog">Ver todo ↗</a></div><div class="category-grid">${categoryCards()}</div></section><section class="brand-statement"><a class="btn" href="#catalog">Colección ↗</a></section>`);}
function cartPage(){if(catalogMode())return storeShell(empty('Próximamente podrás comprar','Estamos preparando la tienda. Descubre nuestro catálogo.')+'<a class="btn" href="#store">Ver productos</a>');return storeShell(`<div class="page-title"><div><span class="eyebrow">Tu selección</span><h1>Mi carrito</h1><p>Revisa tus productos y continúa con el envío.</p></div><a class="btn" href="#store">Seguir comprando</a></div>${!state.user?empty('Inicia sesión para acceder a tu carrito','Crea una cuenta o inicia sesión para empezar tu compra.')+ '<button class="btn primary" data-action="login">Acceder a mi cuenta</button>':!state.cart.items.length?empty('Tu carrito está vacío','Explora la tienda y añade tus productos favoritos.'):`<div class="cart-layout"><div class="panel">${state.cart.items.map(p=>`<div class="cart-row"><span class="cart-icon ${colorClass(p.color)}">${p.images?.length?`<img src="${escape(p.images[0])}" alt="" loading="lazy">`:escape(p.icon)}</span><div><h3 translate="no">${escape(p.name)}</h3>${variantDescription(p)?`<p class="cart-variant" translate="no">${escape(variantDescription(p))}</p>`:""}<p class="muted">${money(p.price)} por unidad</p><div class="quantity"><button data-action="quantity" data-id="${p.id}" data-variant-id="${escape(p.variant_id||'')}" data-delta="-1" aria-label="Reducir cantidad">−</button><span>${p.quantity}</span><button data-action="quantity" data-id="${p.id}" data-variant-id="${escape(p.variant_id||'')}" data-delta="1" aria-label="Aumentar cantidad">+</button><button data-action="remove" data-id="${p.id}" data-variant-id="${escape(p.variant_id||'')}" aria-label="Eliminar producto">×</button></div></div><strong class="price">${money(p.price*p.quantity)}</strong></div>`).join('')}</div><aside class="summary"><h2>Resumen de la compra</h2><div class="sum-row"><span>Productos</span><span>${money(state.cart.subtotal)}</span></div><div class="sum-row"><span>Envío</span><span>Calculado al finalizar la compra</span></div><div class="sum-row total"><span>Subtotal</span><span>${money(state.cart.subtotal)}</span></div><button class="btn primary" data-action="checkout">Continuar con el envío →</button><p class="form-help">Las existencias se reservarán al confirmar el pedido.</p></aside></div>`}`);}
function ordersPage(orders){return storeShell(`<div class="page-title"><div><span class="eyebrow">Todo bajo control</span><h1>Mis pedidos</h1><p>Consulta el pago, la preparación y la entrega.</p></div><a class="btn" href="#store">Ir a la tienda</a></div>${!state.user?empty('Inicia sesión para ver tus pedidos')+'<button class="btn primary" data-action="login">Iniciar sesión</button>':!orders.length?empty('Todavía no tienes pedidos','Tus próximas compras aparecerán aquí.'):`<div class="order-cards">${orders.map(o=>`<article class="order-card"><div class="order-meta"><h3>Pedido #${o.number}</h3><p>${date(o.created_at)} · ${o.items.reduce((s,p)=>s+p.quantity,0)} artículo(s)</p></div>${badge(o.status)}<strong>${orderMoney(o,o.total)}</strong><button class="btn small" data-action="order" data-id="${o.id}">Ver pedido ↗</button></article>`).join('')}</div>`}`);}
const europeCountryNames={ES:'España (Península y Baleares)',DE:'Alemania',IT:'Italia',PT:'Portugal'};
const europeShipmentStatuses={simulated:'Simulación local',submitting:'Creación en curso',unknown:'Pendiente de conciliación',label_created:'Etiqueta creada',in_transit:'En tránsito',out_for_delivery:'En reparto',ready_for_pickup:'Listo para recoger',delivered:'Entregado',exception:'Incidencia',cancelled:'Cancelado',rejected:'Solicitud rechazada'};
const europeUI={status:null,rows:[],draft:{},quote:null,revision:0,createKey:null,uncertain:false,pendingId:null};
const euroMoney=(value,currency='EUR')=>Number.isFinite(value)?i18n.money(value,currency):'Importe no disponible';
const europePending=()=>europeUI.uncertain||europeUI.rows.some(row=>row.id===europeUI.pendingId&&['unknown','submitting'].includes(row.status));
function europeSafeUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function europeDraft(form){return Object.fromEntries(new FormData(form));}
function europeQuotePayload(data){return{destination:Object.fromEntries(['name','company_name','address','house_number','address_2','postal_code','city','country_code','email','telephone','state_province_code'].map(key=>[key,data[key]||'']).filter(([key,value])=>value||!['company_name','address_2','state_province_code'].includes(key))),parcel:Object.fromEntries(['weight','width','height','length'].map(key=>[key,Number(data[key])]))};}
function europeInvalidateQuote(form){europeUI.draft=europeDraft(form);europeUI.revision++;europeUI.quote=null;europeUI.createKey=null;const results=$('#eu-quote-results');if(results)results.innerHTML='<p class="form-help" role="status">Destino o paquete actualizado. Consulta las tarifas de nuevo.</p>';}
function europeQuoteResults(){
  const quote=europeUI.quote;if(!quote)return'';
  if(!quote.options.length)return empty('No hay servicios disponibles','Revisa el destino, las medidas y los servicios habilitados en Sendcloud.');
  const test=quote.environment==='test';
  return `<div class="eu-quote-head"><h3>Servicios disponibles</h3><p class="muted">Tarifa válida hasta ${date(quote.expires_at)}. ${test?'La prueba solo se guarda en esta tienda.':'La contratación puede generar cargos en Sendcloud.'}</p></div>${quote.options.map((option,index)=>`<label class="shipping-choice eu-service"><input type="radio" name="eu_service_id" value="${escape(option.id)}" ${index===0?'checked':''}><span><strong translate="no">${escape(option.name)}</strong><small>${escape(option.carrier||'Transportista')}${Number.isFinite(option.days)?` · Plazo estimado: ${option.days} días laborables`:' · Plazo no facilitado'}</small></span><b>${euroMoney(option.price,option.currency||quote.currency)}</b></label>`).join('')}<div class="form-actions"><button class="btn primary" type="button" data-action="eu-create-review" ${europePending()?'disabled':''}>${test?'Simular envío':'Revisar contratación'}</button></div>`;
}
function europeHistory(rows){return rows.length?`<div class="eu-shipment-list">${rows.map(row=>{
  const tracking=europeSafeUrl(row.tracking_url),test=row.environment==='test',pending=['unknown','submitting'].includes(row.status);
  return `<article class="eu-shipment" data-shipment-id="${escape(row.id)}"><div class="eu-shipment-head"><div><strong translate="no">${escape(row.order_reference||row.reference||row.id)}</strong><p class="muted">${date(row.created_at)} · ${literal(row.destination?.city||'')} · <span>${escape(europeCountryNames[row.destination?.country_code]||row.destination?.country_code||'')}</span></p></div><span class="badge ${pending?'payment_review':row.status==='delivered'?'delivered':row.status==='rejected'?'cancelled':''}">${escape(europeShipmentStatuses[row.status]||row.status)}</span></div><p>${row.service?.name?literal(row.service.name):'<span>Servicio de envío</span>'} · ${euroMoney(row.price,row.currency)} · <strong>${test?'PRUEBA · sin envío real':'ENVÍO REAL'}</strong></p>${test?'<p class="form-help">Sin etiqueta real, sin franqueo y sin entrega al transportista.</p>':''}${row.tracking_code?`<p class="form-help">Seguimiento: ${escape(row.tracking_code)}</p>`:''}${row.last_error?`<p class="danger-note">${escape(row.last_error)}</p>`:''}<div class="eu-shipment-actions"><button class="btn small" data-action="eu-detail" data-id="${escape(row.id)}">Ver detalles</button><button class="btn small" data-action="eu-sync" data-id="${escape(row.id)}">${pending?'Consultar / conciliar':'Consultar estado'}</button>${!test&&!['unknown','submitting','cancelled','rejected'].includes(row.status)&&row.provider_shipment_id?`<a class="btn small" href="/api/admin/europe-shipping/shipments/${encodeURIComponent(row.id)}/label" target="_blank" rel="noopener noreferrer">Descargar etiqueta PDF ↗</a>`:''}${!test&&tracking?`<a class="btn small" href="${escape(tracking)}" target="_blank" rel="noopener noreferrer">Seguir envío ↗</a>`:''}</div></article>`;
}).join('')}</div>`:empty('Todavía no hay envíos europeos','Las simulaciones y los envíos contratados aparecerán aquí.');}
function europeShippingPage(status,rows){
  europeUI.status=status;europeUI.rows=rows;
  const draft={...europeUI.draft,country_code:'ES'},test=status.environment==='test',countries=(status.countries||[]).filter(country=>country.code==='ES'),ready=status.configured;
  return adminShell('europe-shipping',`<div class="eu-shipping">${title('Envíos europeos','Envíos nacionales desde Barcelona a la Península y Baleares.','<button class="btn" data-action="eu-refresh">↻ Actualizar</button>')}<div class="eu-mode-note ${test?'eu-test-mode':'eu-live-mode'}" role="note"><strong>${test?'MODO DE PRUEBAS · simulación local':'MODO REAL · contratación de transporte'}</strong><p>${test?'Las tarifas se consultan en Sendcloud. Simular un envío solo crea un registro local: no se solicita ninguna etiqueta, no hay franqueo ni se entrega mercancía al transportista.':'Confirmar un envío contrata el servicio en Sendcloud y puede generar cargos. Comprueba la dirección, las medidas y el importe antes de continuar.'}</p></div><div class="eu-overview"><section class="panel"><div class="panel-title"><div><h2>Conexión con Sendcloud</h2><p>${ready?'Configuración disponible':'Configuración pendiente'}</p></div><span class="badge ${ready?'approved':'expired'}">${ready?'Configurado':'Pendiente'}</span></div><div class="eu-panel-body">${ready?'<p>Comprueba las credenciales y el remitente antes de consultar tarifas.</p>':`<p>Completa la configuración del servidor en Cloudflare.</p><ul>${(status.missing||[]).map(name=>`<li><code>${escape(name)}</code></li>`).join('')}</ul>`}<button class="btn small" type="button" data-action="eu-check" ${!ready?'disabled':''}>Comprobar conexión</button><div id="eu-connection-result" role="status" aria-live="polite"></div></div></section><section class="panel"><div class="panel-title"><div><h2>Origen y alcance</h2><p>${literal(status.origin?.city||'Barcelona')}, <span>${escape(status.origin?.country_code==='ES'?'España':europeCountryNames[status.origin?.country_code]||status.origin?.country_code||'España')}</span></p></div></div><div class="eu-panel-body"><p>${countries.map(country=>`<span>${escape(country.name)}</span>`).join(' · ')}</p><p class="form-help">Canarias, Ceuta y Melilla quedan fuera del alcance actual.</p><p class="form-help">Un solo bulto por envío. Se utilizan el peso y las medidas del paquete ya embalado.</p></div></section></div><p class="note">Este módulo prepara envíos manuales. ${state.config.checkout_enabled?'Los pedidos y los pagos se gestionan en la tienda. <a href="#orders">Ver pedidos</a>':'La tienda está en modo catálogo. <a href="#store">Ver catálogo</a>'}</p>${europeUI.uncertain||rows.some(row=>['unknown','submitting'].includes(row.status))?'<div class="eu-mode-note eu-uncertain" role="alert"><strong>Revisa los envíos con resultado incierto</strong><p>No repitas esos envíos. Actualiza el historial y utiliza «Consultar / conciliar» para comprobar el resultado en Sendcloud. Puedes preparar otros envíos independientes.</p></div>':''}<section class="panel"><div class="panel-title"><div><h2>Nuevo envío manual</h2><p>Introduce un destino real y las medidas del paquete.</p></div><div class="stack"><span class="chip">1 bulto</span><button class="btn small" data-action="eu-new">Preparar otro envío</button></div></div><form id="eu-shipping-form" class="eu-panel-body"><fieldset class="eu-fieldset" ${!ready||europePending()?'disabled':''}><legend>Destinatario</legend><div class="form-grid">${field('name','Nombre y apellidos',draft.name||'','text','required maxlength="100" autocomplete="name"')}${field('company_name','Empresa (opcional)',draft.company_name||'','text','maxlength="100"')}${field('email','Correo electrónico del destinatario',draft.email||'','email','required maxlength="254" autocomplete="email"')}${field('telephone','Teléfono del destinatario',draft.telephone||'','tel','required maxlength="30" autocomplete="tel"')}${field('address','Calle',draft.address||'','text','required maxlength="150" autocomplete="address-line1"')}${field('house_number','Número',draft.house_number||'','text','required maxlength="20"')}${field('address_2','Piso, puerta u otra información (opcional)',draft.address_2||'','text','maxlength="150" autocomplete="address-line2"')}${field('postal_code','Código postal',draft.postal_code||'','text','required minlength="5" maxlength="5" inputmode="numeric" pattern="[0-9]{5}" autocomplete="postal-code"')}${field('city','Ciudad',draft.city||'','text','required maxlength="100" autocomplete="address-level2"')}<label class="field">País de destino<select name="country_code" required autocomplete="country">${countries.map(country=>`<option value="${escape(country.code)}" ${draft.country_code===country.code?'selected':''}>${escape(country.name)}</option>`).join('')}</select></label>${field('state_province_code','Provincia (código ISO, si se requiere)',draft.state_province_code||'','text','maxlength="12" placeholder="p. ej., ES-B"')}</div></fieldset><fieldset class="eu-fieldset" ${!ready||europePending()?'disabled':''}><legend>Paquete embalado · 1 bulto</legend><p class="form-help">Mide y pesa el paquete completo. No se calculan dimensiones a partir de los productos.</p><div class="form-grid eu-parcel-grid">${field('weight','Peso real (kg)',draft.weight||'','number','required min="0.001" step="0.001"')}${field('length','Largo (cm)',draft.length||'','number','required min="0.1" step="0.1"')}${field('width','Ancho (cm)',draft.width||'','number','required min="0.1" step="0.1"')}${field('height','Alto (cm)',draft.height||'','number','required min="0.1" step="0.1"')}</div></fieldset>${field('order_reference','Referencia interna (opcional)',draft.order_reference||'','text',`maxlength="100" ${europePending()?'disabled':''}`)}<div class="form-actions"><button class="btn" type="submit" ${!ready||europePending()?'disabled':''}>Consultar tarifas</button></div><div id="eu-quote-results" aria-live="polite">${europeQuoteResults()}</div></form></section><section class="panel"><div class="panel-title"><div><h2>Historial de envíos</h2><p>Las simulaciones se identifican por separado.</p></div><button class="btn small" data-action="eu-refresh">Actualizar historial</button></div>${europeHistory(rows)}</section>${status.webhook_url?`<details class="eu-webhook"><summary>Webhook de seguimiento</summary><p class="form-help">Registra esta URL en la integración de Sendcloud para recibir actualizaciones.</p><code>${escape(status.webhook_url)}</code></details>`:''}</div>`);
}
async function europeRefresh(){await render();}
function europeReview(){
  const quote=europeUI.quote;if(!quote||Date.parse(quote.expires_at)<=Date.now())throw new Error('La tarifa ha caducado. Consulta las tarifas de nuevo.');
  if(europePending())throw new Error('Consulta y concilia el envío pendiente antes de crear otro.');
  const service=quote.options.find(option=>String(option.id)===$('#eu-shipping-form').elements.eu_service_id.value);if(!service)throw new Error('Selecciona un servicio de envío.');
  const test=quote.environment==='test',draft=europeDraft($('#eu-shipping-form'));europeUI.draft=draft;
  dialog(test?'Simular envío':'Confirmar contratación',`<p><strong>${test?'PRUEBA · simulación local':'ENVÍO REAL · puede generar cargos'}</strong></p><p>${literal(quote.destination.name)} · ${literal(quote.destination.city)}, <span>${escape(europeCountryNames[quote.destination.country_code]||quote.destination.country_code)}</span></p><p>${literal(service.name)} · <strong>${euroMoney(service.price,service.currency||quote.currency)}</strong></p><p class="form-help">${test?'Solo se guardará una simulación en esta tienda. No se crea etiqueta real, no hay franqueo ni entrega al transportista.':'Se solicitará una etiqueta real en Sendcloud. Crear la etiqueta no confirma la entrega del paquete al transportista.'}</p><form id="eu-create-form" data-service-id="${escape(service.id)}">${!test?'<label class="eu-confirm"><input name="confirm_live" type="checkbox" required>Confirmo la dirección, el peso, las medidas y la contratación de este envío con su coste.</label>':''}<div class="form-actions"><button class="btn" type="button" data-action="close">Volver</button><button class="btn primary" type="submit">${test?'Guardar simulación':'Contratar envío y generar etiqueta'}</button></div></form>`);
}
function europeDetail(row){const test=row.environment==='test';dialog(test?'Detalle de la simulación':'Detalle del envío',`<p><strong translate="no">${escape(row.order_reference||row.reference||row.id)}</strong> · <span>${escape(europeShipmentStatuses[row.status]||row.status)}</span></p><p><span translate="no">${escape(row.destination?.name)} · ${escape(row.destination?.address)} ${escape(row.destination?.house_number)}<br>${escape(row.destination?.postal_code)} ${escape(row.destination?.city)}</span> · <span>${escape(europeCountryNames[row.destination?.country_code]||row.destination?.country_code)}</span></p><p>${literal(row.service?.name||'')} · ${euroMoney(row.price,row.currency)}</p><p class="form-help">${test?'Simulación local sin etiqueta real, sin franqueo y sin entrega al transportista.':'La etiqueta no confirma la entrega al transportista. El seguimiento refleja las actualizaciones disponibles.'}</p>${row.last_error?`<p class="danger-note">${escape(row.last_error)}</p>`:''}<div class="timeline">${(row.events||[]).map(event=>`<div><p>${escape(event.message||europeShipmentStatuses[event.status]||event.status)}</p><small>${event.created_at?date(event.created_at):''}</small></div>`).join('')}</div>`);}

const navItems=[['admin','Resumen','◉','dashboard'],['products','Productos','▦','catalog'],['stock','Inventario','▤','stock'],['sales','Pedidos','▣','orders'],['finance','Finanzas','↗','finance'],['shipping','Envíos','▱','shipping'],['europe-shipping','Envíos europeos','↗','shipping'],['users','Usuarios','♧','users'],['coupons','Cupones','◇','coupons'],['invoices','Facturas','▧','invoices'],['emails','Correos electrónicos','✉','users'],['audit','Actividad','◷','audit']];
function adminShell(page,content){return `${demoBanner()}<div class="admin-shell"><aside class="sidebar">${brand()}<p class="eyebrow">Gestión de la tienda</p><nav class="side-nav">${navItems.filter(n=>has(n[3])&&(!euroCheckout()||n[0]!=='invoices')&&(n[0]!=='europe-shipping'||state.config.shipping_provider==='sendcloud')).map(([id,label,icon])=>`<a href="#${id}" class="${page===id?'active':''}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav><div class="sidebar-bottom"><a href="#store">↗ &nbsp; Acceder a la tienda</a><button class="btn small" data-action="logout">Cerrar sesión</button></div></aside><div><header class="admin-top"><p>EDG / <span>${escape(navItems.find(n=>n[0]===page)?.[1]||'Gestión')}</span></p><div class="stack"><a class="btn small" href="#store">Ver tienda ↗</a><button class="btn small" data-action="account"><span class="user-pill"><b class="avatar" translate="no">${escape(state.user.name.slice(0,2).toUpperCase())}</b><span>${literal(state.user.name)}<br><small class="role-label">${roleNames[state.user.role]}</small></span></span></button>${i18n.selector()}</div></header><main class="admin-main">${content}</main></div></div>`;}
const title=(heading,description,action='')=>`<div class="page-title"><div><h1>${heading}</h1><p>${description}</p></div>${action}</div>`;
function orderTable(orders,shipping=false){return !orders.length?empty('Todavía no hay pedidos','Los pedidos aparecerán en esta lista.'): `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Importe</th><th>${shipping?'Seguimiento':'Estado'}</th><th></th></tr></thead><tbody>${orders.map(o=>`<tr><td><strong>#${o.number}</strong><small>${o.items.length} producto(s)</small></td><td translate="no">${escape(o.customer_name)}<small>${escape(o.customer_email)}</small></td><td>${date(o.created_at)}</td><td>${orderMoney(o,o.total)}</td><td>${shipping?`${o.tracking_code?literal(o.tracking_code):'Sin especificar'}<small>${statuses[o.status]}</small>`:badge(o.status)}</td><td><button class="btn small" data-action="admin-order" data-id="${o.id}">Detalles ↗</button></td></tr>`).join('')}</tbody></table></div>`;}
function dashboardPage(data){const m=data.metrics,financial=has('finance');const metrics=financial?[['Ingresos netos',money(m.net_revenue),'Cobros − reembolsos − gastos'],['Pedidos',m.orders,'Total de pedidos de la tienda'],['Pendientes de envío',m.to_ship,'Pagados, en preparación o listos'],['Existencias bajas',m.low_stock,'Productos que necesitan reposición']]:[['Pedidos',m.orders,'Total de pedidos de la tienda'],['Pendientes de envío',m.to_ship,'Próximas entregas'],['Productos',m.products,'Productos activos'],['Existencias bajas',m.low_stock,'Productos que necesitan reposición']];const max=Math.max(1,...data.revenue.map(r=>Math.abs(r.amount)));return adminShell('admin',`${title(`Hola, ${escape(state.user.name.split(' ')[0])}.`,'Una visión clara de tu tienda, del pedido a la entrega.','<button class="btn" data-action="refresh">↻ Actualizar</button>')}<div class="metrics">${metrics.map(([label,value,note])=>`<article class="metric"><div class="label">${label}<span>↗</span></div><strong>${value}</strong><p>${note}</p></article>`).join('')}</div><section class="panel"><div class="panel-title"><div><h2>Pedidos recientes</h2><p>Consulta los últimos movimientos de la tienda</p></div><a class="btn small" href="#sales">Ver todos →</a></div>${orderTable(data.recent_orders)}</section><div class="dashboard-bottom"><section class="panel"><div class="panel-title"><div><h2>${financial?'Movimientos financieros':'Tu tienda conectada'}</h2><p>${financial?'Saldo diario de los últimos días con movimientos':'Tienda, inventario y envíos en un mismo flujo'}</p></div></div>${financial&&data.revenue.length?`<div class="bar-chart" role="img" aria-label="Saldo diario: ${escape(data.revenue.slice().reverse().map(r=>`${r.day}: ${money(r.amount)}`).join('; '))}">${data.revenue.slice().reverse().map(r=>`<div class="bar h-${Math.max(1,Math.round(Math.abs(r.amount)/max*10))}" title="${r.day}: ${money(r.amount)}"></div>`).join('')}</div><p class="chart-note">La altura representa el valor absoluto. Pasa el cursor para ver los importes y sus signos.</p>`:empty('Todo listo para empezar','Las ventas confirmadas actualizarán los indicadores.')}</section><section class="panel"><div class="panel-title"><div><h2>Es hora de reponer</h2><p>Productos que requieren atención</p></div><span class="chip">${data.alerts.length}</span></div>${data.alerts.length?`<div class="alert-list">${data.alerts.slice(0,5).map(p=>`<div class="alert-item"><span translate="no">${escape(p.name)}</span><span class="badge expired">${p.available} un.</span></div>`).join('')}</div>`:empty('Inventario al día','No hay avisos de reposición.')}</section></div>`);}
function inventoryVariants(p){return `<div class="inventory-variant-table table-wrap"><table><thead><tr><th>Color / Talla</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th></th></tr></thead><tbody>${(p.variants||[]).map(v=>`<tr><td><strong translate="no">${escape(v.color_name)} · ${escape(v.size||'Única')}</strong><small translate="no">${escape(v.sku)}${v.active===false||v.active===0?' · Inactivo':''}</small></td><td>${v.stock}</td><td>${v.reserved}</td><td>${v.available<=v.low_stock?`<span class="badge expired">${v.available} · Reponer</span>`:v.available}</td><td><button class="btn small" data-action="adjust-stock" data-id="${p.id}" data-variant-id="${escape(v.id)}">Ajustar</button></td></tr>`).join('')}</tbody></table></div>${p.unallocated_stock>0?`<div class="inventory-unallocated"><span><b>${p.unallocated_stock}</b> unidades pendientes de asignar</span><button class="btn small" data-action="allocate-variants" data-id="${p.id}" ${p.unallocated_reserved>0?'disabled':''}>Distribuir existencias</button></div>`:''}`;}
function productsPage(products,stock=false){
  const pending=products.filter(p=>!p.variants_enabled&&productSizeValues(p).length>1).length;
  return adminShell(stock?'stock':'products',`${title(stock?'Inventario':'Productos',stock?'Existencias por color y talla, con reservas y movimientos.':'Un catálogo organizado por modelo, estampa y variaciones.',stock?'':'<button class="btn" data-action="categories">Categorías</button><button class="btn primary" data-action="new-product">+ Nuevo producto</button>')}${stock?'<div class="note">Cada variante: disponible = físico − reservado. Las unidades sin asignar no están disponibles para la venta.</div>':''}${pending?`<div class="variant-catalog-notice"><strong>${pending} producto(s) pendientes de distribuir</strong><p>Abre Editar y asigna las existencias actuales entre colores y tallas.</p></div>`:''}<section class="panel"><div class="table-wrap"><table><thead><tr><th>Producto / SKU</th>${stock?'<th>Físico</th><th>Reservado</th><th>Disponible</th>':'<th>Categoría</th><th>Precio</th><th>Estado</th>'}<th></th></tr></thead><tbody>${products.map(p=>`<tr><td><strong translate="no">${escape(p.name)}</strong><small translate="no">${escape(p.sku)}</small>${p.variants_enabled?`<small>${activeVariants(p).length} variaciones · ${new Set(activeVariants(p).map(v=>v.color_name)).size} colores</small>`:productSizeValues(p).length?`<small translate="no">${escape(productSizeValues(p).join(', '))}</small>`:''}${legacyNeedsAllocation(p)?'<span class="badge pending">Pendiente de distribuir</span>':''}</td>${stock?`<td>${p.stock}</td><td>${p.reserved}</td><td>${p.available<=p.low_stock?`<span class="badge expired">${p.available} · Reponer</span>`:p.available}</td>`:`<td${categoryTranslation(p.category)}>${escape(p.category)}</td><td>${money(p.price)}<small>Coste ${money(p.cost)}</small></td><td>${p.active?'<span class="badge approved">Activo</span>':'<span class="badge cancelled">Inactivo</span>'}</td>`}<td><div class="table-actions"><button class="btn small" data-action="${stock?'adjust-stock':'edit-product'}" data-id="${p.id}">${stock?'Ajustar inventario':'Editar'}</button>${stock?'':`<button class="btn small danger" data-action="delete-product" data-id="${p.id}" aria-label="Eliminar ${escape(p.name)}">Eliminar</button>`}</div></td></tr>${stock&&p.variants_enabled?`<tr class="inventory-detail-row"><td colspan="5"><details class="inventory-variants"><summary>Ver colores y tallas <span>${activeVariants(p).length}</span></summary>${inventoryVariants(p)}</details></td></tr>`:''}`).join('')}</tbody></table></div>${!products.length?empty('Añade tu primer producto'):''}</section>${stock?'<section class="panel"><div class="panel-title"><h2>Últimos movimientos</h2></div><div id="movements"></div></section>':''}`);
}

function financePage(ledger,data){const income=ledger.filter(l=>l.type==='income').reduce((s,l)=>s+l.amount,0),refunds=ledger.filter(l=>l.type==='refund').reduce((s,l)=>s+l.amount,0),expenses=ledger.filter(l=>l.type==='expense').reduce((s,l)=>s+l.amount,0);return adminShell('finance',`${title('Finanzas','Cobros confirmados, gastos y reembolsos.','<button class="btn primary" data-action="expense">+ Registrar gasto</button>')}<div class="metrics">${[['Saldo neto',money(data.metrics.net_revenue),'Total de todo el historial'],['Cobros',money(income),'Últimos 500 movimientos'],['Reembolsos',money(-refunds),'Últimos 500 movimientos'],['Gastos',money(-expenses),'Últimos 500 movimientos']].map(([a,b,c])=>`<article class="metric"><div class="label">${a}</div><strong>${b}</strong><p>${c}</p></article>`).join('')}</div><div class="note">Los ingresos netos son el saldo de los cobros, reembolsos y gastos registrados. Las comisiones de la pasarela y los costes de envío deben registrarse como gastos. Este panel no calcula el beneficio contable.</div><section class="panel"><div class="panel-title"><h2>Movimientos</h2><button class="btn small" data-action="export-finance">Exportar CSV ↓</button></div>${ledger.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Importe</th></tr></thead><tbody>${ledger.map(l=>`<tr><td>${date(l.created_at)}</td><td translate="no">${escape(l.description)}</td><td>${escape(ledgerTypes[l.type]||l.type)}</td><td class="${l.amount>0?'ledger-positive':'ledger-negative'}"><strong>${money(l.amount)}</strong></td></tr>`).join('')}</tbody></table></div>`:empty('Todavía no hay movimientos')}</section>`);}
function usersPage(users){return adminShell('users',`${title('Usuarios y accesos','Cada persona tiene los permisos necesarios para su función.','<button class="btn primary" data-action="new-user">+ Nuevo usuario</button>')}<section class="panel"><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo electrónico</th><th>Perfil</th><th>Estado</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td><strong translate="no">${escape(u.name)}</strong></td><td translate="no">${escape(u.email)}</td><td>${roleNames[u.role]}</td><td>${u.active?'<span class="badge approved">Activo</span>':'<span class="badge cancelled">Bloqueado</span>'}</td><td>${u.id!==state.user.id?`<button class="btn small" data-action="edit-user" data-id="${u.id}">Permisos</button>`:'<span class="muted">Tu acceso</span>'}</td></tr>`).join('')}</tbody></table></div></section>`);}
let renderVersion=0;
async function render({scrollToCatalog=false}={}){const version=++renderVersion;let page=location.hash.slice(1)||'store';if(page==='catalog')page='store';if(page==='invoices'&&euroCheckout())page='admin';const needsLogin=!state.user&&navItems.some(([id])=>id===page);if(needsLogin)page='store';try{
  let html;
  if(page.startsWith('reset-password/')){html=storeShell('<div class="password-page"><h1>Crea una nueva contraseña</h1><p class="muted">El enlace es temporal y solo se puede utilizar una vez.</p><form id="reset-form" data-token="'+escape(page.split('/')[1])+'">'+field('password','Nueva contraseña','','password','required minlength="12" maxlength="128" autocomplete="new-password"')+'<button class="btn primary" type="submit">Guardar nueva contraseña</button></form></div>');}
  else if(['skate','musica'].includes(page)){if(state.user)state.cart=await api('/cart');html=page==='skate'?skatePage():musicPage();}
  else if(['store','cart','orders'].includes(page)) {
    if(page==='store'){[state.products,state.storeCategories]=await Promise.all([api('/products'),api('/categories')]);}else state.products=await api('/products');if(state.user)state.cart=await api('/cart');
    html=page==='store'?storePage():page==='cart'?cartPage():ordersPage(state.user?await api('/orders'):[]);
  } else {
    if(!has('dashboard')) {location.hash='store';if(!state.user)authDialog();return;}
    const permission=navItems.find(n=>n[0]===page)?.[3];if(!permission || !has(permission)){location.hash='admin';return;}
    if(page==='europe-shipping'){if(state.config.shipping_provider!=='sendcloud'){location.hash='admin';return;}const [status,rows]=await Promise.all([api('/admin/europe-shipping/status'),api('/admin/europe-shipping/shipments')]);html=europeShippingPage(status,rows);}
    if(page==='admin')html=dashboardPage(await api('/admin/dashboard'));
    if(['products','stock'].includes(page)){state.adminProducts=await api('/admin/products');if(page==='products')state.categories=await api('/admin/categories');html=productsPage(state.adminProducts,page==='stock');}
    if(['sales','shipping'].includes(page)){state.adminOrders=await api('/admin/orders');let orders=state.adminOrders;if(page==='shipping')orders=orders.filter(o=>['paid','picking','ready','shipped','delivered'].includes(o.status));html=adminShell(page,`${title(page==='shipping'?'Envíos y entregas':'Pedidos',page==='shipping'?'Prepara, envía y consulta cada entrega.':'Un historial para cada venta.','<button class="btn" data-action="refresh">↻ Actualizar</button>')}<div class="filters">${['Todos',...(page==='shipping'?['paid','picking','ready','shipped','delivered']:['awaiting_payment','paid','shipped','cancelled','payment_review'])].map(s=>`<button class="filter ${s==='Todos'?'active':''}" data-action="order-filter" data-status="${s}" data-shipping="${page==='shipping'}">${statuses[s]||s}</button>`).join('')}</div><section class="panel" id="orders-table">${orderTable(orders,page==='shipping')}</section>`);}
    if(page==='finance'){state.ledger=await api('/admin/finance');html=financePage(state.ledger,await api('/admin/dashboard'));}
    if(page==='coupons'){state.coupons=await api('/admin/coupons');html=couponsPage(state.coupons);}
    if(page==='invoices'){state.invoices=await api('/admin/invoices');html=invoicesPage(state.invoices);}
    if(page==='emails'){html=emailsPage(await api('/admin/emails'));}
    if(page==='users'){state.users=await api('/admin/users');html=usersPage(state.users);}
    if(page==='audit'){const logs=await api('/admin/audit');html=adminShell(page,`${title('Actividad','Historial de los cambios realizados por el equipo.')}<section class="panel"><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Referencia</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${date(l.created_at)}</td><td>${l.actor_name?literal(l.actor_name):'Sistema'}</td><td>${escape(auditActions[l.action]||l.action)}</td><td translate="no">${escape(l.entity_id||'—')}</td></tr>`).join('')}</tbody></table></div></section>`);}
  }
  if(version!==renderVersion)return;teardownCampaignMotion();teardownStoreHeader();teardownSkateNavigation();const wasSkate=!!$('.skate-page');$('#app').innerHTML=html;teardownSkateNavigation=bindSkateNavigation();document.title=page==='musica'?'MÚSICA · Historia y discos · EDG':page==='skate'?'SKATE · Historia y vídeos · EDG Skateboards':'EDG Commerce · Tienda y gestión';if((['skate','musica'].includes(page)||wasSkate)&&location.hash!=='#catalog')window.scrollTo({top:0,behavior:'auto'});teardownStoreHeader=bindStoreHeader();teardownCampaignMotion=bindCampaignMotion();if(needsLogin)authDialog();
  if(page==='stock'){const rows=await api('/admin/movements');if(version!==renderVersion)return;$('#movements').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Variación</th><th>Motivo</th><th>Responsable</th><th>Fecha</th></tr></thead><tbody>${rows.map(r=>`<tr><td translate="no">${escape(r.product_name)}${variantDescription(r)?`<small>${escape(variantDescription(r))}</small>`:""}</td><td>${r.quantity>0?'+':''}${r.quantity}</td><td translate="no">${escape(r.reason)}</td><td>${r.actor_name?literal(r.actor_name):'Sistema'}</td><td>${date(r.created_at)}</td></tr>`).join('')}</tbody></table></div>`:empty('No hay movimientos');}
  if(scrollToCatalog&&location.hash==='#catalog')$('#catalog')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
}catch(e){toast(e.message,true);if(!$('#app').children.length||$('#app').querySelector('.store-loading'))$('#app').innerHTML=empty('No se ha podido cargar','Actualiza la página para volver a intentarlo.');}}
function authDialog(register=false){dialog(register?'Crea tu cuenta':'Te damos la bienvenida',`<p class="muted">${register?'Regístrate para comprar y consultar tus pedidos.':'Inicia sesión para acceder a tu tienda y tus pedidos.'}</p><form id="auth-form" data-register="${register}">${register?field('name','Nombre completo','','text','required minlength="2" autocomplete="name"'):''}${field('email','Correo electrónico','','email','required autocomplete="email"')}${field('password','Contraseña','','password',`required ${register?'minlength="12"':''} maxlength="128" autocomplete="${register?'new-password':'current-password'}"`)}${register?'<p class="form-help">Utiliza una contraseña exclusiva de al menos 12 caracteres.</p>':''}${legalFormNotice()}<div class="form-actions"><button class="btn primary" type="submit">${register?'Crear cuenta':'Iniciar sesión'}</button></div></form>${!register?'<div class="switch-auth"><button data-action="forgot">He olvidado mi contraseña</button></div>':''}<div class="switch-auth">${register?'¿Ya tienes cuenta?':'¿Todavía no tienes cuenta?'}<button data-action="${register?'login':'register'}">${register?'Iniciar sesión':'Crear mi cuenta'}</button></div>`);}
function accountDialog(){dialog('Mi cuenta',`<h3 translate="no">${escape(state.user.name)}</h3><p class="muted">${literal(state.user.email)} · <span>${roleNames[state.user.role]}</span></p><div class="stack form-actions">${has('dashboard')?'<a class="btn" href="#admin" data-action="close">Acceder a la gestión</a>':''}<button class="btn" data-action="password">Cambiar contraseña</button><button class="btn danger" data-action="logout">Cerrar sesión</button></div>`);}
const checkoutAddressNames=['name','phone','street','number','complement','postal_code','city','country_code'];
function checkoutAddress(form){const values=Object.fromEntries(new FormData(form));return Object.fromEntries(checkoutAddressNames.map(key=>[key,values[key]||'']));}
function invalidateCheckoutQuote(){
  state.quote=null;state.checkoutQuoteRevision=(state.checkoutQuoteRevision||0)+1;
  const results=$('#quote-results'),submit=$('#place-order');if(results)results.innerHTML='';if(submit)submit.disabled=true;
  updateCheckoutTotal();
}
function updateCheckoutTotal(){
  const form=$('#checkout-form');if(!form)return;
  const service=state.quote?.options.find(option=>option.id===form.elements.service_id?.value);
  const output=$('#checkout-order-total');if(output)output.textContent=service?money(state.cart.subtotal-(state.coupon?.discount||0)+service.price):'—';
}
function checkoutPaymentChoices(){
  const methods=state.config.payment_methods||[],labels={bank_transfer:'Transferencia bancaria · Sabadell',stripe:'Tarjeta · Stripe'};
  return `<fieldset class="checkout-payment-methods"><legend>Método de pago</legend>${['bank_transfer','stripe'].filter(method=>methods.includes(method)).map((method,index)=>`<label class="shipping-choice payment-choice"><input type="radio" name="payment_method" value="${method}" ${index===0?'checked':''} required><span><strong>${labels[method]}</strong><small>${method==='bank_transfer'?'Recibirás el IBAN y la referencia de tu pedido. El pago se confirma al comprobar el crédito en el banco.':'Paga con tarjeta en la página segura de Stripe.'}</small></span></label>`).join('')}</fieldset>`;
}
function checkoutDialog(){
  if(catalogMode())return toast('Próximamente podrás comprar.');
  state.quote=null;state.coupon=null;state.checkoutKey=crypto.randomUUID();state.checkoutQuoteRevision=(state.checkoutQuoteRevision||0)+1;
  const fields=euroCheckout()?`${field('name','Nombre del destinatario',state.user.name,'text','required maxlength="100" autocomplete="name"')}${field('phone','Teléfono','','tel','required maxlength="30" autocomplete="tel"')}${field('street','Calle / Avenida','','text','required maxlength="150" autocomplete="address-line1"')}${field('number','Número','','text','required maxlength="25"')}${field('complement','Información adicional','','text','maxlength="150" autocomplete="address-line2"')}${field('postal_code','Código postal','','text','required pattern="[0-9]{5}" minlength="5" maxlength="5" inputmode="numeric" autocomplete="postal-code"')}${field('city','Ciudad','','text','required maxlength="100" autocomplete="address-level2"')}<label class="field">País de destino<select name="country_code" required autocomplete="country"><option value="ES">España (Península y Baleares)</option></select></label>`:`${field('name','Nombre del destinatario',state.user.name,'text','required')}${field('phone','Teléfono','','tel','required')}${field('document','CPF / CNPJ','','text','required')}${field('postal_code','Código postal (CEP)','','text','required maxlength="9"')}${field('street','Calle / Avenida','','text','required')}${field('number','Número','','text','required')}${field('district','Barrio','','text','required')}${field('complement','Información adicional')}${field('city','Ciudad','','text','required')}${field('state','Estado (UF)','','text','required minlength="2" maxlength="2" pattern="[A-Z]{2}"')}`;
  dialog('Envío y pago',`<form id="checkout-form">${paymentTest()?'<p class="checkout-test-note" role="note">Simulación: no realices una transferencia real. Usa tarjetas de prueba.</p>':''}<div class="form-grid">${fields}</div>${euroCheckout()?'<p class="form-help">Envíos a la Península y Baleares. Introduce la dirección completa antes de calcular el envío.</p>':''}<div class="coupon-entry">${field('coupon','Cupón de descuento (opcional)')}<button class="btn" type="button" data-action="apply-coupon">Aplicar cupón</button></div><div id="coupon-summary"></div><button type="button" class="btn form-actions" data-action="quote">Calcular envío</button><div id="quote-results" class="quote-results" aria-live="polite"></div><div class="checkout-total"><span>Productos</span><span id="checkout-products-total">${money(state.cart.subtotal)}</span></div><div class="checkout-total"><strong>Total con envío</strong><strong id="checkout-order-total">—</strong></div>${euroCheckout()?checkoutPaymentChoices():`<p class="form-help">${state.config.mode==='demo'?'Demostración: podrás simular el pago en el pedido.':'Se te redirigirá a Mercado Pago para elegir el método de pago.'}</p>`}${legalFormNotice()}<div class="form-actions"><button class="btn primary" type="submit" id="place-order" disabled>Confirmar pedido →</button></div></form>`);
}
function productDialog(p,selection={}){
  if(!p)return;
  const variants=activeVariants(p),palette=[...new Map(variants.map(v=>[v.color_name,{name:v.color_name,hex:v.color_hex}])).values()];
  const color=selection.color??palette[0]?.name,matching=variants.filter(v=>v.color_name===color).sort((a,b)=>productSizeValues(p).indexOf(a.size)-productSizeValues(p).indexOf(b.size)),variant=matching.find(v=>v.id===selection.variantId)||(matching.length===1?matching[0]:null),images=(variant?.images?.length?variant.images:matching.find(v=>v.images?.length)?.images)||p.images||[];
  state.productSelection={product:p,color,variantId:variant?.id||null};
  const visual={...p,images},pending=legacyNeedsAllocation(p),available=p.variants_enabled?variant?.available:p.available;
  dialog(p.name,`<div class="product-detail-layout"><div><div id="selected-product-image" class="product-visual ${colorClass(p.color)}">${productVisual(visual)}</div>${images.length>1?`<div class="photo-gallery">${images.map(url=>`<button data-action="photo-main" data-url="${escape(url)}" aria-label="Ver foto de ${escape(p.name)}"><img src="${escape(url)}" alt="Foto de ${escape(p.name)}"></button>`).join('')}</div>`:''}</div><div class="product-detail-copy"><p class="eyebrow"${categoryTranslation(p.category)}>${escape(p.category)}</p><p translate="no">${escape(p.description)}</p>${p.variants_enabled?`<div id="variant-selection"><fieldset class="variant-choice"><legend>Color <span translate="no">· ${escape(color||'')}</span></legend><div class="variant-color-options">${palette.map(c=>`<button type="button" data-action="choose-color" data-color="${escape(c.name)}" aria-pressed="${c.name===color}" class="variant-color-option">${colorSwatch(c.hex)}<span translate="no">${escape(c.name)}</span></button>`).join('')}</div></fieldset><fieldset class="variant-choice"><legend>${/shai?pe|tabla/i.test(p.category)?'Anchura':'Talla'}</legend><div class="variant-size-options">${matching.map(v=>`<button type="button" data-action="choose-size" data-variant-id="${escape(v.id)}" aria-pressed="${variant?.id===v.id}" ${v.available<=0?'disabled':''} title="${v.available<=0?'Agotado':escape(v.sku)}"><span translate="no">${escape(v.size||'Única')}</span>${v.available<=0?'<small>Agotado</small>':''}</button>`).join('')}</div></fieldset><p class="variant-stock-status" role="status">${variant?variant.available>0?'Disponible': 'Esta combinación está agotada.':'Selecciona una talla para continuar.'}</p>${variant?`<p class="form-help" translate="no">${escape(variant.sku)}</p>`:''}</div>`:pending?'<p class="note">Próximamente disponible.</p>':`<p class="form-help" translate="no">${escape([p.sku,...productSizeValues(p)].join(' · '))}</p>`}<div class="product-purchase"><strong>${money(variant?.price??p.price)}</strong><button class="btn primary" data-action="${p.variants_enabled?'add-selected':'add'}" data-id="${p.id}" ${!available||pending||catalogMode()?'disabled':''}>${catalogMode()?'Disponible próximamente':pending?'Próximamente':p.variants_enabled&&!variant?'Selecciona una talla':available?'Añadir al carrito':'Agotado'}</button></div></div></div>`,true);
  $('#dialog').classList.add('product-detail-dialog');
}

function categoryImagePreview(id){return id?`<img src="/media/${escape(id)}.jpg" alt="Vista previa del fondo de la categoría">`:'<span>Sin imagen</span>';}
function categoryImagePicker(id=null){return `<input type="hidden" name="image_id" value="${escape(id||'')}"><div class="category-image-picker"><div class="category-image-preview">${categoryImagePreview(id)}</div><div class="category-image-controls"><label class="field">Imagen de fondo<input class="category-image-input" type="file" accept="image/jpeg,image/png,image/webp"></label><button type="button" class="btn small category-image-remove" data-action="remove-category-image" ${id?'':'hidden'}>Quitar imagen</button><p class="form-help">JPEG, PNG o WebP, hasta 5 MB. Guarda la categoría para aplicar los cambios.</p></div></div>`;}
function updateCategoryImagePreview(form){const id=form.elements.image_id.value;form.querySelector('.category-image-preview').innerHTML=categoryImagePreview(id);form.querySelector('.category-image-remove').hidden=!id;}
function categoryEditForm(c){return `<form class="category-edit-form category-editor" data-previous="${escape(c.name)}">${field('name','Categoría',c.name,'text','required maxlength="80"')}${categoryImagePicker(c.image_id)}<div class="form-actions"><button class="btn danger" type="button" data-action="delete-category">Eliminar categoría</button><button class="btn" type="submit">Guardar cambios</button></div></form>`;}
function categoriesDialog(){dialog('Categorías',`<p class="muted">Elige el fondo de cada tarjeta de «Descubre más». Las categorías aparecen en la tienda cuando tienen productos activos.</p><form id="category-form" class="category-editor">${field('name','Nueva categoría','','text','required maxlength="80"')}${categoryImagePicker()}<div class="form-actions"><button class="btn primary" type="submit">Añadir categoría</button></div></form><p class="form-help">Al cambiar el nombre de una categoría se actualizan todos los productos asociados.</p><div id="category-list">${state.categories.map(categoryEditForm).join('')}</div>`);}
function productSizeValues(product){return Array.isArray(product.sizes)?product.sizes:(product.size?[product.size]:[]);}
function sizeField(category,selected=[]){
  const definition=state.categories.find(c=>c.name===category),sizes=definition?.sizes||[];
  if(!sizes.length)return `<label class="field">Tallas (separadas por comas)<input name="sizes_text" type="text" maxlength="638" value="${escape(selected.join(', '))}" data-initial-sizes="${escape(JSON.stringify(selected))}" aria-describedby="product-size-help"></label><p id="product-size-help" class="form-help">Opcional. Por ejemplo: S, M, L. Cada combinación de color y talla tiene sus propias existencias.</p>`;
  const options=definition.allow_legacy_sizes===false?sizes:[...new Set([...sizes,...selected])];
  const hasSelection=options.some(size=>selected.includes(size));
  return `<fieldset class="product-size-field" aria-describedby="product-size-help"><legend>${/shai?pe|tabla/i.test(category)?'Anchuras disponibles (pulgadas)':'Tallas disponibles'}</legend><div class="product-size-options">${options.map((size,index)=>`<label class="product-size-option"><input type="checkbox" name="sizes" value="${escape(size)}" ${selected.includes(size)?'checked':''} ${!index&&!hasSelection?'required':''}><span translate="no">${escape(size)}</span></label>`).join('')}</div><p id="product-size-help" class="form-help">Selecciona una o varias opciones. Cada combinación de color y talla tiene sus propias existencias.</p></fieldset>`;
}
function readProductSizes(form){
  const input=form.elements.namedItem('sizes_text');
  if(input){
    const initial=JSON.parse(input.dataset.initialSizes||'[]');
    if(input.value===initial.join(', '))return initial;
    return [...new Set(input.value.split(',').map(value=>value.trim()).filter(Boolean))];
  }
  return new FormData(form).getAll('sizes');
}
function validateProductSizes(form){
  const choices=[...form.querySelectorAll('input[name="sizes"]')];
  if(!choices.length)return true;
  const selected=choices.some(input=>input.checked);
  choices[0].required=!selected;
  choices[0].setCustomValidity(selected?'':i18n.t(/shai?pe|tabla/i.test(form.elements.category.value)?'Selecciona al menos una anchura.':'Selecciona al menos una talla.'));
  return selected;
}
window.addEventListener('edg:languagechange',()=>{const form=$('#product-form');if(form)validateProductSizes(form);});
function readImageIds(images){if(Array.isArray(images))return [...images];try{return JSON.parse(images||'[]');}catch{return [];}}
function variantEditorColors(p){
  const groups=new Map();
  for(const v of p.variants||[]){const key=v.color_name.toLocaleLowerCase();if(!groups.has(key))groups.set(key,{key:crypto.randomUUID(),name:v.color_name,hex:v.color_hex,image_ids:[...(v.image_ids||[])],variants:{}});groups.get(key).variants[v.size||'']={...v,off:v.active===false||v.active===0};}
  return groups.size?[...groups.values()]:[{key:crypto.randomUUID(),name:'',hex:'#111111',image_ids:[],variants:{}}];
}
function syncVariantDraft(){
  const editor=state.variantEditor;if(!editor)return;
  for(const row of document.querySelectorAll('.variant-color-row')){
    const color=editor.colors.find(c=>c.key===row.dataset.colorKey);if(!color)continue;
    color.name=row.querySelector('.variant-color-name').value;color.hex=row.querySelector('.variant-color-hex').value;
    for(const cell of row.querySelectorAll('.variant-cell')){
      const size=cell.dataset.size,v=color.variants[size]||{};v.off=!cell.querySelector('.variant-offered').checked;
      const stock=cell.querySelector('.variant-stock-input');if(stock&&!stock.readOnly)v.stock=Number(stock.value||0);
      const price=cell.querySelector('.variant-price-input');v.price_override=price?.value?Math.round(Number(price.value)*100):null;const lowStock=cell.querySelector('.variant-low-stock-input');v.low_stock=Number(lowStock?.value??5);
      color.variants[size]=v;
    }
  }
}
function variantEditorSizes(){const form=$('#product-form');return form?readProductSizes(form):[];}
function variantMatrix(){
  const editor=state.variantEditor,sizes=variantEditorSizes(),columns=sizes.length?sizes:[''];
  return `<div class="variant-editor-toolbar"><div><h3>Colores y existencias</h3><p class="form-help">0 = agotado. Desmarca una combinación que no vendes.</p></div><button class="btn small" type="button" data-action="add-variant-color">+ Añadir color</button></div><p class="variant-scroll-hint">Desliza para ver todas las tallas.</p><div class="table-wrap variant-matrix"><table><thead><tr><th>Color / Fotos</th>${columns.map(size=>`<th translate="no">${escape(size||'Única')}</th>`).join('')}<th></th></tr></thead><tbody>${editor.colors.map((c,index)=>`<tr class="variant-color-row" data-color-key="${c.key}"><td><div class="variant-color-fields"><label class="field">Nombre del color<input class="variant-color-name" value="${escape(c.name)}" required maxlength="50" placeholder="Ej. Negro" aria-label="Nombre del color ${index+1}"></label><label class="field variant-swatch-field"><span class="sr-only">Muestra del color ${index+1}</span><input class="variant-color-hex" type="color" value="${escape(c.hex)}" aria-label="Muestra del color ${index+1}"></label></div><label class="variant-photo-label">Fotos de este color<input class="variant-photo-input" data-color-key="${c.key}" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div class="variant-color-photos">${c.image_ids.map((id,photoIndex)=>`<div class="photo-thumb"><img src="/media/${escape(id)}.jpg" alt="Foto de ${escape(c.name||'color')} ${photoIndex+1}"><button type="button" data-action="remove-variant-photo" data-color-key="${c.key}" data-index="${photoIndex}" aria-label="Eliminar foto del color ${index+1}">×</button></div>`).join('')}</div></td>${columns.map(size=>{const v=c.variants[size]||{},off=!!v.off,existing=!!v.id,locked=editor.product.variants_enabled;return `<td class="variant-cell" data-size="${escape(size)}"><label class="variant-offer-label"><input class="variant-offered" type="checkbox" ${off?'':'checked'} aria-label="Ofrecer ${escape(c.name||`Color ${index+1}`)} · ${escape(size||'Única')}"><span>Ofrecer</span></label><span class="variant-not-offered" aria-hidden="true">—</span><input class="variant-stock-input" type="number" min="0" max="100000" step="1" value="${v.stock||0}" ${locked?'readonly':''} ${off?'disabled':''} aria-label="Existencias ${escape(c.name||`Color ${index+1}`)} · ${escape(size||'Única')}">${locked?`<small>${existing?'Físico':'Alta con 0 unidades'}</small>`:'<small>Unidades</small>'}<details class="variant-price-details"><summary>Precio y aviso</summary><label class="field"><span class="sr-only">Precio ${escape(c.name||`Color ${index+1}`)} · ${escape(size||'Única')}</span><input class="variant-price-input" type="number" min="0.01" step="0.01" placeholder="Precio general" value="${v.price_override!=null?(v.price_override/100).toFixed(2):''}" ${off?'disabled':''} aria-label="Precio ${escape(c.name||`Color ${index+1}`)} · ${escape(size||'Única')}"></label><label class="field">Aviso<input class="variant-low-stock-input" type="number" min="0" max="10000" step="1" value="${v.low_stock??Number($('#product-form').elements.low_stock.value)}" aria-label="Aviso ${escape(c.name||`Color ${index+1}`)} · ${escape(size||'Única')}"></label>${existing?`<small class="variant-sku" translate="no">${escape(v.sku)}</small>`:''}</details></td>`;}).join('')}<td><button class="icon-btn" type="button" data-action="remove-variant-color" data-color-key="${c.key}" aria-label="Eliminar color ${index+1}">×</button></td></tr>`).join('')}</tbody></table></div><p id="variant-allocation-total" class="variant-allocation-total" role="status"></p>${editor.product.variants_enabled?'<p class="form-help">Registra reposiciones y ajustes en Inventario. Los códigos SKU se generan automáticamente.</p>':'<p class="form-help">Los códigos SKU se generan automáticamente para cada color y talla.</p>'}`;
}
function updateVariantTotal(){
  const editor=state.variantEditor,output=$('#variant-allocation-total');if(!editor||!output)return;
  const sizes=variantEditorSizes(),columns=sizes.length?sizes:[''];let total=0,count=0;
  for(const c of editor.colors)for(const size of columns){const v=c.variants[size]||{};if(!v.off){total+=Number(v.stock||0);count++;}}
  if(editor.product.variants_enabled)total=editor.product.stock||0;
  output.textContent=editor.product.id&&!editor.product.variants_enabled?i18n.t('Unidades distribuidas')+`: ${total} / ${editor.product.stock||0}`:i18n.t('Variaciones')+`: ${count} · `+i18n.t('Existencias físicas')+`: ${total}`;
  output.classList.toggle('is-incomplete',!!editor.product.id&&!editor.product.variants_enabled&&total!==(editor.product.stock||0));
}
function renderVariantMatrix(){const target=$('#variant-editor');if(!target)return;target.innerHTML=variantMatrix();updateVariantTotal();}
function readProductVariants(){
  syncVariantDraft();const editor=state.variantEditor,sizes=variantEditorSizes(),columns=sizes.length?sizes:[''],variants=[];
  for(const c of editor.colors){
    if(!c.name.trim())throw new Error('Introduce un nombre para cada color.');
    const allSizes=[...new Set([...columns,...Object.keys(c.variants).filter(size=>c.variants[size].id)])];
    for(const size of allSizes){const v=c.variants[size]||{},off=!!v.off||!columns.includes(size);if(off&&!v.id)continue;variants.push({...(v.id?{id:v.id,sku:v.sku}:{}),color_name:c.name.trim(),color_hex:c.hex,size,active:!off,price_override:v.price_override??null,low_stock:v.low_stock??Number($('#product-form').elements.low_stock.value),image_ids:c.image_ids,...(!editor.product.variants_enabled?{stock:Number(v.stock||0)}:{})});}
  }
  if(!variants.some(v=>v.active))throw new Error('Activa al menos una combinación de color y talla.');
  if(editor.product.id&&!editor.product.variants_enabled){if(editor.product.reserved>0)throw new Error('Espera a que se liberen las reservas antes de distribuir las existencias.');if(variants.reduce((sum,v)=>sum+v.stock,0)!==editor.product.stock)throw new Error('Distribuye exactamente las existencias actuales entre las variaciones.');}
  return variants;
}

function productEditor(p={}){
  state.editPhotoIds=readImageIds(p.images);state.uploading=false;state.variantEditor={product:p,colors:variantEditorColors(p)};
  dialog(p.id?'Editar producto':'Nuevo producto',`<form id="product-form" data-id="${p.id||''}" class="product-editor-form"><section class="product-form-section"><div class="product-section-heading"><span>01</span><div><h3>Información del producto</h3><p>Un mismo modelo y estampa, con todas sus variaciones.</p></div></div><div class="form-grid">${field('name','Nombre',p.name||'','text','required')}${field('sku','SKU',p.sku||'','text','required maxlength="50"')}<label class="field full">Categoría<select name="category" required><option value="">Selecciona una categoría</option>${state.categories.map(c=>`<option value="${escape(c.name)}"${categoryTranslation(c.name)} ${p.category===c.name?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label>${field('price',`Precio (${currencyLabel()})`,((p.price||0)/100).toFixed(2),'number','required min="0.01" step="0.01"')}${field('cost',`Coste (${currencyLabel()})`,((p.cost||0)/100).toFixed(2),'number','required min="0" step="0.01"')}<label class="field full">Descripción<textarea name="description" required maxlength="2000">${escape(p.description||'')}</textarea></label></div></section><section class="product-form-section"><div class="product-section-heading"><span>02</span><div><h3>Colores y tallas</h3><p>Controla cada combinación de forma independiente.</p></div></div>${p.id&&!p.variants_enabled?`<div class="variant-migration-note"><strong>Distribuye las existencias actuales</strong><p>Existencias físicas: <b>${p.stock||0}</b> · Reservadas: <b>${p.reserved||0}</b></p><p>${p.reserved?'Espera a que finalicen o caduquen los pedidos pendientes para continuar.':'Asigna el saldo actual entre colores y tallas antes de guardar.'}</p></div>`:''}<div id="product-size">${sizeField(p.category||'',productSizeValues(p))}</div><div id="variant-editor"></div></section><section class="product-form-section"><div class="product-section-heading"><span>03</span><div><h3>Fotos generales</h3><p>Se muestran cuando el color no tiene fotos propias.</p></div></div><label class="field">Fotos del producto<input id="product-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="form-help">Hasta 8 fotos, con un máximo de 5 MB cada una. JPEG, PNG o WebP.</p><div id="photo-preview" class="photo-gallery">${photoPreview()}</div></section><details class="product-form-section product-extra-settings"><summary>Logística y configuración</summary><div class="form-grid">${field('low_stock','Aviso para nuevas variaciones',p.low_stock??5,'number','required min="0"')}${field('weight','Peso (kg)',p.weight||0.5,'number','required min="0.001" step="0.001"')}${field('width','Anchura (cm)',p.width||20,'number','required min="1" step="0.1"')}${field('height','Altura (cm)',p.height||10,'number','required min="1" step="0.1"')}${field('length','Longitud (cm)',p.length||25,'number','required min="1" step="0.1"')}${field('icon','Símbolo del producto',p.icon||'◇','text','required maxlength="8"')}<input type="hidden" name="color" value="${escape(p.color||'#f0f0f0')}"><label class="field">Estado<select name="active"><option value="true" ${p.active!==0?'selected':''}>Activo</option><option value="false" ${p.active===0?'selected':''}>Inactivo</option></select></label>${state.config.currency==='EUR'?'':fiscalEditor(JSON.parse(p.fiscal||'{}'))}</div></details><div id="product-form-error" class="form-error" role="alert" hidden></div><div class="form-actions product-editor-actions"><button class="btn" type="button" data-action="close">Cancelar</button><button class="btn primary" type="submit" ${p.id&&!p.variants_enabled&&p.reserved>0?'disabled':''}>Guardar producto</button></div></form>`);
  $('#dialog').classList.add('product-editor-dialog');validateProductSizes($('#product-form'));renderVariantMatrix();
}
function stockDialog(p,variantId=null){
  const variants=p.variants||[],variant=variants.find(v=>v.id===variantId);
  if(p.variants_enabled&&!variant){dialog(`Inventario · ${p.name}`,`<p class="form-help">Selecciona la combinación que quieres ajustar.</p>${inventoryVariants(p)}`);return;}
  const entry=variant||p;dialog(`Ajustar inventario · ${p.name}`,`${variant?`<p class="variant-stock-label" translate="no">${escape(variant.color_name)} · ${escape(variant.size||'Única')} · ${escape(variant.sku)}</p>`:''}<p class="muted">Físico: ${entry.stock} · Reservado: ${entry.reserved} · Disponible: ${entry.available}</p><form id="stock-form" data-id="${p.id}" data-variant-id="${variant?.id||''}">${field('delta','Variación en unidades (p. ej., 10 o −2)','','number','required step="1"')}${field('reason','Motivo del ajuste','','text','required minlength="3"')}<p class="form-help">Utiliza un valor positivo para las entradas y negativo para las salidas. Comprueba y registra aquí las devoluciones posteriores a la entrega.</p><div class="form-actions"><button class="btn primary" type="submit">Registrar ajuste</button></div></form>`);
}
function allocationDialog(p){
  dialog(`Distribuir existencias · ${p.name}`,`<div class="variant-migration-note"><strong>${p.unallocated_stock} unidades pendientes de asignar</strong><p>Distribuye el saldo completo entre las combinaciones existentes.</p></div><form id="variant-allocation-form" data-id="${p.id}" data-total="${p.unallocated_stock}">${(p.variants||[]).map(v=>field(v.id,`${v.color_name} · ${v.size||'Única'}`,0,'number','min="0" step="1" required')).join('')}${field('reason','Motivo de la distribución','Distribución de existencias pendientes','text','required minlength="3"')}<div class="form-actions"><button class="btn primary" type="submit">Guardar distribución</button></div></form>`);
}

function userDialog(u=null){dialog(u?'Cambiar permisos':'Nuevo usuario',`<form id="user-form" data-id="${u?.id||''}">${!u?field('name','Nombre','','text','required')+field('email','Correo electrónico','','email','required')+field('password','Contraseña inicial','','password','required minlength="12" maxlength="128"'): `<h3 translate="no">${escape(u.name)}</h3><p class="muted" translate="no">${escape(u.email)}</p>`}<label class="field">Perfil<select name="role">${Object.entries(roleNames).map(([role,label])=>`<option value="${role}" ${u?.role===role?'selected':''}>${label}</option>`).join('')}</select></label>${u?`<label class="field">Estado<select name="active"><option value="true" ${u.active?'selected':''}>Activo</option><option value="false" ${!u.active?'selected':''}>Bloqueado</option></select></label>`:'<p class="form-help">El usuario podrá cambiar la contraseña en Mi cuenta.</p>'}<div class="form-actions"><button class="btn primary" type="submit">Guardar usuario</button></div></form>`);}
const orderMoney=(order,value)=>i18n.money(value,order.currency||state.config?.currency||'BRL');
function transferInstructions(order){
  const transfer=order.bank_transfer;if(!transfer)return '';
  const pending=order.status==='awaiting_payment',test=order.payment_environment==='test';
  return `<section class="bank-transfer-details" aria-label="Datos de transferencia"><h3>Transferencia bancaria · Sabadell</h3>${test?'<p class="checkout-test-note" role="note">Simulación: no realices una transferencia real.</p>':''}<dl><div><dt>Banco</dt><dd translate="no">${escape(transfer.bank)}</dd></div><div><dt>Beneficiario</dt><dd translate="no">${escape(transfer.beneficiary)}</dd></div><div><dt>IBAN</dt><dd><code translate="no">${escape(transfer.iban)}</code></dd></div><div><dt>Referencia del pedido</dt><dd><code translate="no">${escape(transfer.reference)}</code></dd></div><div><dt>Importe exacto</dt><dd>${orderMoney(order,order.total)}</dd></div><div><dt>Plazo de pago</dt><dd>${date(transfer.due_at||order.reserved_until)}</dd></div></dl>${pending?'<p class="form-help">Incluye la referencia exacta del pedido. El pedido seguirá pendiente hasta que la tienda confirme el crédito en su cuenta bancaria.</p>':order.status==='expired'||order.status==='cancelled'?'<p class="danger-note">Este pedido ya no admite el pago. Contacta con la tienda si ya has realizado la transferencia.</p>':''}</section>`;
}
function orderDialog(o,admin=false){
  state.currentOrder={order:o,admin};const a=o.address,isEuro=o.currency==='EUR'||(!o.currency&&euroCheckout()),transfer=o.payment_method==='bank_transfer',stripe=o.payment_method==='stripe';
  const next={paid:['picking','Iniciar preparación'],picking:['ready','Marcar como empaquetado'],ready:['shipped','Registrar envío'],shipped:['delivered','Confirmar entrega']}[o.status];
  const paymentAction=!admin&&o.status==='awaiting_payment'?`${!transfer?`<button class="btn primary" data-action="${!isEuro&&state.config.mode==='demo'?'demo-pay':'pay'}" data-id="${o.id}">${stripe?'Pagar con tarjeta · Stripe ↗':state.config.mode==='demo'?'Simular pago aprobado':'Pagar con Mercado Pago ↗'}</button>`:'<button class="btn" data-action="order" data-id="'+o.id+'">Actualizar estado del pago</button>'}<button class="btn danger" data-action="cancel-order" data-id="${o.id}">Cancelar pedido</button>`:'';
  dialog(`Pedido #${o.number}`,`<div class="detail-heading">${badge(o.status)}<strong>${orderMoney(o,o.total)}</strong></div>${isEuro&&o.payment_environment==='test'?'<p class="checkout-test-note" role="note">PEDIDO DE PRUEBA · Simulación: no realices una transferencia real. Usa tarjetas de prueba.</p>':''}<p translate="no">${escape(o.customer_name)} · ${escape(o.customer_email)}</p><p class="muted"><span translate="no">${escape(a.street)}, ${escape(a.number)} ${escape(a.complement||'')}${a.district?' · '+escape(a.district):''}<br>${escape(a.city)}${a.state?' / '+escape(a.state):''}</span>${isEuro?' · <span>España</span>':''} · <span>Código postal</span> ${literal(a.postal_code)}</p>${isEuro?`<p class="form-help">${transfer?'Transferencia bancaria · Sabadell':stripe?'Tarjeta · Stripe':'Pago en euros'}</p>`:''}<div class="detail-items">${o.items.map(p=>`<div><span translate="no">${p.quantity}× ${escape(p.name)}${variantDescription(p)?`<small class="order-variant">${escape(variantDescription(p))}</small>`:''}</span><strong>${orderMoney(o,p.price*p.quantity)}</strong></div>`).join('')}${o.discount?`<div><span>Cupón ${escape(o.coupon_code)}</span><strong>− ${orderMoney(o,o.discount)}</strong></div>`:''}<div><span>Envío · ${escape(o.shipping_service.name)}</span><strong>${orderMoney(o,o.shipping)}</strong></div></div>${transfer?transferInstructions(o):''}${o.tracking_code?`<p><b>Seguimiento:</b> ${literal(o.tracking_code)} ${o.tracking_url?`<a class="btn small" href="${escape(o.tracking_url)}" target="_blank" rel="noopener noreferrer">Seguir envío ↗</a>`:''}</p>`:''}${o.status==='awaiting_payment'?`<p class="form-help">Reserva válida hasta ${date(o.reserved_until)}.</p>`:''}${o.refunded?`<p class="danger-note">Reembolsado: ${orderMoney(o,o.refunded)}</p>`:''}${!isEuro?invoiceSummary(o.invoice):''}<div class="timeline">${o.events.map(e=>`<div><p>${escape(e.message)}</p><small>${date(e.created_at)}</small></div>`).join('')}</div><div class="detail-actions">${admin&&!isEuro&&has('invoices')?`<button class="btn" data-action="invoice" data-id="${o.id}">${o.invoice?'Gestionar NF-e':'Emitir NF-e'}</button>`:''}${paymentAction}${admin&&transfer&&has('finance')&&o.status==='awaiting_payment'?`<button class="btn primary" data-action="confirm-transfer" data-id="${o.id}">${o.payment_environment==='test'?'Simular confirmación de transferencia':'Confirmar transferencia recibida'}</button>`:''}${admin&&has('shipping')&&next&&o.refunded===0?`<button class="btn" data-action="next-status" data-id="${o.id}" data-status="${next[0]}">${next[1]}</button>`:''}${admin&&!transfer&&has('finance')&&o.payment_status==='approved'?`<button class="btn danger" data-action="refund" data-id="${o.id}">Reembolsar pago</button>`:''}${admin&&has('shipping')&&o.status==='awaiting_payment'?`<button class="btn danger" data-action="admin-cancel" data-id="${o.id}">Cancelar pedido</button>`:''}${admin&&!isEuro&&has('shipping')&&state.config.mode==='live'&&['paid','picking','ready'].includes(o.status)&&!o.refunded?`<button class="btn" data-action="label" data-id="${o.id}">${o.label_id?'Gestionar etiqueta':'Crear etiqueta'}</button>`:''}${admin&&!isEuro&&has('shipping')&&o.label_id?`<button class="btn" data-action="tracking-sync" data-id="${o.id}">Consultar transportista</button>`:''}${admin&&!isEuro&&o.label_url?`<a class="btn" href="${escape(o.label_url)}" target="_blank" rel="noopener noreferrer">Imprimir etiqueta ↗</a>`:''}</div>`);
}
function transferConfirmationDialog(order){
  const test=order.payment_environment==='test';
  dialog(test?'Simular confirmación de transferencia':'Confirmar transferencia recibida',`<p>${test?'Simulación: no realices una transferencia real.':'Comprueba el abono en la cuenta bancaria antes de confirmar el pedido.'}</p><p class="form-help">Importe del pedido: <strong>${orderMoney(order,order.total)}</strong> · <span translate="no">${escape(order.bank_transfer?.reference||'#'+order.number)}</span></p><form id="confirm-transfer-form" data-id="${order.id}">${field('bank_reference',test?'Referencia de la simulación':'Referencia del movimiento bancario','','text','required minlength="3" maxlength="100"')}${field('amount',test?'Importe simulado (€)':'Importe recibido (€)','','number','required min="0.01" step="0.01"')}<label class="eu-confirm"><input type="checkbox" name="confirmed" required><span>${test?'Confirmo que esta operación es una simulación.':'He comprobado el crédito en la cuenta bancaria de la tienda.'}</span></label><div class="form-actions"><button class="btn" type="button" data-action="close">Volver</button><button class="btn primary" type="submit">${test?'Confirmar simulación':'Confirmar crédito recibido'}</button></div></form>`);
}
async function afterOrderAction(o,admin){orderDialog(o,admin);await render();}
document.addEventListener('input',e=>{if(e.target.closest('.variant-color-row')){syncVariantDraft();updateVariantTotal();const row=e.target.closest('.variant-color-row'),name=row.querySelector('.variant-color-name').value||`Color ${[...row.parentElement.children].indexOf(row)+1}`;for(const cell of row.querySelectorAll('.variant-cell')){const label=name+' · '+(cell.dataset.size||'Única');cell.querySelector('.variant-stock-input').setAttribute('aria-label','Existencias '+label);cell.querySelector('.variant-offered').setAttribute('aria-label','Ofrecer '+label);cell.querySelector('.variant-price-input').setAttribute('aria-label','Precio '+label);cell.querySelector('.variant-low-stock-input').setAttribute('aria-label','Aviso '+label);}}if(e.target.form?.id==='product-form'){const error=$('#product-form-error');if(error)error.hidden=true;}if(e.target.form?.id==='eu-shipping-form'&&e.target.name!=='order_reference'&&e.target.name!=='eu_service_id')europeInvalidateQuote(e.target.form);if(e.target.id==='product-search'){state.search=e.target.value;$('#product-grid').innerHTML=productCards();}if(e.target.form?.id==='checkout-form'&&e.target.name==='coupon'){state.coupon=null;$('#coupon-summary').textContent='';$('#checkout-products-total').textContent=money(state.cart.subtotal);updateCheckoutTotal();}
if(e.target.form?.id==='checkout-form'&&(euroCheckout()?checkoutAddressNames.includes(e.target.name):e.target.name==='postal_code'))invalidateCheckoutQuote();});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action,id=el.dataset.id;
  if(action==='open-store-menu'){const menu=$('#store-menu');if(menu&&!menu.open){menu.showModal();document.documentElement.classList.add('store-menu-visible');el.setAttribute('aria-expanded','true');}return;}
  if(action==='close-store-menu'){$('#store-menu')?.close();return;}
  if(action==='play-skate')return playSkateFilm(el);
  if(action==='play-music')return playSkateFilm(el,musicFeatured,'play-music');
  if(action==='music-jump'){e.preventDefault();return jumpMusicSection(el);}
  if(action==='skate-jump'){e.preventDefault();return jumpSkateSection(el);}
  if(action==='skate-rider'){e.preventDefault();jumpSkateSection({dataset:{section:'destacados'}});const button=document.querySelector(`.skate-featured-grid [data-action="play-skate"][data-id="${id}"]`);if(button)playSkateFilm(button);else document.querySelector(`.skate-featured-grid [data-video-id="${id}"] iframe`)?.focus({preventScroll:true});return;}
  if(action==='skate-more'){const expanded=el.getAttribute('aria-expanded')!=='true';document.querySelectorAll('[data-skate-extra]').forEach(item=>{if(!expanded){const frame=item.querySelector('iframe');if(frame){const film=skateArchive.find(f=>f.id===frame.parentElement.dataset.videoId);if(film)frame.parentElement.innerHTML=skatePoster(film);}}item.hidden=!expanded;});el.setAttribute('aria-expanded',String(expanded));el.textContent=expanded?'Ver menos vídeos':'Ver más vídeos';return;}
  el.disabled=true;try{
  if(action==='eu-new'){europeUI.draft={};europeUI.quote=null;europeUI.createKey=null;europeUI.uncertain=false;europeUI.pendingId=null;europeUI.revision++;await render();}
  if(action==='eu-refresh')await europeRefresh();
  if(action==='eu-check'){await api('/admin/europe-shipping/check',{method:'POST'});$('#eu-connection-result').textContent='Conexión y remitente verificados. No se ha contratado ningún envío.';}
  if(action==='eu-create-review')europeReview();
  if(action==='eu-detail')europeDetail(await api(`/admin/europe-shipping/shipments/${encodeURIComponent(id)}`));
  if(action==='eu-sync'){const row=await api(`/admin/europe-shipping/shipments/${encodeURIComponent(id)}/sync`,{method:'POST'});if(id===europeUI.pendingId&&!['unknown','submitting'].includes(row.status)){europeUI.uncertain=false;europeUI.pendingId=null;europeUI.quote=null;europeUI.createKey=null;}await europeRefresh();toast(row.environment==='test'?'Simulación local consultada. Sin envío real.':'Estado del envío actualizado.');}
  if(action==='close')closeDialog();
  if(action==='forgot')forgotDialog();
  if(action==='photo-main'){$('#dialog .product-photo').src=el.dataset.url;}
  if(action==='remove-photo'){state.editPhotoIds.splice(Number(el.dataset.index),1);$('#photo-preview').innerHTML=photoPreview();}
  if(action==='new-coupon')couponDialog();
  if(action==='toggle-coupon'){await api(`/admin/coupons/${el.dataset.code}`,{method:'PATCH',body:{active:el.dataset.active==='true'}});await render();}
  if(action==='apply-coupon'){const code=$('#checkout-form').elements.coupon.value.trim();state.coupon=code?await api('/coupons/check',{method:'POST',body:{code}}):null;$('#coupon-summary').textContent=state.coupon?`Descuento: ${money(state.coupon.discount)} · ${state.coupon.code}`:'';$('#checkout-products-total').textContent=money(state.cart.subtotal-(state.coupon?.discount||0));updateCheckoutTotal();}
  if(action==='invoice'){const order=state.adminOrders.find(o=>o.id===id)||await api('/admin/orders').then(rows=>rows.find(o=>o.id===id));const rows=await api('/admin/invoices');const row=rows.find(i=>i.order_id===id);invoiceDialog(order,row);}
  if(action==='invoice-issue'){state.invoiceOrderId=id;const preview=await api(`/admin/orders/${id}/invoice-preview`);invoiceIssueDialog(id,preview);}
  if(action==='invoice-consult'){const row=await api(`/admin/orders/${id}/invoice`,{method:'POST',body:{action:'consult'}});invoiceDialog(state.invoiceOrder,row);await render();}
  if(action==='invoice-cancel')dialog('Cancelar NF-e',`<p>Se solicitará la cancelación al proveedor fiscal. El reembolso del pago es una operación independiente.</p><form id="invoice-cancel-form" data-id="${id}">${field('reason','Justificación','','text','required minlength="15" maxlength="255"')}<div class="form-actions"><button class="btn danger" type="submit">Confirmar cancelación fiscal</button></div></form>`);
  if(action==='login')authDialog();if(action==='register')authDialog(true);if(action==='account')accountDialog();
  if(action==='collection'){state.category=el.dataset.category;location.hash='catalog';await render();document.querySelector('#catalog')?.scrollIntoView();return;}
  if(action==='logout'){await api('/auth/logout',{method:'POST'});state.user=null;state.csrf=null;state.cart={items:[],subtotal:0};closeDialog();location.hash='store';await render();}
  if(action==='password')dialog('Cambiar contraseña',`<form id="password-form">${field('current_password','Contraseña actual','','password','required autocomplete="current-password"')}${field('password','Nueva contraseña','','password','required minlength="12" maxlength="128" autocomplete="new-password"')}<p class="form-help">Tendrás que volver a iniciar sesión después de guardar.</p><div class="form-actions"><button class="btn primary">Guardar contraseña</button></div></form>`);
  if(action==='categories')categoriesDialog();
  if(action==='delete-product'){
    const product=state.adminProducts.find(p=>p.id===id);if(!product)throw new Error('Producto no encontrado.');
    if(!window.confirm(i18n.t(`¿Eliminar «${product.name}» del catálogo?\nLos pedidos y el historial se conservarán.`)))return;
    await api(`/admin/products/${encodeURIComponent(id)}`,{method:'DELETE'});await render();
    if(!state.adminProducts.some(p=>p.category===state.category))state.category='Todos';
    toast('Producto eliminado.');
  }
  if(action==='delete-category'){
    const form=el.closest('form'),name=form.dataset.previous;
    if(form.dataset.uploading)throw new Error('Espera a que termine la subida.');
    if(!window.confirm(i18n.t(`¿Eliminar la categoría «${name}»?\nPrimero debes mover o eliminar sus productos.`)))return;
    await api('/admin/categories',{method:'DELETE',body:{name}});await render();form.remove();
    if(state.category.toLowerCase()===name.toLowerCase())state.category='Todos';
    toast('Categoría eliminada.');
  }
  if(action==='remove-category-image'){const form=el.closest('form');if(form.dataset.uploading)throw new Error('Espera a que termine la subida.');form.elements.image_id.value='';updateCategoryImagePreview(form);}
  if(action==='filter'){state.category=el.dataset.category;await render();}
  if(action==='product')productDialog(state.products.find(p=>p.id===id));
  if(action==='add'){const product=state.products.find(p=>p.id===id);if(product?.variants_enabled){productDialog(product);return;}if(product&&legacyNeedsAllocation(product))return toast('Este producto estará disponible próximamente.');if(!state.user){authDialog();return;}const p=state.cart.items.find(p=>p.id===id&&!p.variant_id);state.cart=await api(`/cart/${id}`,{method:'PUT',body:{quantity:(p?.quantity||0)+1}});toast('Producto añadido al carrito.');closeDialog();await render();}
  if(action==='choose-color'){const selection=state.productSelection;productDialog(selection.product,{color:el.dataset.color});$('#variant-selection [data-action="choose-color"][aria-pressed="true"]')?.focus({preventScroll:true});}
  if(action==='choose-size'){const selection=state.productSelection;productDialog(selection.product,{color:selection.color,variantId:el.dataset.variantId});$('#variant-selection [data-action="choose-size"][aria-pressed="true"]')?.focus({preventScroll:true});}
  if(action==='add-selected'){const selection=state.productSelection,variant=activeVariants(selection.product).find(v=>v.id===selection.variantId);if(!variant)throw new Error('Selecciona un color y una talla.');if(!state.user){authDialog();return;}const existing=state.cart.items.find(p=>p.id===id&&p.variant_id===variant.id);state.cart=await api(`/cart/${id}`,{method:'PUT',body:{variant_id:variant.id,quantity:(existing?.quantity||0)+1}});toast('Producto añadido al carrito.');closeDialog();await render();}
  if(action==='add-variant-color'){syncVariantDraft();state.variantEditor.colors.push({key:crypto.randomUUID(),name:'',hex:'#111111',image_ids:[],variants:{}});renderVariantMatrix();const inputs=document.querySelectorAll('.variant-color-name');inputs[inputs.length-1]?.focus();}
  if(action==='remove-variant-color'){syncVariantDraft();const c=state.variantEditor.colors.find(c=>c.key===el.dataset.colorKey);if(Object.values(c.variants).some(v=>v.stock>0||v.reserved>0))throw new Error('Ajusta las existencias a cero antes de eliminar este color.');state.variantEditor.colors=state.variantEditor.colors.filter(c=>c.key!==el.dataset.colorKey);renderVariantMatrix();}
  if(action==='remove-variant-photo'){syncVariantDraft();state.variantEditor.colors.find(c=>c.key===el.dataset.colorKey).image_ids.splice(Number(el.dataset.index),1);renderVariantMatrix();}
  if(action==='allocate-variants')allocationDialog(state.adminProducts.find(p=>p.id===id));
  if(['quantity','remove'].includes(action)){const variantId=el.dataset.variantId||null,p=state.cart.items.find(p=>p.id===id&&(p.variant_id||null)===variantId);if(!p)throw new Error('Actualiza el carrito e inténtalo de nuevo.');state.cart=await api(`/cart/${id}`,{method:'PUT',body:{quantity:action==='remove'?0:p.quantity+Number(el.dataset.delta),...(variantId?{variant_id:variantId}:{})}});await render();}
  if(action==='checkout')checkoutDialog();
  if(action==='quote'){
    const form=$('#checkout-form');if(euroCheckout()&&!form.reportValidity())return;
    invalidateCheckoutQuote();const revision=state.checkoutQuoteRevision;
    $('#quote-results').innerHTML='<p class="form-help">Consultando tarifas…</p>';
    const body=euroCheckout()?{address:checkoutAddress(form)}:{postal_code:form.elements.postal_code.value};
    let quote;try{quote=await api('/shipping/quote',{method:'POST',body});}catch(error){if(form.isConnected&&revision===state.checkoutQuoteRevision)$('#quote-results').innerHTML=`<p class="danger-note" role="alert">${escape(error.message)}</p>`;throw error;}
    if(!form.isConnected||revision!==state.checkoutQuoteRevision)return;
    state.quote=quote;$('#quote-results').innerHTML=quote.options.map((q,i)=>`<label class="shipping-choice"><input type="radio" name="service_id" value="${escape(q.id)}" ${i===0?'checked':''} required><span>${escape(q.name)}${q.days!==null&&q.days!==undefined?`<br><small class="muted">Estimación de ${escape(q.days)} días laborables</small>`:''}</span><strong>${money(q.price)}</strong></label>`).join('');$('#place-order').disabled=!quote.options.length;updateCheckoutTotal();
  }
  if(action==='order')orderDialog(await api(`/orders/${id}`));
  if(action==='admin-order')orderDialog(state.adminOrders.find(o=>o.id===id)||await api('/admin/orders').then(rows=>rows.find(o=>o.id===id)),true);
  if(action==='confirm-transfer')transferConfirmationDialog(state.currentOrder.order);
  if(action==='demo-pay')await afterOrderAction(await api(`/orders/${id}/demo-pay`,{method:'POST'}),false);
  if(action==='pay'){const o=await api(`/orders/${id}/payment`,{method:'POST'});if(o.payment_url)location.assign(o.payment_url);}
  if(action==='cancel-order'){const o=await api(`/orders/${id}/cancel`,{method:'POST'});await afterOrderAction(o,false);}
  if(action==='admin-cancel')await afterOrderAction(await api(`/admin/orders/${id}/cancel`,{method:'POST'}),true);
  if(action==='next-status'){if(el.dataset.status==='shipped')dialog('Registrar envío',`<form id="shipping-form" data-id="${id}">${field('tracking_code','Código de seguimiento','','text','required minlength="3"')}${field('tracking_url','Enlace de seguimiento (opcional)','','url')}<div class="form-actions"><button class="btn primary">Confirmar envío</button></div></form>`);else await afterOrderAction(await api(`/admin/orders/${id}/status`,{method:'POST',body:{status:el.dataset.status}}),true);}
  if(action==='refund'){
    const order=state.currentOrder.order,stripe=order.payment_method==='stripe',test=stripe?order.payment_environment==='test':state.config.mode!=='live';
    dialog('Reembolsar pago',`<p>¿Confirmas el reembolso íntegro de este pedido?</p><p>${test?'Este reembolso será simulado.':stripe?'Esta acción solicita un reembolso real a Stripe.':'Esta acción solicita un reembolso real a Mercado Pago.'}</p><p class="form-help">Las existencias solo se reponen automáticamente antes del envío. Si la mercancía ya se ha enviado, comprueba la devolución y registra la entrada en Inventario.</p><form id="refund-form" data-id="${id}"><div class="form-actions"><button type="button" class="btn" data-action="close">Volver</button><button class="btn danger">Confirmar reembolso íntegro</button></div></form>`);
  }
  if(action==='label'){const o=state.currentOrder.order;dialog('Etiqueta de envío',o.label_id?`<p>Etiqueta: ${escape(o.label_id)}</p><p class="form-help">La compra del envío utiliza el saldo de la cuenta de Melhor Envio. Si se produce un error o la respuesta es incierta, consulta el panel antes de repetir la operación.</p><div class="form-actions"><button class="btn" data-action="label-buy-confirm" data-id="${id}">Comprar envío</button><button class="btn primary" data-action="label-print" data-id="${id}">Generar e imprimir</button></div>`:`<form id="label-form" data-id="${id}">${field('invoice_key','Clave de la NF-e (44 dígitos)','','text','required pattern="[0-9]{44}" maxlength="44"')}<p class="form-help">La NF-e debe emitirse en tu sistema fiscal. Este sistema no emite facturas.</p><div class="form-actions"><button class="btn primary">Crear etiqueta en Melhor Envio</button></div></form>`);}
  if(action==='label-buy-confirm')dialog('Confirmar compra del envío',`<p>Esta acción utiliza el saldo de tu cuenta de Melhor Envio para comprar el envío.</p><form id="label-buy-form" data-id="${id}"><div class="form-actions"><button class="btn primary">Confirmar compra</button></div></form>`);
  if(action==='label-print')await afterOrderAction(await api(`/admin/orders/${id}/label`,{method:'POST',body:{action:'print'}}),true);
  if(action==='tracking-sync'){const result=await api(`/admin/orders/${id}/tracking`,{method:'POST'});await afterOrderAction(result.order,true);toast(result.tracking.label);}
  if(action==='new-product')productEditor();if(action==='edit-product')productEditor(state.adminProducts.find(p=>p.id===id));if(action==='adjust-stock')stockDialog(state.adminProducts.find(p=>p.id===id),el.dataset.variantId);
  if(action==='new-user')userDialog();if(action==='edit-user')userDialog(state.users.find(u=>u.id===id));
  if(action==='expense'){state.expenseKey=crypto.randomUUID();dialog('Registrar gasto',`<form id="expense-form">${field('description','Descripción','','text','required minlength="3"')}${field('amount',`Importe (${currencyLabel()})`,'','number','required min="0.01" step="0.01"')}<div class="form-actions"><button class="btn primary">Registrar gasto</button></div></form>`);}
  if(action==='export-finance'){const cell=v=>`"${String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'")}"`;const csv=`\uFEFFFecha;Descripción;Tipo;Importe (${currencyLabel()})\n`+state.ledger.map(r=>[r.created_at,r.description,ledgerTypes[r.type]||r.type,(r.amount/100).toFixed(2)].map(cell).join(';')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download='edg-finanzas.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(action==='order-filter'){document.querySelectorAll('.filter').forEach(f=>f.classList.remove('active'));el.classList.add('active');const shipping=el.dataset.shipping==='true',s=el.dataset.status;const rows=state.adminOrders.filter(o=>(s==='Todos'||o.status===s)&&(!shipping||['paid','picking','ready','shipped','delivered'].includes(o.status)));$('#orders-table').innerHTML=orderTable(rows,shipping);}
  if(action==='refresh')await render();
}catch(error){toast(error.message,true);}finally{el.disabled=false;}});
document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,btn=form.querySelector('[type="submit"]')||form.querySelector('button:last-child');if(btn)btn.disabled=true;const data=Object.fromEntries(new FormData(form));try{
  if(form.id==='eu-shipping-form'){if(europePending())throw new Error('Consulta y concilia el envío pendiente antes de crear otro.');europeUI.draft=data;const revision=++europeUI.revision;europeUI.quote=null;europeUI.createKey=null;$('#eu-quote-results').innerHTML='<p class="form-help">Consultando tarifas…</p>';let quote;try{quote=await api('/admin/europe-shipping/quote',{method:'POST',body:europeQuotePayload(data)});}catch(error){if(revision===europeUI.revision&&form.isConnected)$('#eu-quote-results').innerHTML=`<p class="danger-note" role="alert">${escape(error.message)}</p>`;throw error;}if(revision===europeUI.revision&&form.isConnected){europeUI.quote=quote;europeUI.createKey=crypto.randomUUID();$('#eu-quote-results').innerHTML=europeQuoteResults();}}
  if(form.id==='eu-create-form'){const quote=europeUI.quote;if(!quote||Date.parse(quote.expires_at)<=Date.now())throw new Error('La tarifa ha caducado. Consulta las tarifas de nuevo.');if(europePending())throw new Error('Consulta y concilia el envío pendiente antes de crear otro.');europeUI.createKey||=crypto.randomUUID();let row;try{row=await api('/admin/europe-shipping/shipments',{method:'POST',headers:{'Idempotency-Key':europeUI.createKey},body:{quote_id:quote.id,service_id:form.dataset.serviceId,order_reference:europeUI.draft.order_reference||undefined,confirm_live:data.confirm_live==='on'}});}catch(error){europeUI.uncertain=!(error.status>=400&&error.status<500);closeDialog();await europeRefresh();const stored=europeUI.rows.find(item=>item.quote_id===quote.id);europeUI.pendingId=stored&&['unknown','submitting'].includes(stored.status)?stored.id:null;if(!europeUI.uncertain||stored?.status==='rejected'){europeUI.uncertain=false;europeUI.quote=null;europeUI.createKey=null;await render();}throw new Error(error.message+(europeUI.uncertain?' Consulta el historial antes de repetir la operación.':''));}if(['unknown','submitting'].includes(row.status)){europeUI.pendingId=row.id;}else{europeUI.quote=null;europeUI.createKey=null;}closeDialog();await europeRefresh();toast(row.status==='unknown'?'Resultado incierto. Consulta y concilia el envío antes de repetir.':row.status==='rejected'?'Solicitud rechazada. Revisa los datos antes de preparar otro envío.':row.environment==='test'?'Simulación local guardada. Sin etiqueta real ni franqueo.':'Solicitud de envío guardada. Consulta su estado y etiqueta.');}
  if(form.id==='forgot-form'){const r=await api('/auth/forgot-password',{method:'POST',body:{email:data.email}});dialog('Consulta tu correo electrónico',`<p>${escape(r.message)}</p>${state.config.mode==='demo'?'<p class="form-help">En la demostración, el administrador puede consultar el mensaje en el panel de Correos electrónicos.</p>':''}`);}
  if(form.id==='reset-form'){await api('/auth/reset-password',{method:'POST',body:{token:form.dataset.token,password:data.password}});state.user=null;state.csrf=null;state.cart={items:[],subtotal:0};location.hash='store';await render();authDialog();toast('Contraseña actualizada. Vuelve a iniciar sesión.');}
  if(form.id==='coupon-form'){const p={...data,value:data.type==='percent'?Math.round(Number(data.value)*100):Math.round(Number(data.value)*100),min_subtotal:Math.round(Number(data.min_subtotal)*100),max_discount:data.max_discount?Math.round(Number(data.max_discount)*100):null,max_uses:Number(data.max_uses),per_user_limit:Number(data.per_user_limit),starts_at:new Date(data.starts_at).toISOString(),ends_at:new Date(data.ends_at).toISOString(),active:true};await api('/admin/coupons',{method:'POST',body:p});closeDialog();await render();toast('Cupón creado.');}
  if(form.id==='invoice-emit-form'){const row=await api(`/admin/orders/${form.dataset.id}/invoice`,{method:'POST',body:{action:'emit',fiscal:{items:Array.from({length:Number(data.item_count)},(_,i)=>readFiscal(data,`item_${i}_`)),payment:{...JSON.parse(data.payment_extra||'{}'),forma_pagamento:data.payment_type}}}});invoiceDialog(state.invoiceOrder,row);await render();}
  if(form.id==='invoice-cancel-form'){const row=await api(`/admin/orders/${form.dataset.id}/invoice`,{method:'POST',body:{action:'cancel',reason:data.reason}});invoiceDialog(state.invoiceOrder,row);await render();}
  if(form.id==='auth-form'){const register=form.dataset.register==='true',result=await api(`/auth/${register?'register':'login'}`,{method:'POST',body:data});state.user=result.user;state.csrf=result.csrf;closeDialog();location.hash=has('dashboard')?'admin':'store';await render();toast(register?'Tu cuenta se ha creado.':'Has iniciado sesión.');}
  if(form.id==='checkout-form'){
    if(!state.quote)throw new Error('Calcula el envío antes de confirmar.');
    const {service_id,coupon,payment_method,...rawAddress}=data,address=euroCheckout()?checkoutAddress(form):rawAddress;
    const order=await api('/checkout',{method:'POST',headers:{'Idempotency-Key':state.checkoutKey},body:{quote_id:state.quote.id,service_id,address,coupon:coupon||null,...(euroCheckout()?{payment_method}:{})}});
    location.hash='orders';await render();orderDialog(order);
    if(order.payment_url&&(order.payment_method==='stripe'||state.config.mode==='live'))location.assign(order.payment_url);
  }
  if(form.id==='confirm-transfer-form')await afterOrderAction(await api(`/admin/orders/${form.dataset.id}/confirm-transfer`,{method:'POST',body:{bank_reference:data.bank_reference,amount:Math.round(Number(data.amount)*100),confirmed:data.confirmed==='on'}}),true);
  if(form.id==='category-form'||form.classList.contains('category-edit-form')){if(form.dataset.uploading)throw new Error('Espera a que termine la subida.');if(!form.dataset.previous&&state.categories.some(c=>c.name.toLowerCase()===data.name.trim().toLowerCase()))throw new Error('Categoría ya registrada. Edita la categoría existente.');const saved=await api('/admin/categories',{method:'POST',body:{name:data.name,image_id:data.image_id||null,...(form.dataset.previous?{previous:form.dataset.previous}:{})}});await render();if(form.isConnected){if(form.id==='category-form'){form.reset();updateCategoryImagePreview(form);$('#category-list').insertAdjacentHTML('beforeend',categoryEditForm(saved));}else{form.dataset.previous=saved.name;form.elements.name.value=saved.name;form.elements.image_id.value=saved.image_id||'';updateCategoryImagePreview(form);}const list=$('#category-list');for(const category of state.categories){const editor=[...list.children].find(editor=>editor.dataset.previous===category.name);if(editor)list.append(editor);}}toast('Categoría guardada.');}
  if(form.id==='product-form'){if(state.uploading)throw new Error('Espera a que se suban las fotos.');if(!validateProductSizes(form)){form.reportValidity();return;}const p={...data,sizes:readProductSizes(form),variants:readProductVariants(),images:state.editPhotoIds,fiscal:readFiscal(data),price:Math.round(Number(data.price)*100),cost:Math.round(Number(data.cost)*100),active:data.active==='true'};delete p.sizes_text;delete p.size;for(const k of ['low_stock','weight','width','height','length'])p[k]=Number(data[k]);await api(`/admin/products${form.dataset.id?'/'+form.dataset.id:''}`,{method:form.dataset.id?'PUT':'POST',body:p});closeDialog();await render();toast('Producto guardado.');}
  if(form.id==='stock-form'){await api(`/admin/products/${form.dataset.id}${form.dataset.variantId?'/variants/'+form.dataset.variantId:''}/stock`,{method:'POST',body:{delta:Number(data.delta),reason:data.reason}});closeDialog();await render();toast('Inventario actualizado.');}
  if(form.id==='variant-allocation-form'){const allocations=Object.entries(data).filter(([key])=>key!=='reason').map(([variant_id,quantity])=>({variant_id,quantity:Number(quantity)}));if(allocations.reduce((sum,v)=>sum+v.quantity,0)!==Number(form.dataset.total))throw new Error('Distribuye exactamente las existencias pendientes.');await api(`/admin/products/${form.dataset.id}/variants/allocate`,{method:'POST',body:{allocations,reason:data.reason}});closeDialog();await render();toast('Existencias distribuidas.');}
  if(form.id==='user-form'){await api(`/admin/users${form.dataset.id?'/'+form.dataset.id:''}`,{method:form.dataset.id?'PATCH':'POST',body:{...data,active:data.active==='true'}});closeDialog();await render();toast('Acceso actualizado.');}
  if(form.id==='expense-form'){await api('/admin/expenses',{method:'POST',headers:{'Idempotency-Key':state.expenseKey},body:{description:data.description,amount:Math.round(Number(data.amount)*100)}});closeDialog();await render();toast('Gasto registrado.');}
  if(form.id==='shipping-form')await afterOrderAction(await api(`/admin/orders/${form.dataset.id}/status`,{method:'POST',body:{status:'shipped',...data}}),true);
  if(form.id==='refund-form')await afterOrderAction(await api(`/admin/orders/${form.dataset.id}/refund`,{method:'POST'}),true);
  if(['label-form','label-buy-form'].includes(form.id))await afterOrderAction(await api(`/admin/orders/${form.dataset.id}/label`,{method:'POST',body:{action:form.id==='label-form'?'create':'buy',...data}}),true);
  if(form.id==='password-form'){await api('/auth/password',{method:'POST',body:data});state.user=null;state.csrf=null;state.cart={items:[],subtotal:0};location.hash='store';authDialog();await render();toast('Contraseña actualizada. Vuelve a iniciar sesión.');}
}catch(error){if(form.id==='product-form'){const output=$('#product-form-error');if(output){output.hidden=false;output.textContent=error.message;output.scrollIntoView({block:'nearest',behavior:'smooth'});}}toast(error.message,true);}finally{if(btn)btn.disabled=false;}});
window.addEventListener('hashchange',()=>{if(location.hash!=='#catalog')closeDialog();render({scrollToCatalog:location.hash==='#catalog'});});
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeDialog();}});
(async()=>{try{state.config=await api('/config');i18n.initialize(state.config);const auth=await api('/auth/me');state.user=auth.user;state.csrf=auth.csrf;await render();}catch(e){$('#app').innerHTML=empty('No se ha podido iniciar la tienda',e.message);}})();
function photoPreview(){return(state.editPhotoIds||[]).map((id,index)=>`<div class="photo-thumb"><img src="/media/${id}.jpg" alt="Foto ${index+1}"><button type="button" data-action="remove-photo" data-index="${index}" aria-label="Eliminar foto ${index+1}">×</button></div>`).join('');}
document.addEventListener('change',async e=>{
  if(e.target.form?.id==='checkout-form'&&e.target.name==='service_id'){updateCheckoutTotal();return;}
  if(e.target.form?.id==='eu-shipping-form'&&e.target.tagName==='SELECT'){europeInvalidateQuote(e.target.form);return;}
  if(e.target.matches('.category-image-input')){
    const input=e.target,form=input.form,file=input.files[0];if(!file)return;
    const controls=[...form.querySelectorAll('button,input')];const disabled=controls.map(control=>control.disabled);form.dataset.uploading='true';controls.forEach(control=>control.disabled=true);
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Elige una imagen JPEG, PNG o WebP.');
      if(file.size>5*1024*1024)throw new Error('La imagen debe tener un máximo de 5 MB.');
      const prepared=await preparePhoto(file);
      const response=await fetch('/api/admin/media',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg','X-CSRF-Token':state.csrf},body:prepared});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'No se ha podido subir la imagen.');
      if(!form.isConnected)return;
      form.elements.image_id.value=result.id;updateCategoryImagePreview(form);toast('Imagen lista. Guarda la categoría para aplicarla.');
    }catch(error){toast(error.message,true);}finally{delete form.dataset.uploading;controls.forEach((control,index)=>control.disabled=disabled[index]);input.value='';}
    return;
  }
  if(e.target.matches('#product-form [name=category]')){syncVariantDraft();const form=e.target.form,allowed=state.categories.find(c=>c.name===e.target.value)?.sizes||[],selected=readProductSizes(form).filter(size=>allowed.includes(size));$('#product-size').innerHTML=sizeField(e.target.value,selected);validateProductSizes(form);renderVariantMatrix();return;}
  if(e.target.matches('#product-form input[name=sizes],#product-form input[name=sizes_text]')){syncVariantDraft();validateProductSizes(e.target.form);renderVariantMatrix();return;}
  if(e.target.matches('.variant-offered')){const cell=e.target.closest('.variant-cell'),stock=cell.querySelector('.variant-stock-input'),price=cell.querySelector('.variant-price-input');stock.disabled=price.disabled=!e.target.checked;syncVariantDraft();updateVariantTotal();return;}
  if(e.target.matches('.variant-photo-input')){const input=e.target,editor=$('#product-form'),color=state.variantEditor.colors.find(c=>c.key===input.dataset.colorKey),files=[...input.files];if(files.length+color.image_ids.length>8){toast('Utiliza un máximo de ocho fotos por color.',true);input.value='';return;}state.uploading=true;const submit=editor.querySelector('button[type="submit"]');submit.disabled=true;try{for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Elige una imagen JPEG, PNG o WebP.');if(file.size>5*1024*1024)throw new Error('Cada foto debe tener un máximo de 5 MB.');const prepared=await preparePhoto(file),r=await fetch('/api/admin/media',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg','X-CSRF-Token':state.csrf},body:prepared}),result=await r.json();if(!r.ok)throw new Error(result.error);if(!editor.isConnected)return;color.image_ids.push(result.id);}syncVariantDraft();renderVariantMatrix();toast('Fotos del color listas. Guarda el producto para aplicarlas.');}catch(error){toast(error.message,true);}finally{if(editor.isConnected){state.uploading=false;submit.disabled=false;}input.value='';}return;}
  if(e.target.id!=='product-photos')return;
  const files=[...e.target.files];if(files.length+state.editPhotoIds.length>8){toast('Utiliza un máximo de ocho fotos por producto.',true);e.target.value='';return;}
  const editor=$('#product-form'),ids=state.editPhotoIds;state.uploading=true;const submit=editor.querySelector('button[type="submit"]');submit.disabled=true;
  try{for(const file of files){if(file.size>5*1024*1024)throw new Error('Cada foto debe tener un máximo de 5 MB.');const prepared=await preparePhoto(file);const r=await fetch('/api/admin/media',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg','X-CSRF-Token':state.csrf},body:prepared});const result=await r.json();if(!r.ok)throw new Error(result.error);if(!editor.isConnected)return;ids.push(result.id);$('#photo-preview').innerHTML=photoPreview();}toast('Fotos subidas. Guarda el producto para aplicar los cambios.');}catch(error){toast(error.message,true);}finally{if(editor.isConnected){state.uploading=false;submit.disabled=false;}e.target.value='';}
});
function forgotDialog(){dialog('Recuperar contraseña',`<p>Introduce el correo electrónico de tu cuenta para recibir un enlace de recuperación.</p><form id="forgot-form">${field('email','Correo electrónico','','email','required autocomplete="email"')}<div class="form-actions"><button class="btn primary" type="submit">Enviar enlace de recuperación</button></div></form>`);}
function couponsPage(rows){return adminShell('coupons',`${title('Cupones de descuento','Vigencia, límites y descuentos calculados en el servidor.','<button class="btn primary" data-action="new-coupon">+ Nuevo cupón</button>')}<div class="note">El descuento solo se aplica a los productos. Los usos se reservan al finalizar la compra y se confirman tras el pago. La cancelación y el vencimiento liberan la reserva.</div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Descuento</th><th>Vigencia</th><th>Usos / reservas</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><strong translate="no">${escape(c.code)}</strong><small>${c.active?'Activo':'Inactivo'}</small></td><td>${c.type==='percent'?`${c.value/100}%`:money(c.value)}<small>Mínimo ${money(c.min_subtotal)}</small></td><td>${date(c.starts_at)}<small>Hasta ${date(c.ends_at)}</small></td><td>${c.used||0} / ${c.reserved||0}<small>Límite total: ${c.max_uses} · Por cliente: ${c.per_user_limit}</small></td><td><button class="btn small" data-action="toggle-coupon" data-code="${escape(c.code)}" data-active="${!c.active}">${c.active?'Desactivar':'Activar'}</button></td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('Crea tu primer cupón'):''}</section>`);}
function couponDialog(){const local=v=>new Date(v.getTime()-v.getTimezoneOffset()*60000).toISOString().slice(0,16);dialog('Nuevo cupón',`<form id="coupon-form"><div class="form-grid">${field('code','Código','','text','required minlength="3" maxlength="40" pattern="[A-Za-z0-9_-]+"')}<label class="field">Tipo<select name="type"><option value="percent">Porcentaje (%)</option><option value="fixed">Importe fijo (${currencyLabel()})</option></select></label>${field('value',`Descuento (% o ${currencyLabel()})`,'','number','required min="0.01" step="0.01"')}${field('min_subtotal',`Subtotal mínimo (${currencyLabel()})`,'0','number','required min="0" step="0.01"')}${field('max_discount',`Descuento máximo (${currencyLabel()}, opcional)`,'','number','min="0.01" step="0.01"')}${field('max_uses','Límite total de usos','100','number','required min="1"')}${field('per_user_limit','Límite por cliente','1','number','required min="1"')}${field('starts_at','Fecha de inicio',local(new Date()),'datetime-local','required')}${field('ends_at','Fin',local(new Date(Date.now()+30*86400000)),'datetime-local','required')}</div><div class="form-actions"><button class="btn primary" type="submit">Crear cupón</button></div></form>`);}
const invoiceEnvironments={demo:'Simulación',homologation:'Homologación',production:'Producción'};
const invoiceStatus={authorized:'Autorizada',processing:'En proceso',submitting:'Enviando',unknown:'Consultar proveedor',not_found:'No encontrada',rejected:'Rechazada',cancelled:'Cancelada'};
function invoiceSummary(row){if(!row)return'';return`<div class="note"><strong>NF-e ${escape(row.number||'')} · ${invoiceStatus[row.status]||row.status}</strong><p>${row.environment==='demo'?'SIMULACIÓN · sin validez fiscal':row.environment==='homologation'?'HOMOLOGACIÓN · sin validez fiscal':'Producción'}</p>${row.pdf_url?`<a class="btn small" href="/api/orders/${row.order_id}/invoice/pdf" target="_blank" rel="noopener">DANFE ↓</a>`:''} ${row.xml_url?`<a class="btn small" href="/api/orders/${row.order_id}/invoice/xml" target="_blank" rel="noopener">XML ↓</a>`:''}</div>`;}
function invoicesPage(rows){return adminShell('invoices',`${title('Facturas','Emisión, autorización, documentos y cancelación vinculados al pedido.')}<div class="note">Entorno fiscal: ${state.config.fiscal_environment==='production'?'Producción':state.config.fiscal_environment==='demo'?'Simulación sin validez fiscal':'Homologación sin validez fiscal'}. Para emitir, abre un pedido pagado antes del envío.</div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Factura / serie</th><th>Estado</th><th>Entorno</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>#${r.order_number}</td><td translate="no">${escape(r.customer_name)}</td><td translate="no">${escape(r.number||'—')} / ${escape(r.series||'—')}</td><td>${invoiceStatus[r.status]||r.status}</td><td>${escape(invoiceEnvironments[r.environment]||r.environment)}</td><td><button class="btn small" data-action="invoice" data-id="${r.order_id}">Gestionar</button></td></tr>`).join('')}</tbody></table></div>${!rows.length?empty('No se ha emitido ninguna factura'):''}</section>`);}
function invoiceDialog(order,row){state.invoiceOrder=order;dialog(`NF-e · Pedido #${order.number}`,`${row?invoiceSummary(row)+`<p class="muted">${escape(row.message||'')}</p><p class="form-help">Referencia: ${escape(row.ref)}</p>`:'<p>La emisión utilizará los artículos, el descuento y el envío registrados en este pedido.</p>'}<div class="form-actions">${!row||['rejected','not_found'].includes(row.status)?`<button class="btn primary" data-action="invoice-issue" data-id="${order.id}">Revisar y emitir NF-e</button>`:''}${row?`<button class="btn" data-action="invoice-consult" data-id="${order.id}">Consultar estado</button>`:''}${row?.status==='authorized'?`<button class="btn danger" data-action="invoice-cancel" data-id="${order.id}">Cancelar NF-e</button>`:''}</div>`);}
function invoiceIssueDialog(id,preview){dialog('Revisar emisión de NF-e',`<p>${state.config.fiscal_environment==='demo'?'Esta operación es una simulación, sin validez fiscal.':state.config.fiscal_environment==='homologation'?'Emisión en homologación, sin validez fiscal.':'Esta operación enviará una NF-e de producción para su autorización.'}</p>${preview.error?`<p class="danger-note">${escape(preview.error)}</p>`:''}<form id="invoice-emit-form" data-id="${id}">${preview.items.map((item,index)=>`<fieldset class="fiscal-item"><legend translate="no">${escape(item.name)}</legend><div class="form-grid">${fiscalEditor(item.fiscal,`item_${index}_`)}</div></fieldset>`).join('')}<input type="hidden" name="item_count" value="${preview.items.length}">${field('payment_type','Código fiscal del método de pago',preview.payment?.forma_pagamento||'','text',state.config.fiscal_environment==='demo'?'maxlength="2"':'required pattern="[0-9]{2}" maxlength="2"')}<p class="form-help">Comprueba el método de pago recibido (p. ej., 03 crédito, 04 débito, 15 boleto, 17 PIX dinámico, 18 monedero digital).</p><label class="field">Datos complementarios del pago (avanzado)<textarea name="payment_extra" class="code-field">${escape(JSON.stringify(Object.fromEntries(Object.entries(preview.payment||{}).filter(([k])=>!['forma_pagamento','valor_pagamento'].includes(k))),null,2))}</textarea></label><p class="form-help">Revisa el NCM, CFOP y los impuestos con el asesor contable. Las cantidades, precios, descuento y envío proceden del pedido.</p>${preview.payload&&!preview.payload.demo?`<details><summary>Consultar los datos completos de la factura</summary><pre>${escape(JSON.stringify(preview.payload,null,2))}</pre></details>`:''}<div class="form-actions"><button class="btn primary" type="submit">Confirmar emisión</button></div></form>`);}
function emailsPage(rows){return adminShell('emails',`${title('Correos de recuperación','Consulta la cola y los intentos de envío.')}<div class="note">${state.config.mode==='demo'?'En la demostración, los mensajes aparecen aquí y no se envían.':'Los mensajes se procesan cada minuto, con un máximo de cinco intentos. El contenido y los enlaces no se muestran en producción.'}</div><section class="panel">${rows.length?rows.map(r=>`<article class="email-row"><strong translate="no">${escape(r.subject)}</strong><p class="muted">${literal(r.recipient)} · <span>${r.sent_at?'Enviado':r.attempts>=5?'Error definitivo':'En cola'}</span> · <span>Intentos: ${r.attempts}</span></p>${r.last_error?`<p class="danger-note">${escape(r.last_error)}</p>`:''}${r.preview?`<pre>${escape(r.preview)}</pre>`:''}</article>`).join(''):empty('No hay correos en cola')}</section>`);}
const fiscalInputs=[['codigo_ncm','NCM (8 dígitos)'],['cfop','CFOP (4 dígitos)'],['unidade_comercial','Unidad comercial'],['icms_origem','Origen de la mercancía'],['icms_situacao_tributaria','Situación tributaria ICMS / CSOSN'],['pis_situacao_tributaria','Situación tributaria PIS'],['cofins_situacao_tributaria','Situación tributaria COFINS']];
function fiscalEditor(f,prefix=''){const extras=Object.fromEntries(Object.entries(f).filter(([k])=>!fiscalInputs.some(([key])=>key===k)));return`<div class="field full"><strong>Datos fiscales</strong><span class="muted">Configura los datos siguiendo las indicaciones del asesor contable.</span></div>${fiscalInputs.map(([key,label])=>field(prefix+key,label,f[key]??'','text',key==='codigo_ncm'?'maxlength="8"':key==='cfop'?'maxlength="4"':'')).join('')}<label class="field full">Campos tributarios adicionales (avanzado)<textarea name="${prefix}fiscal_extra" class="code-field">${escape(JSON.stringify(extras,null,2))}</textarea></label>`;}
function readFiscal(data,prefix=''){const value=JSON.parse(data[prefix+'fiscal_extra']||'{}');for(const [key] of fiscalInputs){const input=data[prefix+key];if(input?.trim())value[key]=input.trim();else delete value[key];}return value;}

async function preparePhoto(file){
  const bitmap=await createImageBitmap(file);
  try{const scale=Math.min(1,1280/bitmap.width,1280/bitmap.height),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext("2d");context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Imagen no válida.")),"image/jpeg",0.85));}finally{bitmap.close();}
}
