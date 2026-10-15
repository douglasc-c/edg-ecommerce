import { DurableObject } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { createApp, configuration } from '../src/server.mjs';
import { email, passwordHash, now } from '../src/security.mjs';
import { durableDatabase } from './database.mjs';

// One stable object owns this store's database. Never derive its name from user input.
export class CommerceStore extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.app=null;this.initializing=null;}
  async initialize(){
    if(this.app)return;
    if(!this.initializing)this.initializing=(async()=>{
      const config=configuration({...this.env,NODE_ENV:'production'});
      const db=durableDatabase(this.ctx.storage);
      if(!db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").get()){
        if(!this.env.ADMIN_EMAIL || !this.env.ADMIN_PASSWORD)throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD.');
        const address=email(this.env.ADMIN_EMAIL);
        if(db.prepare('SELECT id FROM users WHERE email=?').get(address))throw new Error('E-mail inicial já cadastrado.');
        const pwd=await passwordHash(this.env.ADMIN_PASSWORD);
        db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'Administrador EDG',address,pwd,'admin',now());
      }
      this.app=createApp({db,config,runtime:'worker'});
    })().catch(error=>{this.initializing=null;throw error;});
    await this.initializing;
  }
  async fetch(request){
    try{
      // Serialize first-time bootstrap, including asynchronous password derivation.
      await this.ctx.blockConcurrencyWhile(()=>this.initialize());
      return await new Promise((resolve,reject)=>{
        const headers=new Headers();let status=200;
        const response={headersSent:false,setHeader(k,v){headers.set(k,v);},writeHead(code,values){status=code;for(const [k,v] of Object.entries(values))headers.set(k,v);this.headersSent=true;},end(content){resolve(new Response(request.method==='HEAD'?null:content??null,{status,headers}));}};
        const req={url:request.url,method:request.method,headers:Object.fromEntries(request.headers),socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},async *[Symbol.asyncIterator](){if(request.body){for await(const chunk of request.body)yield Buffer.from(chunk);}}};
        this.app.handler(req,response).catch(reject);
      });
    }catch(error){console.error('Commerce unavailable:',error.message);return Response.json({error:'Loja indisponível. Confira APP_URL, ADMIN_EMAIL e ADMIN_PASSWORD na configuração do Worker.'},{status:503});}
  }
  async maintenance(){await this.initialize();this.app.shop.expire();await this.app.recovery.flush();}
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/') || path.startsWith('/media/'))return env.STORE.getByName('primary').fetch(request);
    const response=await env.ASSETS.fetch(request);
    const headers=new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(env.STORE.getByName('primary').maintenance());}
};
