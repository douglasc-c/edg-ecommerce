import sharp from 'sharp';
import { requireThat } from './security.mjs';
export async function processImage(bytes) {
  const image=sharp(bytes,{limitInputPixels:25000000,animated:false});const meta=await image.metadata();
  requireThat(['jpeg','png','webp'].includes(meta.format),415,'Formato de imagen no permitido.');
  return image.rotate().flatten({background:'#ffffff'}).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
}
