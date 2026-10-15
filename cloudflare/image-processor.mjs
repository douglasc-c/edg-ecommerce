import jpeg from 'jpeg-js';
import { requireThat } from '../src/security.mjs';
export async function processImage(bytes){
  // The editor converts JPEG, PNG and WebP to a bounded JPEG before uploading.
  // Decode again on the server to validate input and discard metadata.
  const image=jpeg.decode(bytes,{maxResolutionInMP:2,maxMemoryUsageInMB:32,useTArray:true});
  requireThat(image.width<=1280 && image.height<=1280,400,'Reduza a foto para até 1280 × 1280 pixels.');
  return Buffer.from(jpeg.encode(image,85).data);
}
