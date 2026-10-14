import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { transaction } from './db.mjs';
import { token,hash,now,passwordHash,email,requireThat } from './security.mjs';
export function passwordRecovery(db,config,mailer) {
  const demo=config.mode==='demo';
  const mode=db.prepare('SELECT value FROM local_secrets WHERE name=?').get('email-mode')?.value;
  if(mode && mode!==config.mode)transaction(db,()=>{db.prepare('DELETE FROM password_resets').run();db.prepare('DELETE FROM email_outbox').run();});
  db.prepare('INSERT INTO local_secrets VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('email-mode',config.mode);
  if(!config.emailKey && demo) {db.prepare('INSERT OR IGNORE INTO local_secrets VALUES(?,?)').run('demo-email-key',randomBytes(32).toString('hex'));}
  const secret=config.emailKey || (demo?db.prepare('SELECT value FROM local_secrets WHERE name=?').get('demo-email-key').value:null);
  const key=secret?Buffer.from(secret,'hex'):null;let running=false;
  function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const content=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:content.toString('hex')});}
  function decrypt(value){const p=JSON.parse(value),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'hex'));decipher.setAuthTag(Buffer.from(p.tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(p.data,'hex')),decipher.final()]).toString('utf8');}
  return {
    request(input) {
      requireThat(demo || (key && config.resendKey && config.emailFrom),503,'Recuperação por e-mail ainda não configurada.');
      const address=email(input),u=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(address);
      const result={message:'Se houver uma conta ativa com este e-mail, enviaremos as instruções de recuperação.'};
      if(!u)return result;
      // Evita bombardeio por e-mail, sem revelar se a conta existe.
      if(db.prepare('SELECT id FROM email_outbox WHERE user_id=? AND created_at>?').get(u.id,new Date(Date.now()-60000).toISOString()))return result;
      const raw=token(),id=token(),time=now(),expires=new Date(Date.now()+30*60000).toISOString();
      const link=`${config.url}/#reset-password/${raw}`;
      transaction(db,()=>{
        db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(time,u.id);
        db.prepare('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL').run(u.id);
        db.prepare('INSERT INTO password_resets VALUES(?,?,?,NULL,?)').run(hash(raw),u.id,expires,time);
        db.prepare('INSERT INTO email_outbox(id,user_id,recipient,subject,encrypted,next_attempt,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,u.id,u.email,`Recuperação de senha · ${config.storeName}`,encrypt(`Olá, ${u.name}.\n\nPara criar uma nova senha, abra:\n${link}\n\nO link expira em 30 minutos e pode ser usado uma vez. Se você não solicitou, ignore este e-mail.`),time,expires,time);
      });
      return result;
    },
    async reset(raw,password) {
      requireThat(typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw),400,'Link inválido ou expirado.');
      const passwordValue=await passwordHash(password);
      return transaction(db,()=>{
        const row=db.prepare('SELECT r.*,u.active FROM password_resets r JOIN users u ON u.id=r.user_id WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash(raw),now());
        requireThat(row?.active,400,'Link inválido, expirado ou já utilizado.');
        db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordValue,row.user_id);
        db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(now(),row.user_id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
        db.prepare('DELETE FROM email_outbox WHERE user_id=? AND sent_at IS NULL').run(row.user_id);
        return {ok:true};
      });
    },
    async flush() {
      if(running || config.mode==='demo')return;running=true;
      try{
        for(const row of db.prepare('SELECT * FROM email_outbox WHERE sent_at IS NULL AND attempts<5 AND next_attempt<=? AND expires_at>? ORDER BY created_at LIMIT 10').all(now(),now())) {
          try{await mailer.send({id:row.id,to:row.recipient,subject:row.subject,text:decrypt(row.encrypted)});db.prepare("UPDATE email_outbox SET sent_at=?,encrypted='' WHERE id=?").run(now(),row.id);}
          catch{db.prepare('UPDATE email_outbox SET attempts=attempts+1,next_attempt=?,last_error=? WHERE id=?').run(new Date(Date.now()+2**row.attempts*60000).toISOString(),'Falha no provedor de e-mail. Verifique configuração e entrega.',row.id);}
        }
        db.prepare('DELETE FROM email_outbox WHERE expires_at<=?').run(now());db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(now());
      }finally{running=false;}
    },
    list() {return db.prepare('SELECT id,recipient,subject,attempts,sent_at,last_error,expires_at,created_at,encrypted FROM email_outbox ORDER BY created_at DESC LIMIT 100').all().map(row=>{const {encrypted,...safe}=row;return{...safe,...(config.mode==='demo'&&row.expires_at>now()?{preview:decrypt(encrypted)}:{})};});}
  };
}
export function emailProvider(config,fetcher=fetch) {
  return {async send(message){requireThat(config.resendKey && config.emailFrom,503,'Configure o provedor de e-mail.');
    const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.resendKey}`,'Content-Type':'application/json','Idempotency-Key':message.id},body:JSON.stringify({from:config.emailFrom,to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000)});
    requireThat(response.ok,502,'Falha no envio de e-mail.');return response.json();
  }};
}
