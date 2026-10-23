import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';

const files=['i18n-common.js','i18n-editorial.js','i18n.js'];
const scripts=await Promise.all(files.map(file=>readFile(new URL(`../public/${file}`,import.meta.url),'utf8')));
const locales={es:'es-ES',en:'en-GB','pt-BR':'pt-BR'};
const placeholders=value=>[...value.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match=>match[1]).sort();
const interpolate=(value,parameters)=>value.replace(/\{([a-zA-Z]\w*)\}/g,(match,key)=>Object.hasOwn(parameters,key)?String(parameters[key]):match);

function runtime(options={}) {
  const {stored:initialStored=null,language='es-ES',storage='available'}=options;
  const languages=Object.hasOwn(options,'languages')?options.languages:['es-ES'];
  let stored=initialStored;
  const writes=[],events=[];
  const window={
    navigator:{languages,language},
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    dispatchEvent:event=>{events.push({type:event.type,...event.detail});return true;}
  };
  if(storage==='getter-throws')Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable');}});
  else if(storage!=='absent')window.localStorage={
    getItem(key){assert.equal(key,'edg.language');if(storage==='throws')throw new Error('Storage unavailable');return stored;},
    setItem(key,value){if(storage==='throws'||storage==='write-throws')throw new Error('Storage unavailable');writes.push([key,value]);stored=value;}
  };
  const context=createContext({window});
  scripts.forEach((script,index)=>runInContext(script,context,{filename:files[index]}));
  assert.equal(window.document,undefined,'Las pruebas del runtime no dependen de un DOM');
  return {i18n:window.EDGI18n,writes,events,common:window.EDGCommonMessages,editorial:window.EDGEditorialMessages};
}

test('el navegador elige la primera preferencia compatible y reconoce variantes regionales',()=>{
  for(const [languages,language,expected] of [
    [['fr-FR','pt-PT','en-GB'],'fr-FR','pt-BR'],
    [['de-DE','EN-us','es-ES'],'de-DE','en'],
    [['es-MX','pt-BR'],'es-MX','es'],
    [['fr-FR','de-DE'],'fr-FR','es'],
    [undefined,'pt-PT','pt-BR'],
    [undefined,undefined,'es']
  ]){
    const {i18n,writes}=runtime({languages,language});
    assert.equal(i18n.language,expected);assert.equal(i18n.locale,locales[expected]);assert.deepEqual(writes,[]);
  }
});

test('la selección manual guardada prevalece sobre el país y el navegador sin reescribir storage',()=>{
  for(const stored of Object.keys(locales)){
    const {i18n,writes}=runtime({stored,languages:['en-GB']});
    assert.equal(i18n.language,stored);
    i18n.initialize({suggested_language:stored==='es'?'pt-BR':'es',language_source:'country',country:'ES'});
    assert.equal(i18n.language,stored);assert.equal(i18n.locale,locales[stored]);assert.deepEqual(writes,[]);
  }
});

test('el país prevalece sobre el navegador y las sugerencias automáticas nunca se persisten',()=>{
  const {i18n,writes}=runtime({languages:['pt-BR']});
  for(const [suggested_language,country] of [['es','ES'],['en','DE'],['pt-BR','BR']]){
    i18n.initialize({suggested_language,language_source:'country',country});
    assert.equal(i18n.language,suggested_language);assert.deepEqual(writes,[]);
  }
  i18n.initialize({suggested_language:'en',language_source:'accept-language',country:null});
  assert.equal(i18n.language,'en');assert.deepEqual(writes,[]);
  assert.equal(i18n.setLanguage('es'),true);assert.deepEqual(writes,[['edg.language','es']]);
  i18n.initialize({suggested_language:'pt-BR',language_source:'country',country:'BR'});
  assert.equal(i18n.language,'es');assert.deepEqual(writes,[['edg.language','es']]);
});

test('sin país ni preferencia de servidor se conserva el idioma compatible del navegador',()=>{
  const {i18n,writes}=runtime({languages:['pt-BR','en-GB']});
  i18n.initialize({suggested_language:'es',language_source:'default',country:null});
  assert.equal(i18n.language,'pt-BR');assert.deepEqual(writes,[]);
  i18n.initialize({suggested_language:'fr',language_source:'country',country:'FR'});
  assert.equal(i18n.language,'pt-BR');
});

test('navigator.language sigue disponible cuando navigator.languages está vacío',()=>{
  const {i18n}=runtime({languages:[],language:'en-GB'});
  assert.equal(i18n.language,'en');
});

test('el idioma manual funciona cuando storage falta o lanza errores de privacidad o cuota',()=>{
  for(const storage of ['absent','throws','getter-throws','write-throws']){
    const {i18n,writes}=runtime({languages:['es-ES'],storage});
    i18n.initialize({suggested_language:'en',language_source:'country',country:'GB'});
    assert.equal(i18n.language,'en');
    assert.equal(i18n.setLanguage('pt-BR'),true);assert.equal(i18n.language,'pt-BR');
    i18n.initialize({suggested_language:'es',language_source:'country',country:'ES'});
    assert.equal(i18n.language,'pt-BR');assert.deepEqual(writes,[]);
  }
});

test('idiomas inválidos no cambian la selección, no generan eventos y no se guardan',()=>{
  for(const stored of ['fr','pt','EN',' es ','constructor',null]){
    const {i18n,writes,events}=runtime({stored,languages:['en-GB']});
    assert.equal(i18n.language,'en');
    for(const invalid of [undefined,null,'','fr','pt','EN',' es ','constructor',{},42])assert.equal(i18n.setLanguage(invalid),false);
    assert.equal(i18n.language,'en');assert.deepEqual(writes,[]);assert.deepEqual(events,[]);
    i18n.initialize({suggested_language:'invalid'});assert.equal(i18n.language,'en');
  }
});

test('se notifica únicamente un cambio real y se mantiene la preferencia manual',()=>{
  const {i18n,events,writes}=runtime({languages:['es-ES']});
  i18n.initialize({suggested_language:'es'});assert.deepEqual(events,[]);
  i18n.setLanguage('en');i18n.setLanguage('en');
  assert.deepEqual(events,[{type:'edg:languagechange',language:'en',locale:'en-GB'}]);
  assert.deepEqual(writes,[['edg.language','en'],['edg.language','en']]);
  i18n.initialize({suggested_language:'pt-BR',language_source:'country',country:'BR'});
  assert.equal(events.length,1);assert.equal(i18n.language,'en');
});

test('los diccionarios tienen las mismas claves por idioma y conservan cada placeholder',()=>{
  const {common,editorial}=runtime();
  for(const [name,dictionary] of Object.entries({common,editorial})){
    assert.deepEqual(Object.keys(dictionary).sort(),['en','pt-BR']);
    assert.deepEqual(Object.keys(dictionary.en).sort(),Object.keys(dictionary['pt-BR']).sort(),name);
    for(const [language,messages] of Object.entries(dictionary))for(const [source,translation] of Object.entries(messages)){
      assert.ok(source.trim(),`${name}/${language}: clave vacía`);
      assert.equal(source,source.replace(/\s+/g,' ').trim(),`${name}/${language}: clave no canónica ${source}`);
      assert.equal(typeof translation,'string',`${name}/${language}/${source}`);
      assert.ok(translation.trim(),`${name}/${language}: traducción vacía ${source}`);
      assert.deepEqual(placeholders(translation),placeholders(source),`${name}/${language}/${source}`);
    }
  }
  for(const language of ['en','pt-BR'])for(const key of Object.keys(editorial[language])){
    if(Object.hasOwn(common[language],key))assert.equal(editorial[language][key],common[language][key],`La clave compartida ${key} debe ser coherente`);
  }
});

test('cada traducción exacta se resuelve sin traducir textos desconocidos ni nombres oficiales',()=>{
  const {i18n,common,editorial}=runtime();
  for(const language of ['en','pt-BR']){
    i18n.setLanguage(language);
    for(const [source,translation] of Object.entries({...common[language],...editorial[language]})){
      if(!placeholders(source).length)assert.equal(i18n.t(source),translation,`${language}/${source}`);
    }
    for(const value of ['EDG / Skateboards','Charlie B','Rap Subterrâneo','Obrigado Skateboard','EDG-SH-8.25','ana+edg@example.test','<b>EDG & família</b>'])assert.equal(i18n.t(value),value);
  }
  i18n.setLanguage('es');assert.equal(i18n.t('Colección'),'Colección');assert.equal(i18n.t('  texto propio  '),'  texto propio  ');
  assert.equal(i18n.t(null),'');assert.equal(i18n.t(undefined),'');assert.equal(i18n.t(2026),'2026');
});

test('los patrones traducen mensajes compuestos manteniendo nombres, SKU, tallas y códigos',()=>{
  const {i18n,common,editorial}=runtime();
  const mismatches=[];
  const values=Object.freeze({
    name:'EDG «A & B / 8.25"»',count:3,index:'02',year:2026,number:1042,quantity:2,attempts:4,
    amount:'49,90 €',date:'22/10/26, 12:30',code:'EDG-15/BR',days:'3–5',email:'ana+edg@example.test',
    values:'1, 2, 3',category:'Skate EDG',sizes:'8.0, 8.25',sku:'EDG-SH-008',currency:'EUR',
    stock:10,reserved:2,available:8,id:'label-α/902',carrier:'Correos Express',service:'DHL 24/48',
    total:30,customer:2,environment:'Demo',reference:'EDG/2026/01',recipient:'ana+edg@example.test',
    field:'tax_code',min:2,max:120,status:400,detail:'Invalid contract.'
  });
  for(const language of ['en','pt-BR']){
    i18n.setLanguage(language);
    for(const [source,translation] of Object.entries({...common[language],...editorial[language]})){
      if(!placeholders(source).length)continue;
      for(const name of placeholders(source))assert.ok(Object.hasOwn(values,name),`Falta un dato de prueba para ${name}`);
      assert.equal(i18n.t(source,values),interpolate(translation,values),`Explícita: ${language}/${source}`);
      const actual=i18n.t(interpolate(source,values)),expected=interpolate(translation,values);
      if(actual!==expected)mismatches.push({language,source,actual,expected});
    }
  }
  assert.deepEqual(mismatches,[],'Todos los patrones deben conservar los datos y elegir la traducción más específica');
  assert.equal(i18n.t('Ver {name}',{name:'{count} <EDG>'}),'Ver {count} <EDG>','Los datos no se interpolan por segunda vez');
  i18n.setLanguage('es');assert.equal(i18n.t('Ver {name}',values),`Ver ${values.name}`);
  assert.equal(i18n.t('Clave {missing}',{}),'Clave {missing}');
});

test('los nombres de propiedades de Object no son traducciones ni ejecutan métodos',()=>{
  const {i18n}=runtime({languages:['en-GB']});
  for(const value of ['constructor','toString','valueOf','__proto__','hasOwnProperty']){
    assert.equal(i18n.t(value),value);
    assert.equal(i18n.t(value,{}),value);
  }
});

test('las traducciones no sustituyen frases parciales ni patrones numéricos con datos arbitrarios',()=>{
  const {i18n}=runtime({languages:['en-GB']});
  for(const value of [
    'Un diseño llamado Colección para EDG',
    'Prefijo Ver EDG',
    'X Foto de EDG',
    'Foto EDG-SH-008',
    'EDG productos',
    '3 artículoXsX',
    'Nombre: introduce entre 2 y 120 caracteres!',
    'Música / EDG',
    'Mi cuenta / ana@example.test'
  ])assert.equal(i18n.t(value),value);
  assert.equal(i18n.t('Foto 2'),'Photo 2');
  assert.equal(i18n.t('3 artículo(s)'),'3 item(s)');
  assert.equal(i18n.t('Música / 2026'),'Music / 2026');
});

test('los importes cambian de formato sin convertir moneda ni modificar los céntimos',()=>{
  const {i18n}=runtime();
  const entries=[{cents:4990,currency:'EUR'},{cents:123456,currency:'BRL'},{cents:-1500,currency:'USD'},{cents:0,currency:'EUR'}];
  const sources=entries.map(({cents,currency})=>i18n.money(cents,currency));
  entries.forEach(({cents,currency},index)=>assert.equal(sources[index],new Intl.NumberFormat('es-ES',{style:'currency',currency}).format(cents/100)));
  for(const language of ['en','pt-BR','es','en']){
    i18n.setLanguage(language);
    entries.forEach(({cents,currency},index)=>assert.equal(i18n.t(sources[index]),new Intl.NumberFormat(locales[language],{style:'currency',currency}).format(cents/100)));
  }
  const late=i18n.money(12990,'EUR');
  assert.equal(i18n.t(late),new Intl.NumberFormat('en-GB',{style:'currency',currency:'EUR'}).format(129.90));
  assert.equal(i18n.t(`${sources[0]} por unidad`),`${new Intl.NumberFormat('en-GB',{style:'currency',currency:'EUR'}).format(49.90)} per item`);
  assert.equal(i18n.t('EUR / BRL / USD / 4990 / EDG-SH-008'),'EUR / BRL / USD / 4990 / EDG-SH-008');
});

test('las fechas cambian de presentación conservando el instante y los datos de mensajes compuestos',()=>{
  const {i18n}=runtime();
  const value='2026-10-22T12:14:19.000Z',instant=new Date(value),source=i18n.date(value);
  const format=locale=>instant.toLocaleString(locale,{dateStyle:'short',timeStyle:'short'});
  assert.equal(source,format('es-ES'));
  for(const language of ['en','pt-BR','es']){
    i18n.setLanguage(language);
    assert.equal(i18n.t(source),format(locales[language]));
    const label=language==='en'?'Until':language==='pt-BR'?'Até':'Hasta';
    assert.equal(i18n.t(`Hasta ${source}`),`${label} ${format(locales[language])}`);
  }
  assert.equal(instant.toISOString(),value);
  const invalid=i18n.date('invalid');assert.equal(invalid,'Invalid Date');assert.equal(i18n.t(invalid),invalid);
});

test('un formato conocido no sustituye el sufijo numérico de otro importe o fecha',()=>{
  const {i18n}=runtime({languages:['en-GB']});
  const unit=i18n.money(100,'EUR');
  const larger=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(11);
  assert.ok(larger.endsWith(unit),'El ejemplo debe contener un importe como sufijo de otro');
  assert.equal(i18n.t(larger),larger);
  assert.equal(i18n.t(`Referencia: ${larger}`),`Reference: ${larger}`);
  const first=i18n.date('2026-01-01T12:00:00.000Z');
  const later=new Date('2026-01-11T12:00:00.000Z').toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
  assert.ok(later.endsWith(first),'El ejemplo debe contener una fecha como sufijo de otra');
  assert.equal(i18n.t(later),later);
  assert.equal(i18n.t(`Referencia: ${later}`),`Reference: ${later}`);
});

test('el selector muestra solo banderas y mantiene valores de idioma y nombres accesibles',()=>{
  const {i18n}=runtime();
  for(const [language,label,name] of [['es','Idioma','Español'],['en','Language','English'],['pt-BR','Idioma','Português do Brasil']]){
    i18n.setLanguage(language);
    const html=i18n.selector();
    assert.match(html,/data-language-select/);assert.match(html,/translate="no"/);
    assert.ok(html.includes(`aria-label="${label}"`));assert.ok(html.includes(`title="${name}"`));
    assert.deepEqual([...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match=>match[1]),['🇪🇸','🇬🇧','🇧🇷']);
    assert.equal([...html.matchAll(/ selected/g)].length,1);
    assert.ok(new RegExp(`<option value="${language}"[^>]* selected>`).test(html));
    for(const code of Object.keys(locales))assert.ok(html.includes(`value="${code}" lang="${code}" aria-label="`));
  }
});
