import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { transaction } from './db.mjs';
import { token,hash,now,passwordHash,email,requireThat } from './security.mjs';

// Only controlled messages from this module may reach the administrative queue.
// Provider bodies can contain personal data, credentials, or recovery links.
class EmailDeliveryError extends Error {}
const emailErrors={
  decrypt:'No se ha podido descifrar el mensaje. Revisa EMAIL_ENCRYPTION_KEY y solicita un nuevo enlace.',
  key:'Resend ha rechazado la clave de API. Revisa RESEND_API_KEY.',
  sender:'Resend ha rechazado el remitente o sus permisos. Revisa EMAIL_FROM, el dominio verificado y los permisos de la clave.',
  data:'Resend ha rechazado los datos del correo. Revisa EMAIL_FROM y la configuración del envío.',
  limit:'Resend ha limitado los envíos. Revisa la cuota y los límites de la cuenta.',
  unavailable:'Resend no está disponible. Se reintentará el envío.',
  network:'No se ha podido conectar con Resend. Se reintentará el envío.',
  response:'Resend ha devuelto una respuesta no válida. Revisa sus registros antes de repetir el envío.'
};
function resendError(status,payload){
  if(['daily_quota_exceeded','monthly_quota_exceeded','rate_limit_exceeded'].includes(payload?.name)||status===429)return emailErrors.limit;
  if(status===401||['missing_api_key','restricted_api_key','suspended_api_key'].includes(payload?.name)||payload?.message==='API key is invalid')return emailErrors.key;
  if(status===403)return emailErrors.sender;
  if(status===400||status===422)return emailErrors.data;
  return status>=500?emailErrors.unavailable:emailErrors.response;
}
export function passwordRecovery(db,config,mailer) {
  const demo=config.mode==='demo';
  const mode=db.prepare('SELECT value FROM local_secrets WHERE name=?').get('email-mode')?.value;
  if(mode && mode!==config.mode)transaction(db,()=>{db.prepare('DELETE FROM password_resets').run();db.prepare('DELETE FROM email_outbox').run();});
  db.prepare('INSERT INTO local_secrets VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('email-mode',config.mode);
  if(!config.emailKey && demo) {db.prepare('INSERT OR IGNORE INTO local_secrets VALUES(?,?)').run('demo-email-key',randomBytes(32).toString('hex'));}
  const secret=config.emailKey || (demo?db.prepare('SELECT value FROM local_secrets WHERE name=?').get('demo-email-key').value:null);
  const key=secret?Buffer.from(secret,'hex'):null;let running=null,flushAgain=false;
  function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const content=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:content.toString('hex')});}
  function decrypt(value){const p=JSON.parse(value),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'hex'));decipher.setAuthTag(Buffer.from(p.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(p.data,'hex')),decipher.final()]).toString('utf8');}
  return {
    request(input) {
      requireThat(demo || (key && config.resendKey && config.emailFrom),503,'La recuperación por correo electrónico aún no está configurada.');
      const address=email(input),u=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(address);
      const result={message:'Si existe una cuenta activa con este correo electrónico, enviaremos las instrucciones para recuperar la contraseña.'};
      if(!u)return result;
      // Evita el envío masivo de correos sin revelar si la cuenta existe.
      if(db.prepare('SELECT id FROM email_outbox WHERE user_id=? AND created_at>?').get(u.id,new Date(Date.now()-60000).toISOString()))return result;
      const raw=token(),id=token(),time=now(),expires=new Date(Date.now()+30*60000).toISOString();
      const link=`${config.url}/#reset-password/${raw}`;
      transaction(db,()=>{
        db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(time,u.id);
        db.prepare('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL').run(u.id);
        db.prepare('INSERT INTO password_resets VALUES(?,?,?,NULL,?)').run(hash(raw),u.id,expires,time);
        db.prepare('INSERT INTO email_outbox(id,user_id,recipient,subject,encrypted,next_attempt,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,u.id,u.email,`Recuperación de contraseña · ${config.storeName}`,encrypt(`Hola, ${u.name}.\n\nPara crear una nueva contraseña, abre:\n${link}\n\nEl enlace caduca en 30 minutos y solo puede utilizarse una vez. Si no lo has solicitado, ignora este correo.`),time,expires,time);
      });
      return result;
    },
    async reset(raw,password) {
      requireThat(typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw),400,'Enlace no válido o caducado.');
      const passwordValue=await passwordHash(password);
      return transaction(db,()=>{
        const row=db.prepare('SELECT r.*,u.active FROM password_resets r JOIN users u ON u.id=r.user_id WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash(raw),now());
        requireThat(row?.active,400,'Enlace no válido, caducado o ya utilizado.');
        db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordValue,row.user_id);
        db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now(),row.user_id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
        db.prepare('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL').run(row.user_id);
        return {ok:true};
      });
    },
    async flush() {
      if(config.mode==='demo')return;
      if(running){flushAgain=true;return running;}
      running=Promise.resolve().then(async()=>{
        do{
          flushAgain=false;
          const rows=db.prepare('SELECT * FROM email_outbox WHERE sent_at IS NULL AND attempts<5 AND next_attempt<=? AND expires_at>? ORDER BY created_at LIMIT 10').all(now(),now());
          for(const row of rows){
            try{
              let content;
              try{content=decrypt(row.encrypted);}catch{throw new EmailDeliveryError(emailErrors.decrypt);}
              await mailer.send({id:row.id,to:row.recipient,subject:row.subject,text:content});
              db.prepare("UPDATE email_outbox SET sent_at=?,encrypted='',last_error=NULL WHERE id=?").run(now(),row.id);
            }catch(error){
              const message=error instanceof EmailDeliveryError?error.message:'Error del proveedor de correo electrónico. Revisa la configuración y la entrega.';
              db.prepare('UPDATE email_outbox SET attempts=attempts+1,next_attempt=?,last_error=? WHERE id=?').run(new Date(Date.now()+2**row.attempts*60000).toISOString(),message,row.id);
            }
          }
          if(rows.length===10)flushAgain=true;
        }while(flushAgain);
        db.prepare('DELETE FROM email_outbox WHERE expires_at<=?').run(now());db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(now());
      }).finally(()=>{running=null;});
      return running;
    },
    list() {return db.prepare('SELECT id,recipient,subject,attempts,sent_at,last_error,expires_at,created_at,encrypted FROM email_outbox ORDER BY created_at DESC LIMIT 100').all().map(row=>{const {encrypted,...safe}=row;return{...safe,...(config.mode==='demo'&&row.expires_at>now()?{preview:decrypt(encrypted)}:{})};});}
  };
}
export function emailProvider(config,fetcher=fetch) {
  return {async send(message){requireThat(config.resendKey && config.emailFrom,503,'Configura el proveedor de correo electrónico.');
    let response;
    try{response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${config.resendKey}`,'Content-Type':'application/json','Idempotency-Key':message.id},body:JSON.stringify({from:config.emailFrom,to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000)});}
    catch{throw new EmailDeliveryError(emailErrors.network);}
    // Workers supports manual redirects; never forward credentials to a 3xx destination.
    if(response.status>=300&&response.status<400)throw new EmailDeliveryError(emailErrors.response);
    let result;try{result=await response.json();}catch{if(response.ok)throw new EmailDeliveryError(emailErrors.response);}
    if(!response.ok)throw new EmailDeliveryError(resendError(response.status,result));
    if(typeof result?.id!=='string'||!result.id.length||result.id.length>200)throw new EmailDeliveryError(emailErrors.response);
    return result;
  }};
}
