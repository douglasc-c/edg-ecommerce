import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { database, transaction } from './db.mjs';
import { providers } from './providers.mjs';
import { commerce } from './commerce.mjs';
import { savePhoto } from './media.mjs';
import { passwordRecovery,emailProvider } from './password-reset.mjs';
import { fiscalProvider,invoiceService } from './invoices.mjs';
import { sendcloudProvider } from './sendcloud.mjs';
import { europeShipping } from './europe-shipping.mjs';
import { campaignVideoPaths, campaignVideoResponse } from './video-response.mjs';
import { suggestLanguage } from './language.mjs';
import { HttpError, requireThat, text, integer, email, postal, passwordHash, passwordMatches, roles, permissions, token, hash, now } from './security.mjs';
export function configuration(env=process.env) {
  const c={url:(env.APP_URL||'http://localhost:3000').replace(/\/$/,''),mode:env.COMMERCE_MODE||'demo',production:env.NODE_ENV==='production',reservationMinutes:Number(env.RESERVATION_MINUTES||30),storeName:env.STORE_NAME||'EDG Commerce',mpToken:env.MERCADO_PAGO_ACCESS_TOKEN,mpSecret:env.MERCADO_PAGO_WEBHOOK_SECRET,collectorId:env.MERCADO_PAGO_COLLECTOR_ID,meToken:env.MELHOR_ENVIO_TOKEN,meSecret:env.MELHOR_ENVIO_WEBHOOK_SECRET,meSandbox:env.MELHOR_ENVIO_SANDBOX!=='false',originPostal:env.ORIGIN_POSTAL_CODE,supportEmail:env.SUPPORT_EMAIL,shippingFrom:env.SHIPPING_FROM_JSON?JSON.parse(env.SHIPPING_FROM_JSON):null};
  Object.assign(c,{resendKey:env.RESEND_API_KEY,emailFrom:env.EMAIL_FROM,emailKey:env.EMAIL_ENCRYPTION_KEY,nfeToken:env.FOCUS_NFE_TOKEN,nfeEnvironment:env.NFE_ENVIRONMENT||'homologation',nfeEmitter:env.NFE_EMITTER_JSON?JSON.parse(env.NFE_EMITTER_JSON):null,nfeDefaults:env.NFE_DEFAULTS_JSON?JSON.parse(env.NFE_DEFAULTS_JSON):null});
  requireThat(['homologation','production'].includes(c.nfeEnvironment),500,'NFE_ENVIRONMENT no válido.');
  requireThat(!c.emailKey || /^[a-f0-9]{64}$/i.test(c.emailKey),500,'EMAIL_ENCRYPTION_KEY debe contener 32 bytes en hexadecimal.');
  requireThat(['demo','catalog','live'].includes(c.mode),500,'COMMERCE_MODE debe ser demo, catalog o live.');
  requireThat(Number.isInteger(c.reservationMinutes) && c.reservationMinutes>=5 && c.reservationMinutes<=1440,500,'RESERVATION_MINUTES no válido.');
  const u=new URL(c.url); requireThat(['http:','https:'].includes(u.protocol) && u.pathname==='/' && !u.search && !u.hash && !u.username && !u.password,500,'APP_URL debe ser un origen HTTP válido.');
  if(c.production) requireThat(u.protocol==='https:' && (c.mode==='catalog' || (c.mode==='live' && c.mpToken && c.mpSecret && c.collectorId && c.meToken && c.originPostal && c.supportEmail && !c.meSandbox)),500,'La producción requiere HTTPS y el modo catalog, o el modo live con las credenciales completas.');
  requireThat(['BRL','EUR'].includes(env.STORE_CURRENCY||'BRL'),500,'STORE_CURRENCY no válida.');
  c.currency=env.STORE_CURRENCY||'BRL';
  c.shippingProvider=env.SHIPPING_PROVIDER||(c.currency==='EUR'?'sendcloud':'melhorenvio');
  requireThat(['sendcloud','melhorenvio'].includes(c.shippingProvider),500,'SHIPPING_PROVIDER debe ser sendcloud o melhorenvio.');
  c.sendcloud={environment:env.SENDCLOUD_ENVIRONMENT||'test',publicKey:env.SENDCLOUD_PUBLIC_KEY,
    secretKey:env.SENDCLOUD_SECRET_KEY,webhookSecret:env.SENDCLOUD_WEBHOOK_SECRET||env.SENDCLOUD_SECRET_KEY,
    senderAddressId:env.SENDCLOUD_SENDER_ADDRESS_ID===undefined?undefined:String(env.SENDCLOUD_SENDER_ADDRESS_ID).trim()};
  requireThat(['test','live'].includes(c.sendcloud.environment),500,'SENDCLOUD_ENVIRONMENT debe ser test o live.');
  requireThat(!c.sendcloud.senderAddressId||/^[1-9]\d{0,14}$/.test(String(c.sendcloud.senderAddressId)),500,'SENDCLOUD_SENDER_ADDRESS_ID debe ser un identificador numérico positivo.');
  if(c.mode!=='catalog')requireThat(c.currency==='BRL',500,'El checkout en EUR está pendiente de la integración europea. Usa el modo catalog.');
  return c;
}
export function createApp({db=database(),config=configuration(),provider=providers(config),mailer=emailProvider(config),fiscal=fiscalProvider(config),europeProvider=sendcloudProvider(config),runtime='node'}={}) {
  const shop=commerce(db,config,provider), buckets=new Map();
  const recovery=passwordRecovery(db,config,mailer),invoices=invoiceService(db,config,fiscal,shop);
  const europe=europeShipping(db,config,europeProvider);
  const get=(sql,...args)=>db.prepare(sql).get(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
  function limited(req,name,limit=30) {
    const key=`${name}:${req.socket.remoteAddress}`, time=Date.now(); let bucket=buckets.get(key);
    if(!bucket || bucket.until<time) {bucket={n:0,until:time+60000}; buckets.set(key,bucket);}
    requireThat(++bucket.n<=limit,429,'Demasiados intentos. Espera un minuto.');
    if(buckets.size>10000) for(const [key,b] of buckets) if(b.until<time) buckets.delete(key);
  }
  async function body(req) {
    requireThat(String(req.headers['content-type']||'').split(';')[0]==='application/json',415,'Envía application/json.');
    let size=0, chunks=[]; for await(const chunk of req) {size+=chunk.length; requireThat(size<=65536,413,'Solicitud demasiado grande.'); chunks.push(chunk);}
    try {const b=JSON.parse(Buffer.concat(chunks).toString()); requireThat(b && typeof b==='object' && !Array.isArray(b),400,'JSON no válido.'); return b;}
    catch(e) {if(e instanceof HttpError) throw e; throw new HttpError(400,'JSON no válido.');}
  }
  function session(req,required=true) {
    const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
    const s=cookies.edg_session?get('SELECT s.csrf,s.token,u.id,u.name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?',hash(cookies.edg_session),now()):null;
    requireThat(!required || (s && s.active),401,'Inicia sesión en tu cuenta para continuar.');
    return s?.active?s:null;
  }
  function allowed(user,permission) {requireThat(user && permissions[user.role]?.includes(permission),403,'Tu perfil no tiene acceso a esta operación.');}
  function publicUser(u) {return {id:u.id,name:u.name,email:u.email,role:u.role,permissions:permissions[u.role]};}
  function cookie(value,maxAge) {return `edg_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.production?'; Secure':''}`;}
  async function route(req,res,url) {
    const path=url.pathname, method=req.method;
    function sanitize(data) {
      if(Array.isArray(data)) return data.map(sanitize);
      if(!data || typeof data!=='object') return data;
      const result=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,sanitize(value)]));
      if(result.items && result.payment_status) {
        const viewer=session(req,false);
        delete result.request_hash;delete result.idempotency_key;
        if(!viewer || viewer.role==='customer') {
          for(const key of ['payment_id','preference_id','label_id','label_url','shipping_data']) delete result[key];
        }
        if(!viewer || !['admin','finance','inventory'].includes(viewer.role)) for(const item of result.items)delete item.cost;
        if(!viewer || viewer.role==='customer')for(const item of result.items)delete item.fiscal;
        result.invoice=invoices.get(result.id);
      }
      return result;
    }
    const respond=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(sanitize(data)));};
    if(path==='/api/health' && method==='GET') return respond({status:'ok'});
    if(path==='/api/config' && method==='GET') return respond({name:config.storeName,mode:config.mode,language:'es',locale:'es-ES',...suggestLanguage({country:runtime==='worker'?req.country:null,acceptLanguage:req.headers['accept-language']}),currency:config.currency||'BRL',checkout_enabled:config.mode!=='catalog',payment:config.currency==='EUR'?'Pendiente de integración':'Mercado Pago',shipping:config.shippingProvider==='sendcloud'?'Sendcloud':'Melhor Envio',shipping_provider:config.shippingProvider,shipping_environment:config.sendcloud?.environment||'test',fiscal_environment:config.mode==='demo'?'demo':config.nfeEnvironment,email_enabled:config.mode==='demo'||Boolean(config.resendKey&&config.emailFrom&&config.emailKey)});
    if(path==='/api/products' && method==='GET') {shop.expire(); return respond(shop.products());}
    if(path==='/api/categories' && method==='GET') return respond(shop.categories().map(({name,image})=>({name,image})));
    if(path==='/api/auth/me' && method==='GET') {const u=session(req,false);return respond({user:u?publicUser(u):null,csrf:u?.csrf||null});}
    if(path==='/api/webhooks/sendcloud' && method==='POST') {
      requireThat(config.shippingProvider==='sendcloud',503,'La integración Sendcloud no está activada.');
      limited(req,'sendcloud-webhook',120);
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;requireThat(size<=262144,413,'Solicitud demasiado grande.');chunks.push(chunk);}
      return respond(await europe.webhook(req.headers,Buffer.concat(chunks)));
    }
    if(config.mode==='catalog' && ((path.startsWith('/api/webhooks/')) || (method!=='GET' && (path.startsWith('/api/cart/') || path==='/api/shipping/quote' || path==='/api/checkout' || /^\/api\/orders\/[^/]+\/(demo-pay|payment)$/.test(path)))))throw new HttpError(503,'Tienda en preparación. Las compras aún no están disponibles.');
    if(path==='/api/webhooks/melhorenvio' && method==='POST') {
      limited(req,'shipping-webhook',120); let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;requireThat(size<=65536,413,'Solicitud demasiado grande.');chunks.push(chunk);}
      const raw=Buffer.concat(chunks);provider.verifyShippingWebhook(req.headers,raw);
      let payload;try{payload=JSON.parse(raw.toString());}catch{throw new HttpError(400,'JSON no válido.');}
      requireThat(payload.event?.startsWith('order.') && payload.data?.id && payload.data?.status,400,'Evento no válido.');
      // Se ignoran los eventos de etiquetas que no pertenecen a la tienda.
      if(get('SELECT id FROM orders WHERE label_id=?',payload.data.id)) shop.applyTracking(payload.data.id,payload.data);
      return respond({received:true});
    }
    if(path==='/api/webhooks/mercadopago'  && method==='POST') {
      limited(req,'webhook',120); const id=provider.verifyWebhook(req.headers,url);
      // Se consulta la API del proveedor; nunca se confía en el estado enviado por el cliente.
      const payment=await provider.payment(id); shop.applyPayment(payment); return respond({received:true});
    }
    const mutation=!['GET','HEAD'].includes(method);
    if(mutation) {
      requireThat(req.headers.origin===new URL(config.url).origin,403,'Origen no permitido.');
      limited(req,'write',120);
    }
    if(path==='/api/auth/forgot-password' && method==='POST') {limited(req,'password-recovery',5);const b=await body(req);return respond(recovery.request(b.email));}
    if(path==='/api/auth/reset-password' && method==='POST') {limited(req,'password-reset',10);const b=await body(req);await recovery.reset(b.token,b.password);res.setHeader('Set-Cookie',cookie('',0));return respond({ok:true});}
    if(['/api/auth/register','/api/auth/login'].includes(path) && method==='POST') {
      limited(req,'auth',10); const input=await body(req); const e=email(input.email); let u;
      if(path.endsWith('register')) {
        const name=text(input.name,'Nombre',2,100), pwd=await passwordHash(input.password);
        requireThat(!get('SELECT id FROM users WHERE email=?',e),409,'Correo electrónico ya registrado.');
        const id=randomUUID(); run('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)',id,name,e,pwd,'customer',now());
        u=get('SELECT * FROM users WHERE id=?',id);
      } else {
        u=get('SELECT * FROM users WHERE email=?',e);
        // Se deriva también para usuarios inexistentes para reducir las diferencias de tiempo.
        const fallback='0123456789abcdef0123456789abcdef:'+ '00'.repeat(64);
        const matches=await passwordMatches(input.password,u?.password||fallback);
        requireThat(u?.active && matches,401,'Correo electrónico o contraseña incorrectos.');
      }
      const raw=token(),csrf=token(); run('INSERT INTO sessions VALUES(?,?,?,?)',hash(raw),u.id,csrf,new Date(Date.now()+86400000).toISOString());
      res.setHeader('Set-Cookie',cookie(raw,86400)); return respond({user:publicUser(u),csrf},path.endsWith('register')?201:200);
    }
    const user=session(req);
    if(mutation) requireThat(req.headers['x-csrf-token']===user.csrf,403,'Sesión no válida. Actualiza la página.');
    if(path==='/api/auth/logout' && method==='POST') {run('DELETE FROM sessions WHERE token=?',user.token);res.setHeader('Set-Cookie',cookie('',0));return respond({ok:true});}
    if(path==='/api/auth/password' && method==='POST') {
      const b=await body(req),u=get('SELECT * FROM users WHERE id=?',user.id); requireThat(await passwordMatches(b.current_password,u.password),401,'Contraseña actual incorrecta.');
      const pwd=await passwordHash(b.password); transaction(db,()=>{run('UPDATE users SET password=? WHERE id=?',pwd,user.id);run('DELETE FROM sessions WHERE user_id=?',user.id);run('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL',now(),user.id);run('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL',user.id);});res.setHeader('Set-Cookie',cookie('',0));return respond({ok:true});
    }
    if(path==='/api/cart' && method==='GET') return respond(shop.cart(user.id));
    let match;
    if((match=path.match(/^\/api\/cart\/([^/]+)$/)) && method==='PUT') {const b=await body(req);return respond(shop.setCart(user,match[1],b.quantity));}
    if(path==='/api/shipping/quote' && method==='POST') {const b=await body(req);return respond(await shop.quote(user,postal(b.postal_code)));}
    if(path==='/api/coupons/check' && method==='POST') {const b=await body(req);shop.expire();return respond(shop.coupons.calculate(user,shop.cart(user.id).subtotal,b.code));}
    if(path==='/api/checkout' && method==='POST') return respond(await shop.checkout(user,await body(req),req.headers['idempotency-key']),201);
    if(path==='/api/orders' && method==='GET') return respond(shop.listOrders(user));
    if((match=path.match(/^\/api\/orders\/([^/]+)\/invoice\/(pdf|xml)$/)) && method==='GET'){const [_,id,kind]=match;shop.order(id,user,permissions[user.role]?.includes('orders'));const content=await invoices.download(id,kind);res.writeHead(200,{'Content-Type':kind==='pdf'?'application/pdf':'application/xml','Content-Disposition':`attachment; filename="nfe-${id}.${kind}"`,'Cache-Control':'no-store'});return res.end(content);}
    if((match=path.match(/^\/api\/orders\/([^/]+)$/)) && method==='GET') return respond(shop.order(match[1],user));
    if((match=path.match(/^\/api\/orders\/([^/]+)\/(cancel|demo-pay|payment)$/)) && method==='POST') {
      const [_,id,action]=match;
      return respond(action==='cancel'?shop.cancel(user,id):action==='demo-pay'?shop.demoPay(user,id):await shop.paymentLink(user,id));
    }
    requireThat(path.startsWith('/api/admin/'),404,'Ruta no encontrada.');
    if(path.startsWith('/api/admin/europe-shipping/')) {
      allowed(user,'shipping');
      requireThat(config.shippingProvider==='sendcloud',503,'La integración Sendcloud no está activada.');
      if(path==='/api/admin/europe-shipping/status' && method==='GET')return respond(europe.status());
      if(path==='/api/admin/europe-shipping/check' && method==='POST')return respond(await europe.checkConnection());
      if(path==='/api/admin/europe-shipping/quote' && method==='POST')return respond(await europe.quote(user,await body(req)));
      if(path==='/api/admin/europe-shipping/shipments' && method==='GET')return respond(europe.list());
      if(path==='/api/admin/europe-shipping/shipments' && method==='POST')return respond(await europe.create(user,await body(req),req.headers['idempotency-key']),201);
      const shipmentPath=path.match(/^\/api\/admin\/europe-shipping\/shipments\/([^/]+)(?:\/(sync|label))?$/);
      if(shipmentPath){
        const [,id,action]=shipmentPath;
        if(!action&&method==='GET')return respond(europe.get(id));
        if(action==='sync'&&method==='POST')return respond(await europe.sync(user,id));
        if(action==='label'&&method==='GET'){
          const content=await europe.download(id);
          res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="envio-${id.replace(/[^A-Za-z0-9-]/g,'')}.pdf"`,'Cache-Control':'no-store'});
          return res.end(content);
        }
      }
      throw new HttpError(404,'Ruta de envío no encontrada.');
    }
    if(path==='/api/admin/media' && method==='POST') {allowed(user,'catalog');let size=0;const chunks=[];for await(const c of req){size+=c.length;requireThat(size<=5*1024*1024,413,'La foto no debe superar los 5 MB.');chunks.push(c);}const result=await savePhoto(db,user,Buffer.concat(chunks),String(req.headers['content-type']||'').split(';')[0]);shop.audit(user.id,'media.upload',result.id);return respond(result,201);}
    if(path==='/api/admin/coupons' && method==='GET') {allowed(user,'coupons');return respond(shop.coupons.list());}
    if(path==='/api/admin/coupons' && method==='POST') {allowed(user,'coupons');return respond(shop.coupons.save(user,await body(req)),201);}
    if((match=path.match(/^\/api\/admin\/coupons\/([^/]+)$/)) && method==='PATCH') {allowed(user,'coupons');const b=await body(req);return respond(shop.coupons.toggle(user,match[1],b.active));}
    if(path==='/api/admin/emails' && method==='GET') {allowed(user,'users');return respond(recovery.list());}
    if(path==='/api/admin/invoices' && method==='GET') {allowed(user,'invoices');return respond(invoices.list());}
    if((match=path.match(/^\/api\/admin\/orders\/([^/]+)\/invoice-preview$/)) && method==='GET') {allowed(user,'invoices');return respond(invoices.preview(user,match[1]));}
    if((match=path.match(/^\/api\/admin\/orders\/([^/]+)\/invoice$/)) && method==='POST') {allowed(user,'invoices');const b=await body(req),id=match[1];return respond(b.action==='consult'?await invoices.consult(user,id):b.action==='cancel'?await invoices.cancel(user,id,b.reason):b.action==='emit'?await invoices.emit(user,id,b.fiscal||{}):(()=>{throw new HttpError(400,'Acción fiscal no válida.');})());}
    if(path==='/api/admin/dashboard' && method==='GET') {allowed(user,'dashboard');return respond(shop.dashboard(user));}
    if(path==='/api/admin/categories' && method==='GET') {allowed(user,'catalog');return respond(shop.categories());}
    if(path==='/api/admin/categories' && method==='POST') {allowed(user,'catalog');return respond(shop.saveCategory(user,await body(req)),201);}
    if(path==='/api/admin/categories' && method==='DELETE') {allowed(user,'catalog');const b=await body(req);return respond(shop.deleteCategory(user,b.name));}
    if(path==='/api/admin/products' && method==='GET') {allowed(user,'catalog');return respond(shop.products(true));}
    if(path==='/api/admin/products' && method==='POST') {allowed(user,'catalog');return respond(shop.saveProduct(user,await body(req)),201);}
    if((match=path.match(/^\/api\/admin\/products\/([^/]+)$/)) && method==='PUT') {allowed(user,'catalog');return respond(shop.saveProduct(user,await body(req),match[1]));}
    if((match=path.match(/^\/api\/admin\/products\/([^/]+)$/)) && method==='DELETE') {allowed(user,'catalog');return respond(shop.deleteProduct(user,match[1]));}
    if((match=path.match(/^\/api\/admin\/products\/([^/]+)\/stock$/)) && method==='POST') {allowed(user,'stock');const b=await body(req);return respond(shop.stock(user,match[1],b.delta,b.reason));}
    if(path==='/api/admin/movements' && method==='GET') {allowed(user,'stock');return respond(shop.movements());}
    if(path==='/api/admin/orders' && method==='GET') {allowed(user,'orders');return respond(shop.listOrders(user,true));}
    if((match=path.match(/^\/api\/admin\/orders\/([^/]+)\/(status|cancel|refund|label|tracking)$/)) && method==='POST') {
      const [_,id,action]=match; allowed(user,action==='refund'?'finance':'shipping');
      if(action==='cancel') return respond(shop.cancel(user,id,true));
      if(action==='refund') return respond(await shop.refund(user,id));
      if(action==='tracking') return respond(await shop.syncTracking(user,id));
      const b=await body(req);return respond(action==='label'?await shop.label(user,id,b.action,b):shop.status(user,id,b.status,b));
    }
    if(path==='/api/admin/finance' && method==='GET') {allowed(user,'finance');return respond(shop.ledger());}
    if(path==='/api/admin/expenses' && method==='POST') {allowed(user,'finance');return respond(shop.expense(user,await body(req),req.headers['idempotency-key']),201);}
    if(path==='/api/admin/audit' && method==='GET') {allowed(user,'audit');return respond(shop.audits());}
    if(path==='/api/admin/users' && method==='GET') {allowed(user,'users');return respond(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at DESC LIMIT 200').all());}
    if(path==='/api/admin/users' && method==='POST') {
      allowed(user,'users'); const b=await body(req),e=email(b.email),name=text(b.name,'Nombre',2,100),pwd=await passwordHash(b.password);
      requireThat(roles.includes(b.role),400,'Perfil no válido.');requireThat(!get('SELECT id FROM users WHERE email=?',e),409,'Correo electrónico ya registrado.');
      const id=randomUUID();run('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)',id,name,e,pwd,b.role,now());shop.audit(user.id,'user.create',id,{role:b.role});return respond({id,name,email:e,role:b.role},201);
    }
    if((match=path.match(/^\/api\/admin\/users\/([^/]+)$/)) && method==='PATCH') {
      allowed(user,'users'); const b=await body(req),id=match[1];requireThat(roles.includes(b.role) && typeof b.active==='boolean',400,'Perfil o estado no válidos.');
      requireThat(id!==user.id,409,'No puedes modificar tu propio acceso.');requireThat(get('SELECT id FROM users WHERE id=?',id),404,'Usuario no encontrado.');
      transaction(db,()=>{run('UPDATE users SET role=?,active=? WHERE id=?',b.role,b.active?1:0,id);run('DELETE FROM sessions WHERE user_id=?',id);run('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL',now(),id);run('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL',id);shop.audit(user.id,'user.access',id,{role:b.role,active:b.active});});return respond({ok:true});
    }
    throw new HttpError(404,'Ruta no encontrada.');
  }
  const handler=async(req,res)=>{
    res.setHeader('Content-Language','es');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if(config.production) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,config.url);
      if(url.pathname.startsWith('/api/')) return await route(req,res,url);
      requireThat(req.method==='GET' || req.method==='HEAD',405,'Método no permitido.');
      if(/^\/media\/[a-f0-9]{64}\.jpg$/.test(url.pathname)){const id=url.pathname.slice(7,-4),photo=db.prepare('SELECT data FROM media WHERE id=?').get(id);requireThat(photo,404,'Foto no encontrada.');res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable'});return res.end(req.method==='HEAD'?undefined:Buffer.from(photo.data));}
      const files={'/':'index.html','/edg-hero-emblem.png':'edg-hero-emblem.png','/edg-hero-emblem-black.png':'edg-hero-emblem-black.png','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/edg-logo.png':'edg-logo.png','/edg-footer-logo.png':'edg-footer-logo.png','/edg-universe-background.webp':'edg-universe-background.webp','/edg-skate-campaign-960.webp':'edg-skate-campaign-960.webp','/edg-skate-campaign-1600.webp':'edg-skate-campaign-1600.webp'};
      files['/loading.css']='loading.css';
      files['/skate.css']='skate.css';
      files['/skate.js']='skate.js';
      files['/edg-skate-history-mosaic.webp']='edg-skate-history-mosaic.webp';
      files['/music.js']='music.js';
      files['/music.css']='music.css';
      for(const file of ['i18n.js','i18n-common.js','i18n-editorial.js'])files[`/${file}`]=file;
      for(const name of ['banda-hero','banda-hero-640','banda-live','rap-subterraneo','sobrenatural','mensageiro-do-corre','a-parada-e-o-movimento','achados-no-mundo-perdido','pratas-da-casa','aperta-o-play'])files[`/music/${name}.webp`]=`music/${name}.webp`;
      files['/edg-loading.js']='edg-loading.js';
      for(const id of ['g61','g99','63','121','197','221','240','257','15','19','28','47','55','92','101'])files[`/shape-${id}.webp`]=`shape-${id}.webp`;
      files['/edg-logo-tremor-loop.mp4']='edg-logo-tremor-loop.mp4';
      files['/edg-logo-tremor-poster.png']='edg-logo-tremor-poster.png';
      files['/edg-intro.mp4']='edg-intro.mp4';
      files['/edg-intro-poster.jpg']='edg-intro-poster.jpg';
      files['/edg-intro-animated.webp']='edg-intro-animated.webp';
      files['/edg-logo-tremor-animated.webp']='edg-logo-tremor-animated.webp';
      files['/edg-intro-mobile.mp4']='edg-intro-mobile.mp4';
      files['/edg-intro-mobile-animated.webp']='edg-intro-mobile-animated.webp';
      files['/edg-logo-tremor-mobile-animated.webp']='edg-logo-tremor-mobile-animated.webp';
      const filename=files[url.pathname];requireThat(filename,404,'Página no encontrada.');
      const content=await readFile(new URL(`../public/${filename}`,import.meta.url));
      if(campaignVideoPaths.has(url.pathname)){
        const response=campaignVideoResponse(req,content,{'Cache-Control':'no-cache'});
        res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(response.body??undefined);
      }
      res.writeHead(200,{'Content-Type':filename.endsWith('html')?'text/html; charset=utf-8':filename.endsWith('css')?'text/css; charset=utf-8':filename.endsWith('js')?'text/javascript; charset=utf-8':filename.endsWith('png')?'image/png':filename.endsWith('jpg')?'image/jpeg':filename.endsWith('webp')?'image/webp':filename.endsWith('mp4')?'video/mp4':'image/svg+xml','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
    }catch(e) {
      if(res.headersSent) return res.end();
      const status=e instanceof HttpError?e.status:500;
      if(status===500) console.error('Error en la solicitud:',e.name,e.code||'internal');
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:status===500?'Error interno. Inténtalo de nuevo.':e.message}));
    }
  };
  if(runtime==='worker') return {handler,db,shop,recovery,invoices,europe};
  const server=createServer(handler);
  server.requestTimeout=20000;server.headersTimeout=10000;
  const maintenance=setInterval(()=>{try{shop.expire();recovery.flush().catch(()=>console.error('Error en el mantenimiento de correos'));}catch(e){console.error('Error en el mantenimiento de reservas:',e.code||e.name);}},60000);maintenance.unref();
  server.on('close',()=>clearInterval(maintenance));
  return {server,db,shop,recovery,invoices,europe};
}
if(import.meta.url && process.argv[1]===fileURLToPath(import.meta.url)) {
  const app=createApp();app.shop.expire(); const port=Number(process.env.PORT||3000);
  app.server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`EDG Commerce en ${process.env.APP_URL||`http://localhost:${port}`}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.server.close(()=>{app.db.close();process.exit(0);}));
}
