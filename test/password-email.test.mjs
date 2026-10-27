import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../src/db.mjs';
import {passwordRecovery,emailProvider} from '../src/password-reset.mjs';
import {now} from '../src/security.mjs';

const config={mode:'catalog',url:'https://store.example.test',storeName:'EDG',emailKey:'a'.repeat(64),resendKey:'re-private-fixture-key',emailFrom:'EDG <reset@example.test>'};
function fixture(t,mailer){
  const db=database(':memory:');t.after(()=>db.close());
  const addUser=(address='customer@example.test')=>{
    const id=randomUUID();db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id,'Cliente',address,'unused','customer',now());return address;
  };
  const address=addUser(),recovery=passwordRecovery(db,config,mailer);
  return {db,address,addUser,recovery};
}

test('una solicitud durante un envío en curso también se entrega sin esperar al cron',async t=>{
  const started=Promise.withResolvers(),release=Promise.withResolvers(),sent=[];
  const f=fixture(t,{async send(message){sent.push(message);if(sent.length===1){started.resolve();await release.promise;}}});
  f.recovery.request(f.address);const first=f.recovery.flush();await started.promise;
  const secondAddress=f.addUser('second@example.test');f.recovery.request(secondAddress);const second=f.recovery.flush();
  release.resolve();await Promise.all([first,second]);
  assert.deepEqual(sent.map(message=>message.to),[f.address,secondAddress]);
  assert.ok(f.recovery.list().every(row=>row.sent_at));
  await f.recovery.flush();assert.equal(sent.length,2,'Una nueva ejecución no repite correos confirmados');
});

test('el inicio de entrega procesa más de diez correos pendientes sin duplicar ni perder mensajes',async t=>{
  const sent=[],f=fixture(t,{async send(message){sent.push(message.id);}});
  f.recovery.request(f.address);
  for(let index=0;index<11;index++)f.recovery.request(f.addUser(`queued-${index}@example.test`));
  await f.recovery.flush();
  assert.equal(sent.length,12);assert.equal(new Set(sent).size,12);
  assert.ok(f.recovery.list().every(row=>row.sent_at));
});

for(const [status,payload,expected] of [
  [400,{name:'validation_error',message:'API key is invalid'},/RESEND_API_KEY/],
  [401,{name:'validation_error'},/RESEND_API_KEY/],
  [403,{name:'restricted_api_key'},/RESEND_API_KEY/],
  [403,{name:'validation_error'},/EMAIL_FROM.*dominio verificado/],
  [422,{name:'validation_error'},/datos del correo/],
  [429,{name:'rate_limit_exceeded'},/cuota/],
  [403,{name:'daily_quota_exceeded'},/cuota/],
  [503,{name:'service_unavailable'},/no está disponible/],
])test(`el error Resend ${status}/${payload.name} queda identificado sin exponer su respuesta`,async t=>{
  const privateText=`${config.resendKey} customer@example.test #reset-password/${'b'.repeat(64)}`;
  const provider=emailProvider(config,async()=>Response.json({...payload,detail:privateText},{status}));
  const f=fixture(t,provider);f.recovery.request(f.address);await f.recovery.flush();
  const row=f.recovery.list()[0];
  assert.equal(row.attempts,1);assert.equal(row.sent_at,null);assert.equal(row.preview,undefined);
  assert.match(row.last_error,expected);
  for(const sensitive of [config.resendKey,f.address,'#reset-password/','detail'])assert.ok(!row.last_error.includes(sensitive));
});

test('un reintento conserva la idempotencia y borra el error y el contenido al confirmar el envío',async t=>{
  const calls=[];let fail=true;
  const provider=emailProvider(config,async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'manual');
    calls.push(options.headers['Idempotency-Key']);
    return fail?Response.json({name:'service_unavailable'},{status:503}):Response.json({id:'mail-accepted'});
  });
  const f=fixture(t,provider);f.recovery.request(f.address);await f.recovery.flush();
  assert.equal(f.recovery.list()[0].attempts,1);assert.match(f.recovery.list()[0].last_error,/Resend/);
  await f.recovery.flush();assert.equal(calls.length,1,'Se respeta el siguiente intento programado');
  f.db.prepare('UPDATE email_outbox SET next_attempt=?').run(now());fail=false;await f.recovery.flush();
  assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
  const row=f.recovery.list()[0];assert.ok(row.sent_at);assert.equal(row.last_error,null);
  assert.equal(f.db.prepare('SELECT encrypted FROM email_outbox').get().encrypted,'');
});

test('una clave de cifrado distinta diagnostica el fallo antes de llamar a Resend',async t=>{
  let sends=0;const mailer={async send(){sends++;}},f=fixture(t,mailer);
  f.recovery.request(f.address);
  const recovery=passwordRecovery(f.db,{...config,emailKey:'b'.repeat(64)},mailer);await recovery.flush();
  assert.equal(sends,0);assert.match(recovery.list()[0].last_error,/EMAIL_ENCRYPTION_KEY/);
});

for(const scenario of ['network','invalid-json','missing-id'])test(`un fallo ${scenario} no se registra como correo enviado`,async t=>{
  const provider=emailProvider(config,async()=>{
    if(scenario==='network')throw new Error('Bearer '+config.resendKey);
    return scenario==='invalid-json'?new Response('<html>upstream</html>'):Response.json({accepted:true});
  });
  const f=fixture(t,provider);f.recovery.request(f.address);await f.recovery.flush();
  const row=f.recovery.list()[0];assert.equal(row.sent_at,null);assert.equal(row.attempts,1);
  assert.match(row.last_error,scenario==='network'?/conectar con Resend/:/respuesta no válida/);
  assert.ok(!row.last_error.includes(config.resendKey));
});

test('la recuperación mantiene la respuesta genérica para cuentas ausentes y bloqueadas',async t=>{
  let sends=0;const f=fixture(t,{async send(){sends++;}});
  const absent=f.recovery.request('missing@example.test');
  f.db.prepare('UPDATE users SET active=0').run();assert.deepEqual(f.recovery.request(f.address),absent);
  await f.recovery.flush();assert.equal(sends,0);assert.deepEqual(f.recovery.list(),[]);
});

test('el modo demo sigue sin enviar correos al proveedor',async t=>{
  let sends=0;const mailer={async send(){sends++;}},f=fixture(t,mailer);
  const recovery=passwordRecovery(f.db,{...config,mode:'demo'},mailer);
  recovery.request(f.address);await recovery.flush();assert.equal(sends,0);assert.ok(recovery.list()[0].preview);
});

test('una redirección de Resend no reenvía credenciales ni confirma el correo',async t=>{
  let calls=0;
  const provider=emailProvider(config,async(url,options)=>{
    calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://untrusted.example.test/collect'}});
  });
  const f=fixture(t,provider);f.recovery.request(f.address);await f.recovery.flush();
  assert.equal(calls,1);assert.equal(f.recovery.list()[0].sent_at,null);assert.match(f.recovery.list()[0].last_error,/respuesta no válida/);
});
