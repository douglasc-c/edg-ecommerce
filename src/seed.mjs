import { randomUUID } from 'node:crypto';
import { database } from './db.mjs';
import { commerce } from './commerce.mjs';
import { passwordHash, email, requireThat, now } from './security.mjs';
import { configuration } from './server.mjs';
const db=database(),config=configuration();
requireThat(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD,400,'Define ADMIN_EMAIL y ADMIN_PASSWORD (12 caracteres o más).');
const e=email(process.env.ADMIN_EMAIL);let admin=db.prepare('SELECT * FROM users WHERE email=?').get(e);
if(!admin) {const id=randomUUID(),pwd=await passwordHash(process.env.ADMIN_PASSWORD);db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id,'Administrador EDG',e,pwd,'admin',now());admin=db.prepare('SELECT * FROM users WHERE id=?').get(id);}
requireThat(admin.role==='admin',409,'El correo electrónico configurado ya pertenece a otro perfil.');
const shop=commerce(db,config,{});
if(config.mode==='demo' && !db.prepare('SELECT COUNT(*) n FROM products').get().n) {
  const catalog=[['EDG-001','Mochila urbana','Esenciales','Compartimentos prácticos, acabado resistente y comodidad para acompañarte cada día.',18990,9500,24,'#d9e4d5','🎒'],['EDG-002','Botella térmica','Esenciales','Tu bebida a la temperatura adecuada. Acero inoxidable, tapa segura y capacidad de 750 ml.',8990,3900,38,'#f0ddd0','◉'],['EDG-003','Auriculares inalámbricos','Tecnología','Conexión sencilla, estuche compacto y sonido para trabajar o relajarte.',24990,13000,16,'#ddd9ee','♫'],['EDG-004','Lámpara de mesa','Casa','Luz acogedora, diseño sencillo e intensidad ajustable para tu espacio.',15990,7800,9,'#ede4c8','☀'],['EDG-005','Cuaderno esencial','Papelería','Páginas para ideas, planes y nuevos proyectos. Cubierta resistente y papel de calidad.',3990,1700,4,'#d3e3e8','▤'],['EDG-006','Organizador modular','Casa','Cada cosa en su sitio. Módulos que se adaptan a tu rutina.',6990,2900,18,'#e4d7cf','▥']];
  for(const [sku,name,category,description,price,cost,stock,color,icon] of catalog) {const p=shop.saveProduct(admin,{sku,name,category,description,price,cost,low_stock:5,weight:0.5,width:20,height:10,length:25,color,icon});shop.stock(admin,p.id,stock,'Existencias iniciales de demostración');}
}
console.log('Administrador preparado. El catálogo de demostración solo está disponible en modo demo.');db.close();
