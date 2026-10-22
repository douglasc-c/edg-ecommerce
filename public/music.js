// Band history and original artwork supplied by EDG. See MUSIC.md for sources.
const musicFeatured=[
  {id:'rCEez-8asOg',title:'Pratas da Casa',source:'Gorilla Concept Music',description:'Curado, EDG & Indigesto. Producción de DJ Cia.',poster:'/music/pratas-da-casa.webp'},
  {id:'LdxB1RLR0lo',title:'Aperta o Play',source:'EDG Skateboards',description:'Deds D y Charlie B. El videoclip oficial desde el universo EDG.',poster:'/music/aperta-o-play.webp'},
];
const musicAlbums=[
  {title:'Rap Subterrâneo',year:2012,cover:'rap-subterraneo'},
  {title:'Sobrenatural',year:2016,cover:'sobrenatural'},
  {title:'Mensageiro do Corre',year:2018,cover:'mensageiro-do-corre'},
  {title:'A Parada é o Movimento',year:2020,cover:'a-parada-e-o-movimento'},
];
const musicHistory=[
  {year:2010,title:'El Raval, Barcelona',text:'Rafael, Charlie B, reúne a músicos de la escena local. EDG nace en las calles del Raval, con raíces brasileñas y una nueva casa en Barcelona.'},
  {year:2012,title:'Rap Subterrâneo',text:'El primer disco llega en vinilo, con las participaciones de Indigesto, Tom Penny y MC Eltin. Empieza el camino discográfico de EDG.'},
  {year:2016,title:'Sobrenatural',text:'El segundo disco reúne 15 temas y colaboraciones internacionales. Una nueva etapa para el sonido de la banda.'},
  {year:2018,title:'Mensageiro do Corre',text:'El tercer disco consolida los directos junto a Indigesto y DJ Ploc, compañeros habituales sobre el escenario.'},
  {year:2020,title:'A Parada é o Movimento',text:'El cuarto disco acompaña una etapa de festivales y escenarios europeos, con paradas en Londres, Alemania, Portugal y España.'},
];
function musicPage(){return storeShell(`<div class="skate-page music-page">
  <section class="skate-hero" aria-labelledby="music-title"><img class="skate-hero-image" src="/music/banda-hero.webp" srcset="/music/banda-hero-640.webp 640w, /music/banda-hero.webp 768w" sizes="100vw" width="768" height="432" alt="Tres músicos de EDG en directo, con micrófonos y mesa de DJ." fetchpriority="high"><div class="skate-hero-copy"><span class="eyebrow">EDG / Barcelona / Desde 2010</span><h1 id="music-title" tabindex="-1">MÚSICA</h1><p>Raíces brasileñas. Rap hecho en Barcelona.</p><div class="music-hero-actions"><a class="btn" href="#musica" data-action="music-jump" data-section="videos">Ver los videoclips ↘</a></div></div></section>
  <nav class="skate-section-nav" aria-label="Secciones de MÚSICA">${[['videos','Videoclips'],['historia','Historia'],['discos','Discografía'],['directo','En directo']].map(([id,label])=>`<a href="#musica" data-action="music-jump" data-section="${id}">${label}</a>`).join('')}</nav>
  <section id="musica-videos" class="skate-section" aria-labelledby="music-videos-title"><div class="skate-section-head"><span class="eyebrow">EDG / Selección especial</span><h2 id="music-videos-title" tabindex="-1">DALE AL PLAY.</h2><p>Dos videoclips para entrar en nuestro sonido.</p></div><div class="skate-featured-grid">${musicFeatured.map((film,i)=>skateFilm(film,i,{action:'play-music'})).join('')}</div></section>
  <section id="musica-historia" class="skate-section music-history" aria-labelledby="music-history-title"><div class="music-history-intro"><div><span class="eyebrow">Brasil / Raval / Mundo</span><h2 id="music-history-title" tabindex="-1">DEL BARRIO<br>AL ESCENARIO.</h2></div><div><p>EDG nació en 2010 en el Raval, el barrio 08001 de Barcelona. Rafael, Charlie B, reunió a distintos talentos de la música y convirtió los encuentros locales en el comienzo de una banda.</p><p>Con raíces brasileñas cultivadas al otro lado del Atlántico, la familia creció entre discos, colaboraciones y directos. El rap y el skate siguen compartiendo el mismo camino.</p></div></div><ol class="music-timeline">${musicHistory.map(chapter=>`<li><time datetime="${chapter.year}">${chapter.year}</time><div><h3>${escape(chapter.title)}</h3><p>${escape(chapter.text)}</p></div></li>`).join('')}</ol></section>
  <section id="musica-discos" class="skate-section music-discography" aria-labelledby="music-discography-title"><div class="skate-section-head"><span class="eyebrow">EDG / Los discos</span><h2 id="music-discography-title" tabindex="-1">CADA DISCO,<br>UN CAPÍTULO.</h2><p>De Rap Subterrâneo a A Parada é o Movimento.</p></div><div class="music-album-grid">${musicAlbums.map(album=>`<article class="music-album"><img src="/music/${album.cover}.webp" width="600" height="600" alt="Portada del disco ${escape(album.title)}" loading="lazy" decoding="async"><div class="music-album-meta"><span class="eyebrow">${album.year}</span><h3>${escape(album.title)}</h3></div></article>`).join('')}</div></section>
  <section id="musica-directo" class="skate-section music-live" aria-labelledby="music-live-title"><div class="music-live-copy"><span class="eyebrow">La música se comparte</span><h2 id="music-live-title" tabindex="-1">NOS VEMOS<br>EN EL DIRECTO.</h2><p>De los eventos del Raval a los escenarios de Europa. Barcelona ha sido punto de encuentro con artistas como Criolo, Jeru the Damaja, Lords of the Underground y Gabriel o Pensador.</p><ul class="music-stages" aria-label="Festivales en la historia de EDG"><li>Dia de Brasil</li><li>Fiestas del Raval</li><li>Mas i Mas · Jamboree</li><li>Confusion Festival</li></ul></div><img class="music-live-image" src="/music/banda-live.webp" width="640" height="368" alt="EDG sobre el escenario ante el público en un concierto al aire libre." loading="lazy" decoding="async"></section>
  <section class="skate-section skate-closing"><div><span class="eyebrow">Música y skate / Una misma familia</span><h2>EL MOVIMIENTO SIGUE.</h2><p>Más música en el canal. Más historias sobre la tabla.</p></div><div class="stack"><a class="btn" href="${skateChannel}" target="_blank" rel="noopener noreferrer">Escuchar en YouTube ↗</a><a class="btn" href="#skate">Descubrir SKATE ↗</a></div></section>
</div>`);}
function jumpMusicSection(button){
  const section=document.getElementById(`musica-${button.dataset.section}`);if(!section)return;
  section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  section.querySelector('h2')?.focus({preventScroll:true});
}
