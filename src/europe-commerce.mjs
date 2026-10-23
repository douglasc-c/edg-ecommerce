import { requireThat, text, integer } from './security.mjs';

export function spanishCheckoutAddress(input) {
  requireThat(input && typeof input==='object' && !Array.isArray(input),400,'La dirección es obligatoria.');
  const country=String(input.country_code||'ES').toUpperCase();
  requireThat(country==='ES',400,'Solo se admiten destinos en España (Península y Baleares).');
  const result={};
  for(const [key,label] of Object.entries({name:'Nombre',phone:'Teléfono',street:'Calle',number:'Número',city:'Ciudad'})) {
    result[key]=text(input[key],label,1,key==='phone'?30:150);
    requireThat(!/[\u0000-\u001f\u007f]/.test(result[key]),400,`${label} no válido.`);
  }
  requireThat(/^\+?[\d ()-]+$/.test(result.phone) && /^\d{7,15}$/.test(result.phone.replace(/\D/g,'')),400,'Introduce un teléfono válido con prefijo internacional.');
  result.phone=result.phone.replace(/[ ()-]/g,'');
  result.postal_code=text(input.postal_code,'Código postal',5,5);
  requireThat(/^\d{5}$/.test(result.postal_code),400,'El código postal debe contener cinco dígitos.');
  requireThat(!/^(35|38|51|52)/.test(result.postal_code),400,'Solo se admiten la Península y Baleares.');
  result.complement=input.complement?text(input.complement,'Complemento',1,150):'';
  requireThat(!/[\u0000-\u001f\u007f]/.test(result.complement),400,'Complemento no válido.');
  result.country_code='ES';
  return result;
}

export function europeCommerceProvider(config,sendcloud,stripe) {
  return {
    european:true,demo:false,environment:config.europeCheckout.environment,
    async quote(items,address) {
      const a=spanishCheckoutAddress(address);
      const sender=await sendcloud.sender();
      requireThat(sender?.country_code==='ES' && String(sender.city||'').trim().toLowerCase()==='barcelona' && /^08\d{3}$/.test(String(sender.postal_code)),409,'Configura un remitente de Barcelona en Sendcloud.');
      // Una pila rectangular conservadora; las medidas y cantidades proceden del catálogo.
      const parcel={weight:0,width:0,height:0,length:0};
      for(const item of items) {
        integer(item.quantity,'Cantidad',1,99);
        for(const key of ['weight','width','height','length'])requireThat(typeof item[key]==='number' && Number.isFinite(item[key]) && item[key]>0,400,'Completa el peso y las medidas de los productos.');
        parcel.weight+=item.weight*item.quantity;
        parcel.width=Math.max(parcel.width,item.width);parcel.length=Math.max(parcel.length,item.length);
        parcel.height+=item.height*item.quantity;
      }
      parcel.weight=Math.ceil(parcel.weight*1000)/1000;
      requireThat(parcel.weight>0 && parcel.weight<=100 && ['width','height','length'].every(key=>parcel[key]>0 && parcel[key]<=300),422,'El carrito supera las medidas de un solo bulto; contacta con la tienda.');
      const options=await sendcloud.quote({sender,destination:{name:a.name,telephone:a.phone,address:a.street,house_number:a.number,address_2:a.complement,postal_code:a.postal_code,city:a.city,country_code:'ES'},parcel});
      requireThat(Array.isArray(options) && options.length<=200,502,'Respuesta de tarifas no válida.');
      return options.map(option=>{
        requireThat(typeof option.id==='string' && option.id.length>0 && option.id.length<=600 && Number.isSafeInteger(option.price) && option.price>=0 && option.price<=1000000 && option.currency==='EUR',502,'Tarifa no válida en euros.');
        return {...option,parcel,provider:'sendcloud'};
      });
    },
    preference(order,items,customer) { return stripe.preference(order,items,customer); },
    refund(order) { return stripe.refund(order.payment_id,order.id); }
  };
}
