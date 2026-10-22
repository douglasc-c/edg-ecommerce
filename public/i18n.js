(function(global){
  'use strict';
  const languages=[
    {code:'es',locale:'es-ES',flag:'🇪🇸',name:'Español'},
    {code:'en',locale:'en-GB',flag:'🇬🇧',name:'English'},
    {code:'pt-BR',locale:'pt-BR',flag:'🇧🇷',name:'Português do Brasil'}
  ];
  const storageKey='edg.language';
  const supported=value=>languages.some(item=>item.code===value)?value:null;
  const browserLanguage=()=>{
    const preferences=global.navigator?.languages;
    for(const value of preferences?.length?preferences:[global.navigator?.language]){
      const primary=String(value||'').toLowerCase().split('-')[0];
      if(primary==='pt')return 'pt-BR';
      if(primary==='es'||primary==='en')return primary;
    }
    return 'es';
  };
  let manual=null;
  try{manual=supported(global.localStorage?.getItem(storageKey));}catch{}
  let automatic=browserLanguage(),language=manual||automatic;
  const core={
    en:{'Idioma':'Language','Cargando…':'Loading…','Cargando la tienda':'Loading the store','EDG Commerce · Tienda y gestión':'EDG Commerce · Store and management'},
    'pt-BR':{'Idioma':'Idioma','Cargando…':'Carregando…','Cargando la tienda':'Carregando a loja','EDG Commerce · Tienda y gestión':'EDG Commerce · Loja e gestão'}
  };
  const messages=Object.fromEntries(['en','pt-BR'].map(code=>[code,{
    ...global.EDGCommonMessages?.[code],...global.EDGEditorialMessages?.[code],...core[code]
  }]));
  const escapeRegex=value=>value.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&');
  const normalized=value=>value.replace(/\s+/g,' ').trim();
  const placeholders=/\{([a-zA-Z]\w*)\}/g;
  const patterns=Object.keys(messages.en).filter(key=>/\{[a-zA-Z]\w*\}/.test(key)).map(key=>{
    const names=[];
    let expression='',position=0;
    for(const match of key.matchAll(placeholders)){
      expression+=escapeRegex(key.slice(position,match.index)).replace(/ /g,'\\s+');
      names.push(match[1]);
      expression+=/^(count|index|year|number|quantity|attempts)$/.test(match[1])?'([\\d.,]+)':'([\\s\\S]+?)';
      position=match.index+match[0].length;
    }
    expression+=escapeRegex(key.slice(position)).replace(/ /g,'\\s+');
    return {key,names,specificity:key.replace(placeholders,'').length,expression:new RegExp('^'+expression+'$')};
  }).sort((a,b)=>b.specificity-a.specificity);
  const interpolate=(template,values)=>template.replace(placeholders,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
  function translate(source,values){
    const text=String(source??'');
    if(values)return interpolate(language==='es'||!Object.hasOwn(messages[language],text)?text:messages[language][text],values);
    if(language==='es')return text;
    const key=normalized(text);
    if(Object.hasOwn(messages[language],key))return messages[language][key];
    for(const pattern of patterns){
      const match=pattern.expression.exec(text);
      if(match)return interpolate(messages[language][pattern.key],Object.fromEntries(pattern.names.map((name,index)=>[name,match[index+1]])));
    }
    return text;
  }
  const locale=()=>languages.find(item=>item.code===language).locale;
  // Keep canonical sources so changing language updates amounts and dates
  // without rebuilding forms, media players, or the current route.
  const formats=new Map();
  let formatPattern=null,formatsChanged=false;
  function registerFormat(source,descriptor){
    if(!formats.has(source))formatsChanged=true;
    formats.set(source,descriptor);
    return source;
  }
  function money(value,currency='BRL'){
    const amount=(value||0)/100;
    return registerFormat(new Intl.NumberFormat('es-ES',{style:'currency',currency}).format(amount),{kind:'money',amount,currency});
  }
  function date(value){
    const instant=new Date(value);
    const source=instant.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
    return Number.isFinite(instant.getTime())?registerFormat(source,{kind:'date',instant}):source;
  }
  function localizeFormats(text){
    if(language==='es'||!formats.size)return text;
    if(formatsChanged){
      formatPattern=new RegExp([...formats.keys()].sort((a,b)=>b.length-a.length).map(escapeRegex).join('|'),'g');
      formatsChanged=false;
    }
    return text.replace(formatPattern,(source,offset,input)=>{
      // A registered amount/date must not match the suffix of a different value.
      if((offset>0&&/[\d.,/]/.test(input[offset-1]))||/\d/.test(input[offset+source.length]||''))return source;
      const value=formats.get(source);
      return value.kind==='money'?new Intl.NumberFormat(locale(),{style:'currency',currency:value.currency}).format(value.amount):
        value.instant.toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'});
    });
  }
  function text(source,values){
    return localizeFormats(translate(source,values));
  }
  const textSources=new WeakMap(),attributeSources=new WeakMap();
  const ignored='[translate="no"],[data-i18n-ignore],script,style,textarea,input,pre,code,svg,[contenteditable]:not([contenteditable="false"]),[data-language-select]';
  const attributes=['aria-label','alt','title','placeholder'];
  let observer=null,applying=false,scheduled=false;
  function translatedValue(source){
    const parts=/^(\s*)([\s\S]*?)(\s*)$/.exec(source);
    return parts[1]+localizeFormats(translate(parts[2]))+parts[3];
  }
  function translateNode(node){
    if(!node.parentElement||node.parentElement.closest(ignored)||!node.nodeValue.trim())return;
    const previous=textSources.get(node);
    const source=previous&&node.nodeValue===previous.rendered?previous.source:node.nodeValue;
    const rendered=translatedValue(source);
    if(rendered!==node.nodeValue){
      // Preserve the submitted value when an option originally used its text.
      if(node.parentElement.tagName==='OPTION'&&!node.parentElement.hasAttribute('value'))node.parentElement.value=node.parentElement.value;
      node.nodeValue=rendered;
    }
    textSources.set(node,{source,rendered});
  }
  function translateAttributes(element){
    if(element.closest('[translate="no"],[data-i18n-ignore],[data-language-select],svg'))return;
    const sources=attributeSources.get(element)||new Map();
    for(const name of attributes){
      if(!element.hasAttribute(name))continue;
      const current=element.getAttribute(name),previous=sources.get(name);
      const source=previous&&current===previous.rendered?previous.source:current;
      const rendered=translatedValue(source);
      if(current!==rendered)element.setAttribute(name,rendered);
      sources.set(name,{source,rendered});
    }
    attributeSources.set(element,sources);
  }
  function observe(){
    observer?.observe(global.document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
  }
  function apply(){
    const doc=global.document;
    if(!doc?.documentElement||applying)return;
    applying=true;observer?.disconnect();
    try{
      doc.documentElement.lang=language;
      const walker=doc.createTreeWalker(doc.documentElement,4);
      let node;
      while((node=walker.nextNode()))translateNode(node);
      doc.querySelectorAll('[aria-label],[alt],[title],[placeholder]').forEach(translateAttributes);
      doc.querySelectorAll('[data-language-select]').forEach(select=>{
        select.value=language;
        select.setAttribute('aria-label',text('Idioma'));
        select.title=languages.find(item=>item.code===language).name;
      });
    }finally{applying=false;observe();}
  }
  function update(next){
    const changed=language!==next;
    language=next;
    apply();
    if(changed&&global.dispatchEvent&&global.CustomEvent)global.dispatchEvent(new global.CustomEvent('edg:languagechange',{detail:{language,locale:locale()}}));
  }
  function setLanguage(next){
    if(!supported(next))return false;
    manual=next;
    try{global.localStorage?.setItem(storageKey,next);}catch{}
    update(next);
    return true;
  }
  function initialize(config={}){
    automatic=(config.language_source!=='default'&&supported(config.suggested_language))||browserLanguage();
    update(manual||automatic);
  }
  function selector(){
    return '<select class="language-select" data-language-select translate="no" aria-label="'+text('Idioma')+'" title="'+languages.find(item=>item.code===language).name+'">'+
      languages.map(item=>'<option value="'+item.code+'" lang="'+item.code+'" aria-label="'+item.name+'"'+(item.code===language?' selected':'')+'>'+item.flag+'</option>').join('')+'</select>';
  }
  global.EDGI18n={languages,storageKey,initialize,setLanguage,selector,apply,t:text,money,date,get language(){return language;},get locale(){return locale();}};
  if(!global.document)return;
  observer=new global.MutationObserver(()=>{
    if(scheduled||applying)return;
    scheduled=true;
    global.queueMicrotask(()=>{scheduled=false;apply();});
  });
  global.document.addEventListener('change',event=>{
    if(event.target.matches('[data-language-select]'))setLanguage(event.target.value);
  });
  global.addEventListener('storage',event=>{
    if(event.key!==storageKey)return;
    manual=supported(event.newValue);
    update(manual||automatic);
  });
  apply();
})(typeof window==='undefined'?globalThis:window);
