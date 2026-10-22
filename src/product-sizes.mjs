import { requireThat } from './security.mjs';

const clothingCategories=/^(camisetas?|sudaderas?|moletom|moletons?)$/;
const normalizedCategory=category=>category.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function isClothingCategory(category) {return clothingCategories.test(normalizedCategory(category));}

export function categorySizes(category) {
  const name=normalizedCategory(category);
  if(clothingCategories.test(name))return ['S','L','XL','XXL'];
  if(/^gorras?$/.test(name))return ['Única','P/M','G/GG','54','55','56','57','58','59','60','61','62'];
  if(/^bones?$/.test(name))return ['Único','P/M','G/GG','54','55','56','57','58','59','60','61','62'];
  if(/^(tablas?|shapes?|shaipes?)$/.test(name))return ['7.5','7.75','7.875','8.0','8.125','8.25','8.375','8.5','8.75','9.0'];
  return [];
}

// `size` se mantiene para los clientes antiguos; `sizes` es la lista del producto.
export function productSizes(product) {
  const sizes=typeof product.sizes==='string'?JSON.parse(product.sizes):product.sizes;
  return Array.isArray(sizes) && sizes.length?[...sizes]:product.size?[product.size]:[];
}

export function productSizesForSave(input,category,current=null) {
  const previous=current?productSizes(current):[],sameCategory=current?.category===category;
  let sizes;
  if(input.sizes!==undefined) {
    requireThat(Array.isArray(input.sizes) && input.sizes.length<=20,400,'Selecciona hasta 20 tallas por producto.');
    sizes=Array.from(input.sizes,size=>{
      requireThat(typeof size==='string' && size.trim().length>0 && size.trim().length<=30,400,'Cada talla debe tener entre 1 y 30 caracteres.');
      return size.trim();
    });
    requireThat(new Set(sizes).size===sizes.length,400,'No repitas una talla en el mismo producto.');
  } else if(input.size!==undefined) {
    requireThat(typeof input.size==='string' && input.size.trim().length<=30,400,'Talla no válida.');
    const size=input.size.trim();
    // Un editor antiguo no debe borrar las demás tallas al guardar el primer valor.
    requireThat(previous.length<=1 || size===previous[0],409,'Este producto tiene varias tallas. Actualiza la selección completa de tallas para cambiarlas.');
    sizes=previous.length>1?previous:size?[size]:[];
  } else {
    sizes=previous;
    // Conserva también productos antiguos sin talla cuando el cliente no la edita.
    if(sameCategory)return sizes;
  }
  const allowed=categorySizes(category);
  if(allowed.length) {
    // Las listas de ropa se actualizan solo con las tallas disponibles. Los clientes
    // antiguos y las demás categorías conservan sus valores históricos al editar.
    const allowLegacy=!isClothingCategory(category) || input.sizes===undefined;
    requireThat(sizes.length>0 && sizes.every(size=>allowed.includes(size) || (allowLegacy && sameCategory && previous.includes(size))),400,'Selecciona una talla válida para la categoría.');
  }
  return sizes;
}
