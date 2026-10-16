import jpeg from 'jpeg-js';
import { requireThat } from '../src/security.mjs';
export async function processImage(bytes){
  // El editor convierte JPEG, PNG y WebP a un JPEG de tamaño limitado antes de subirlo.
  // Se vuelve a decodificar en el servidor para validar la entrada y eliminar los metadatos.
  const image=jpeg.decode(bytes,{maxResolutionInMP:2,maxMemoryUsageInMB:32,useTArray:true});
  requireThat(image.width<=1280 && image.height<=1280,400,'Reduce la foto a un máximo de 1280 × 1280 píxeles.');
  return Buffer.from(jpeg.encode(image,85).data);
}
