// Solo se usa el país para sugerir el idioma de la interfaz, nunca la moneda o la tienda.
const countries=new Set(`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/));
const portugueseCountries=new Set('AO BR CV GW MO MZ PT ST TL'.split(' '));
const spanishCountries=new Set('AR BO CL CO CR CU DO EC ES GQ GT HN MX NI PA PE PR PY SV UY VE'.split(' '));
const supportedLanguages={es:'es',en:'en',pt:'pt-BR'};

export function normalizeCountry(value) {
  if(typeof value!=='string')return null;
  const country=value.trim().toUpperCase();
  return countries.has(country)?country:null;
}

function acceptedLanguage(header) {
  if(typeof header!=='string')return null;
  const choices=header.split(',').map((part,index)=>{
    const [rawRange,...parameters]=part.trim().split(';'),range=rawRange.trim();
    if(!/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(range))return null;
    const language=supportedLanguages[range.toLowerCase().split('-')[0]];
    if(!language)return null;
    const weight=parameters.find(parameter=>/^\s*q\s*=/i.test(parameter));
    const match=weight?.match(/^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/i);
    if(weight!==undefined&&!match)return null;
    const quality=match?Number(match[1]):1;
    return quality>0?{language,quality,index}:null;
  }).filter(Boolean).sort((a,b)=>b.quality-a.quality||a.index-b.index);
  return choices[0]?.language||null;
}

export function suggestLanguage({country,acceptLanguage}={}) {
  country=normalizeCountry(country);
  if(country)return {
    suggested_language:portugueseCountries.has(country)?'pt-BR':spanishCountries.has(country)?'es':'en',
    language_source:'country',country
  };
  const language=acceptedLanguage(acceptLanguage);
  return {suggested_language:language||'es',language_source:language?'accept-language':'default',country:null};
}
