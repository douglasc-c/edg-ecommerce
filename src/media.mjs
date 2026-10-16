import { processImage } from './image-processor.mjs';
import { hash, now, requireThat, HttpError } from './security.mjs';
export async function savePhoto(db,user,bytes,mime) {
  requireThat(['image/jpeg','image/png','image/webp'].includes(mime),415,'Sube un archivo JPEG, PNG o WebP.');
  requireThat(bytes.length>0 && bytes.length<=5*1024*1024,413,'La foto no debe superar los 5 MB.');
  let output;
  try {
    output=await processImage(bytes);
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Imagen no válida o con dimensiones excesivas.');}
  const id=hash(output);db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?)').run(id,output,user.id,now());
  return{id,url:`/media/${id}.jpg`};
}
export function photoIds(db,ids) {
  requireThat(Array.isArray(ids) && ids.length<=8 && new Set(ids).size===ids.length,400,'Usa hasta ocho fotos diferentes por producto.');
  for(const id of ids)requireThat(typeof id==='string' && /^[a-f0-9]{64}$/.test(id) && db.prepare('SELECT id FROM media WHERE id=?').get(id),400,'Foto no encontrada.');
  return JSON.stringify(ids);
}
