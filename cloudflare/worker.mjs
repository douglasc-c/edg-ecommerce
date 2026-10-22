import { DurableObject } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { createApp, configuration } from '../src/server.mjs';
import { email, passwordHash, now } from '../src/security.mjs';
import { durableDatabase } from './database.mjs';
import { campaignVideoPaths, campaignVideoResponse } from '../src/video-response.mjs';
import { normalizeCountry } from '../src/language.mjs';

// Un objeto estable es propietario de la base de datos de esta tienda. Nunca se deriva su nombre de la entrada del usuario.
export class CommerceStore extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.app=null;this.initializing=null;}
  async initialize(){
    if(this.app)return;
    if(!this.initializing)this.initializing=(async()=>{
      const config=configuration({...this.env,NODE_ENV:'production'});
      const db=durableDatabase(this.ctx.storage);
      if(!db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").get()){
        if(!this.env.ADMIN_EMAIL || !this.env.ADMIN_PASSWORD)throw new Error('Configura ADMIN_EMAIL y ADMIN_PASSWORD.');
        const address=email(this.env.ADMIN_EMAIL);
        if(db.prepare('SELECT id FROM users WHERE email=?').get(address))throw new Error('Correo electrónico inicial ya registrado.');
        const pwd=await passwordHash(this.env.ADMIN_PASSWORD);
        db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'Administrador EDG',address,pwd,'admin',now());
      }
      this.app=createApp({db,config,runtime:'worker'});
    })().catch(error=>{this.initializing=null;throw error;});
    await this.initializing;
  }
  async fetch(request){
    try{
      // Serializa la inicialización, incluida la derivación asíncrona de la contraseña.
      await this.ctx.blockConcurrencyWhile(()=>this.initialize());
      return await new Promise((resolve,reject)=>{
        const headers=new Headers();let status=200;
        const response={headersSent:false,setHeader(k,v){headers.set(k,v);},writeHead(code,values){status=code;for(const [k,v] of Object.entries(values))headers.set(k,v);this.headersSent=true;},end(content){resolve(new Response(request.method==='HEAD'?null:content??null,{status,headers}));}};
        const req={url:request.url,method:request.method,headers:Object.fromEntries(request.headers),country:normalizeCountry(request.headers.get('x-edg-country')),socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},async *[Symbol.asyncIterator](){if(request.body){for await(const chunk of request.body)yield Buffer.from(chunk);}}};
        this.app.handler(req,response).catch(reject);
      });
    }catch(error){console.error('Tienda no disponible:',error.message);return Response.json({error:'Tienda no disponible. Revisa APP_URL, ADMIN_EMAIL y ADMIN_PASSWORD en la configuración del Worker.'},{status:503,headers:{'Content-Language':'es'}});}
  }
  async maintenance(){await this.initialize();this.app.shop.expire();await this.app.recovery.flush();}
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/') || path.startsWith('/media/')){
      // Solo el dato del edge es fiable: no aceptar cabeceras de país del visitante.
      const headers=new Headers(request.headers),country=normalizeCountry(request.cf?.country);
      headers.delete('x-edg-country');
      if(country)headers.set('x-edg-country',country);
      return env.STORE.getByName('primary').fetch(new Request(request,{headers}));
    }
    const campaignVideo=campaignVideoPaths.has(path)&&['GET','HEAD'].includes(request.method);
    let assetRequest=request;
    if(campaignVideo){
      // The assets binding may ignore Range; obtain the complete small MP4 and
      // apply the requested range ourselves, including Safari's initial probe.
      const headers=new Headers(request.headers);
      headers.delete('Range');headers.delete('If-Range');
      headers.set('Accept-Encoding','identity');
      assetRequest=new Request(request,{method:'GET',headers});
    }
    let response=await env.ASSETS.fetch(assetRequest);
    if(campaignVideo&&response.status===200){
      const result=campaignVideoResponse(request,new Uint8Array(await response.arrayBuffer()),response.headers);
      response=new Response(result.body,{status:result.status,headers:result.headers});
    }
    const headers=new Headers(response.headers);
    headers.set('Content-Language','es');
    headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self' https://cloudflareinsights.com; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(env.STORE.getByName('primary').maintenance());}
};
