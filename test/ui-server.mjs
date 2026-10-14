import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'edg-ui-'));
Object.assign(process.env,{NODE_ENV:'test',COMMERCE_MODE:'demo',APP_URL:'http://localhost:3100',DB_PATH:join(dir,'commerce.db'),ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD:'UI-exclusive-fixture-2026',PORT:'3100',HOST:'127.0.0.1'});
const result=spawnSync(process.execPath,['src/seed.mjs'],{env:process.env,stdio:'inherit'});if(result.status!==0)process.exit(1);
const { createApp }=await import('../src/server.mjs');const app=createApp();app.server.listen(3100,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}));
