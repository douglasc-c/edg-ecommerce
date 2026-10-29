// Curated public editorial content. See SKATE.md for sources and update instructions.
const skateChannel='https://www.youtube.com/@EDGSKATEBOARDS';
const skateFeatured=[
  {id:'5cABW1VGMCE',title:'Luis Viloria - Welcome to EDG',source:'DogwayMagazine',description:'Luis Viloria se une a EDG. Su clip de bienvenida, filmado por Luis Beltran.'},
  {id:'KDz0vLjBz_4',title:'EDG - Jorge dos Santos',source:'Black Media Skate',description:'Jorge dos Santos, parte del equipo EDG. Identidad y skate en primera persona.'},
];
const skateArchive=[
  {id:'d3qRBNEysBw',title:'EDG Tour Santa Catarina 2025',source:'EDG Skateboards',date:'2025',category:'Tour'},
  {id:'C9DC8i1IRzE',title:'OBRIGADO SKATEBOARD (LETRA OFICIAL) 2025',source:'EDG Skateboards',date:'2025',category:'Música'},
  {id:'PhqZmQqlkWw',title:'EDG Jeru the Damaja Artifacts MARULA CAFE BARCELONA',source:'EDG Skateboards',date:'2025',category:'Cultura'},
  {id:'EPr8gTxzZRY',title:'Pop Tha Box · Dani Jenks vs Adriel Parmisano (FINAL)',source:'EDG Skateboards',date:'2024',category:'Game of Skate'},
  {id:'jFNoJ_lnTgA',title:'Pop Tha Box · Erick Borges vs Brian Rozniski (Third place battle)',source:'EDG Skateboards',date:'2024',category:'Game of Skate'},
  {id:'pPkbqw8Sb5M',title:'Pop Tha Box · Brian Rozniski vs Adriel Parmisano',source:'EDG Skateboards',date:'2024',category:'Game of Skate'},
];
const skateVideoUrl=id=>`https://www.youtube.com/watch?v=${id}`;
function skatePoster(film,action='play-skate'){return `<button type="button" class="skate-play" data-action="${action}" data-id="${film.id}" aria-label="Reproducir ${escape(film.title)}"><img src="${film.poster||`https://i.ytimg.com/vi/${film.id}/hqdefault.jpg`}" width="480" height="360" alt="" data-video-thumbnail loading="lazy" decoding="async"><span class="skate-play-icon" aria-hidden="true">▶</span><span class="skate-play-label">Ver vídeo</span></button>`;}
function skateFilm(film,index,{archive=false,action='play-skate'}={}){return `<article class="skate-film"${archive&&index>=3?' hidden data-skate-extra':''}><div class="skate-player-shell" data-video-id="${film.id}">${skatePoster(film,action)}</div><div class="skate-film-meta"><span class="eyebrow">${archive?`${escape(film.category)} / ${film.date}`:`Destacado / 0${index+1}`}</span><h3>${escape(film.title)}</h3><p>${escape(film.description||film.source)}</p><a class="skate-text-link" href="${skateVideoUrl(film.id)}" target="_blank" rel="noopener noreferrer">Ver en YouTube ↗</a></div></article>`;}
function skatePage(){return storeShell(`<div class="skate-page">
  <section class="skate-hero" aria-labelledby="skate-title"><img class="skate-hero-image" src="/edg-skate-campaign-1600.webp" srcset="/edg-skate-campaign-960.webp 960w, /edg-skate-campaign-1600.webp 1600w" sizes="100vw" width="1600" height="1600" alt="Skate en las calles de Barcelona." fetchpriority="high"><div class="skate-hero-copy"><span class="eyebrow">Original . Barcelona</span><h1 id="skate-title" tabindex="-1">SKATE</h1><p>Nuestra historia se escribe en la calle.</p></div></section>
  <nav class="skate-section-nav" aria-label="Secciones de SKATE">${[['destacados','Destacados'],['historia','Historia'],['equipo','Equipo'],['archivo','Archivo']].map(([id,label])=>`<a href="#skate" data-action="skate-jump" data-section="${id}">${label}</a>`).join('')}</nav>
  <section id="skate-destacados" class="skate-section" aria-labelledby="skate-featured-title"><div class="skate-section-head"><span class="eyebrow">EDG / Selección especial</span><h2 id="skate-featured-title" tabindex="-1">EN MOVIMIENTO.</h2><p>Dos miradas al skate y a las personas que dan vida a EDG.</p></div><div class="skate-featured-grid">${skateFeatured.map((film,i)=>skateFilm(film,i)).join('')}</div></section>
  <section id="skate-historia" class="skate-section skate-history" aria-labelledby="skate-history-title"><div class="skate-history-intro"><div><span class="eyebrow">Nuestra historia</span><h2 id="skate-history-title" tabindex="-1">RAÍCES QUE<br>CRUZAN FRONTERAS.</h2></div><p>EDG nació en Barcelona, creada por skaters con raíces en Curitiba. Su conexión con Brasil también pasa por Florianópolis. Una historia que reúne ciudades, personas y la libertad de moverse sobre una tabla.</p></div><div class="skate-chapters"><article><span class="skate-chapter-number">01 / Origen</span><h3>Barcelona</h3><p>La ciudad donde nació EDG. El skate y la cultura urbana como punto de encuentro.</p></article><article><span class="skate-chapter-number">02 / Conexión</span><h3>Brasil</h3><p>Raíces curitibanas y presencia en Florianópolis: una conexión que atraviesa el océano.</p></article><article><span class="skate-chapter-number">03 / 2025</span><h3>Brasil en movimiento</h3><p>El EDG Tour Santa Catarina 2025 recorre Balneário Camboriú, Florianópolis y Criciúma. Un nuevo capítulo de la marca, contado desde la calle.</p></article></div><div class="skate-history-photo"><img src="/edg-skate-history-barcelona-2160.webp" srcset="/edg-skate-history-barcelona-960.webp 960w, /edg-skate-history-barcelona-2160.webp 2160w" sizes="(max-width: 760px) calc(100vw - 40px), 90vw" alt="Mosaico de EDG con la Sagrada Familia y el Tibidabo." width="2160" height="720" loading="lazy" decoding="async"></div></section>
  <section id="skate-equipo" class="skate-section skate-team" aria-labelledby="skate-team-title"><div class="skate-section-head"><span class="eyebrow">Personas / EDG</span><h2 id="skate-team-title" tabindex="-1">EL EQUIPO EN VÍDEO.</h2><p>Conoce a Luis Viloria y Jorge dos Santos a través de sus presentaciones.</p></div><div class="skate-team-grid">${skateFeatured.map((film,i)=>`<article class="skate-rider"><img class="skate-rider-photo" src="https://i.ytimg.com/vi/${film.id}/hqdefault.jpg" width="480" height="360" alt="Portada de ${escape(film.title)}" data-video-thumbnail loading="lazy" decoding="async"><div class="skate-rider-copy"><span class="eyebrow">${i?'EDG / Video part':'EDG / Welcome'}</span><h3>${i?'Jorge dos Santos':'Luis Viloria'}</h3><p>${i?'Su presentación como parte del equipo.':'Su bienvenida a EDG.'}</p><a href="#skate" class="skate-text-link" data-action="skate-rider" data-id="${film.id}">Ver su presentación ↗</a></div></article>`).join('')}</div></section>
  <section id="skate-archivo" class="skate-section" aria-labelledby="skate-archive-title"><div class="skate-section-head"><span class="eyebrow">Desde el canal oficial</span><h2 id="skate-archive-title" tabindex="-1">ARCHIVO EDG.</h2><p>Tours, sesiones, música y encuentros. Más capítulos de nuestra historia.</p></div><div id="skate-archive-grid" class="skate-archive-grid">${skateArchive.map((film,i)=>skateFilm(film,i,{archive:true})).join('')}</div><div class="skate-more"><button class="btn" type="button" data-action="skate-more" aria-controls="skate-archive-grid" aria-expanded="false">Ver más vídeos</button><a class="skate-text-link" href="${skateChannel}/videos" target="_blank" rel="noopener noreferrer">Todo el archivo en YouTube ↗</a></div></section>
  <section class="skate-section skate-closing"><div><span class="eyebrow">EDG Skateboards</span><h2>LA HISTORIA SIGUE.</h2><p>Sigue el canal o encuentra tu próxima tabla.</p></div><div class="stack"><a class="btn" href="${skateChannel}" target="_blank" rel="noopener noreferrer">Ver el canal ↗</a><a class="btn" href="#catalog">Explorar los shapes ↗</a></div></section>
</div>`);}
function playSkateFilm(button,films=[...skateFeatured,...skateArchive],action='play-skate'){
  const film=films.find(item=>item.id===button.dataset.id);
  const shell=button.closest('.skate-player-shell');if(!film||!shell)return;
  // Replacing the previous iframe stops its media without loading the YouTube JS API.
  document.querySelectorAll('.skate-player-shell iframe').forEach(frame=>{
    const old=films.find(item=>item.id===frame.parentElement.dataset.videoId);
    if(old)frame.parentElement.innerHTML=skatePoster(old,action);
  });
  const frame=document.createElement('iframe');frame.src=`https://www.youtube-nocookie.com/embed/${film.id}?autoplay=1&playsinline=1&rel=0`;
  frame.title=film.title;frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
  shell.replaceChildren(frame);frame.focus({preventScroll:true});
}
function jumpSkateSection(button){
  const section=document.getElementById(`skate-${button.dataset.section}`);if(!section)return;
  section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  section.querySelector('h2')?.focus({preventScroll:true});
}
function skateStoreMenu(){
  const route=location.hash||'#store';
  const link=(href,label)=>`<a href="${href}"${route===href?' aria-current="page"':''}>${label}</a>`;
  return `<dialog id="store-menu" class="store-menu" aria-labelledby="store-menu-title"><div class="store-menu-head"><span id="store-menu-title" class="eyebrow">EDG / Original . Barcelona</span><button class="store-menu-close" type="button" data-action="close-store-menu" aria-label="Cerrar menú">×</button></div><nav class="store-menu-links" aria-label="Menú principal">${link('#store','Inicio')}${link('#catalog','Colección')}${link('#skate','SKATE')}${link('#musica','MÚSICA')}${state.user?link('#orders','Mis pedidos'):''}</nav><p class="store-menu-caption">Skateboarding y cultura urbana.</p></dialog>`;
}
function bindSkateNavigation(){
  const menu=document.getElementById('store-menu'),controller=new AbortController(),options={signal:controller.signal};
  if(menu){
    const closed=()=>{document.documentElement.classList.remove('store-menu-visible');document.querySelector('.store-menu-open')?.setAttribute('aria-expanded','false');};
    menu.addEventListener('close',closed,options);
    matchMedia('(max-width:1000px)').addEventListener('change',event=>{
      if(event.matches||!menu.open)return;
      menu.close();
      document.querySelector('.store-header .toplinks a[href="#store"]')?.focus({preventScroll:true});
    },options);
    menu.addEventListener('click',event=>{
      if(event.target.closest('a')){menu.close();if(event.target.closest('a').hash===location.hash)window.scrollTo({top:0,behavior:'auto'});}
      if(event.target===menu){const r=menu.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)menu.close();}
    },options);
  }
  document.addEventListener('error',event=>{if(event.target.matches?.('[data-video-thumbnail]'))event.target.hidden=true;},{...options,capture:true});
  return ()=>{controller.abort();if(menu?.open)menu.close();document.documentElement.classList.remove('store-menu-visible');};
}
