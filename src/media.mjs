import { processImage } from './image-processor.mjs';
import { hash, now, requireThat, HttpError } from './security.mjs';
export async function savePhoto(db,user,bytes,mime) {
  requireThat(['image/jpeg','image/png','image/webp'].includes(mime),415,'Envie JPEG, PNG ou WebP.');
  requireThat(bytes.length>0 && bytes.length<=5*1024*1024,413,'A foto deve ter até 5 MB.');
  let output;
  try {
    output=await processImage(bytes);
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Imagem inválida ou com dimensões excessivas.');}
  const id=hash(output);db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?)').run(id,output,user.id,now());
  return{id,url:`/media/${id}.jpg`};
}
export function photoIds(db,ids) {
  requireThat(Array.isArray(ids) && ids.length<=8 && new Set(ids).size===ids.length,400,'Use até oito fotos diferentes por produto.');
  for(const id of ids)requireThat(typeof id==='string' && /^[a-f0-9]{64}$/.test(id) && db.prepare('SELECT id FROM media WHERE id=?').get(id),400,'Foto não encontrada.');
  return JSON.stringify(ids);
}
