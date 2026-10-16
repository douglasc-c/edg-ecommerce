export function categorySizes(category) {
  const name=category.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  // Las categorías y tallas históricas brasileñas siguen siendo válidas.
  if(/^camisetas?$/.test(name))return ['XS','S','M','L','XL','XXL','PP','P','G','GG','XGG'];
  if(/^sudaderas?$/.test(name))return ['XS','S','M','L','XL','XXL'];
  if(/^(moletons?|moleton|moletom)$/.test(name))return ['PP','P','M','G','GG','XGG'];
  if(/^gorras?$/.test(name))return ['Única','P/M','G/GG','54','55','56','57','58','59','60','61','62'];
  if(/^bones?$/.test(name))return ['Único','P/M','G/GG','54','55','56','57','58','59','60','61','62'];
  if(/^(tablas?|shapes?|shaipes?)$/.test(name))return ['7.5','7.75','7.875','8.0','8.125','8.25','8.375','8.5','8.75','9.0'];
  return [];
}
