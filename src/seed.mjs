import { randomUUID } from 'node:crypto';
import { database } from './db.mjs';
import { commerce } from './commerce.mjs';
import { passwordHash, email, requireThat, now } from './security.mjs';
import { configuration } from './server.mjs';
const db=database(),config=configuration();
requireThat(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD,400,'Defina ADMIN_EMAIL e ADMIN_PASSWORD (12 ou mais caracteres).');
const e=email(process.env.ADMIN_EMAIL);let admin=db.prepare('SELECT * FROM users WHERE email=?').get(e);
if(!admin) {const id=randomUUID(),pwd=await passwordHash(process.env.ADMIN_PASSWORD);db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id,'Administrador EDG',e,pwd,'admin',now());admin=db.prepare('SELECT * FROM users WHERE id=?').get(id);}
requireThat(admin.role==='admin',409,'O e-mail configurado já pertence a outro perfil.');
const shop=commerce(db,config,{});
if(config.mode==='demo' && !db.prepare('SELECT COUNT(*) n FROM products').get().n) {
  const catalog=[['EDG-001','Mochila urbana','Essenciais','Compartimentos inteligentes, acabamento resistente e conforto para acompanhar o seu dia.',18990,9500,24,'#d9e4d5','🎒'],['EDG-002','Garrafa térmica','Essenciais','Sua bebida na temperatura certa. Aço inox, tampa segura e capacidade de 750 ml.',8990,3900,38,'#f0ddd0','◉'],['EDG-003','Fone sem fio','Tecnologia','Conexão prática, estojo compacto e som para trabalhar ou relaxar.',24990,13000,16,'#ddd9ee','♫'],['EDG-004','Luminária de mesa','Casa','Luz acolhedora, design limpo e intensidade ajustável para o seu espaço.',15990,7800,9,'#ede4c8','☀'],['EDG-005','Caderno essencial','Papelaria','Páginas para ideias, planos e novos projetos. Capa resistente e papel de qualidade.',3990,1700,4,'#d3e3e8','▤'],['EDG-006','Organizador modular','Casa','Cada coisa no seu lugar. Módulos que se adaptam à sua rotina.',6990,2900,18,'#e4d7cf','▥']];
  for(const [sku,name,category,description,price,cost,stock,color,icon] of catalog) {const p=shop.saveProduct(admin,{sku,name,category,description,price,cost,low_stock:5,weight:0.5,width:20,height:10,length:25,color,icon});shop.stock(admin,p.id,stock,'Estoque inicial de demonstração');}
}
console.log('Administrador preparado. Catálogo de demonstração disponível apenas no modo demo.');db.close();
