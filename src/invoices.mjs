import { randomUUID } from 'node:crypto';
import { requireThat,HttpError,text,now,safeLink,fiscalFields,allocateCents } from './security.mjs';
export function fiscalProvider(config,fetcher=fetch) {
  const base=config.nfeEnvironment==='production'?'https://api.focusnfe.com.br':'https://homologacao.focusnfe.com.br';
  async function request(method,path,body) {
    requireThat(config.nfeToken,503,'Configura el token de Focus NFe.');let response;
    try{response=await fetcher(base+path,{method,headers:{Authorization:`Basic ${Buffer.from(config.nfeToken+':').toString('base64')}`,'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new HttpError(502,'Respuesta fiscal incierta. Consulta la NF-e antes de volver a intentarlo.');}
    if(response.status===404)throw new HttpError(404,'La NF-e aún no se ha encontrado en el proveedor.');
    let data;try{data=await response.json();}catch{throw new HttpError(502,'Respuesta fiscal no válida. Consulta la NF-e.');}
    if(!response.ok){const error=new HttpError(response.status===422||response.status===400?422:502,String(data.mensagem||data.erros?.[0]?.mensagem||'El proveedor fiscal ha rechazado la operación.').slice(0,1000));error.rejected=response.status===400||response.status===422;throw error;}
    return data;
  }
  return {
    base,
    emit(ref,payload){return request('POST',`/v2/nfe?ref=${encodeURIComponent(ref)}`,payload);},
    consult(ref){return request('GET',`/v2/nfe/${encodeURIComponent(ref)}`);},
    cancel(ref,reason){return request('DELETE',`/v2/nfe/${encodeURIComponent(ref)}`,{justificativa:reason});},
    async download(url){const u=new URL(url);requireThat(u.origin===base,502,'URL fiscal no válida.');requireThat(config.nfeToken,503,'Falta el token fiscal.');const response=await fetcher(u.href,{headers:{Authorization:`Basic ${Buffer.from(config.nfeToken+':').toString('base64')}`},redirect:'error',signal:AbortSignal.timeout(15000)});requireThat(response.ok,502,'Documento fiscal no disponible.');const content=Buffer.from(await response.arrayBuffer());requireThat(content.length<=10*1024*1024,502,'El documento fiscal supera el límite.');return content;},
    documentUrl(path){if(!path)return null;const u=new URL(path,base);requireThat(u.origin===base,502,'La URL fiscal no pertenece al proveedor.');return safeLink(u.href);}
  };
}
export function invoiceService(db,config,provider,shop) {
  const locks=new Set();
  const get=id=>db.prepare('SELECT * FROM invoices WHERE order_id=?').get(id);
  function view(row){if(!row)return null;const {payload,cancel_reason,...result}=row;return result;}
  function draft(order,overrides={}) {
    requireThat(order.payment_status==='approved' && !order.refunded && ['paid','picking','ready'].includes(order.status),409,'Solo se puede emitir una NF-e para pedidos pagados, sin reembolso y antes del envío.');
    const a=order.address,doc=a.document.replace(/\D/g,'');requireThat(/^\d{11}$|^\d{14}$/.test(doc),400,'Introduce un CPF o CNPJ válido en la dirección del pedido.');
    if(config.mode==='demo')return{demo:true,order:order.id,total:order.total};
    requireThat(config.nfeEmitter && config.nfeDefaults && config.nfeToken,503,'Configura el emisor, los parámetros fiscales y el token de Focus NFe.');
    const defaults=config.nfeDefaults,emitter=config.nfeEmitter;
    const payment={...(defaults.formas_pagamento?.[0]||{}),...(overrides.payment||{})};
    const paymentKeys=['forma_pagamento','indicador_pagamento','tipo_integracao','cnpj_credenciadora','bandeira_operadora','numero_autorizacao','descricao_pagamento','data_pagamento','cnpj_transacional','uf_transacional'];
    for(const [key,value] of Object.entries(payment))requireThat(key==='valor_pagamento'||paymentKeys.includes(key) && ['string','number'].includes(typeof value),400,'Campo fiscal de pago no válido.');
    requireThat(/^\d{2}$/.test(String(payment.forma_pagamento||'')) && !['90','91'].includes(String(payment.forma_pagamento)),400,'Introduce el código fiscal del medio de pago recibido.');
    if(String(payment.forma_pagamento)==='99')text(payment.descricao_pagamento,'Descripción del pago',2,60);
    payment.valor_pagamento=order.total/100;
    for(const key of ['cnpj_emitente','nome_emitente','inscricao_estadual_emitente','uf_emitente','regime_tributario_emitente'])requireThat(emitter[key],503,`Configura ${key} en el emisor.`);
    for(const key of ['natureza_operacao','modalidade_frete','indicador_inscricao_estadual_destinatario'])requireThat(defaults[key]!==undefined,503,`Configura ${key} en los parámetros fiscales.`);
    requireThat(!overrides.items || Array.isArray(overrides.items) && overrides.items.length===order.items.length,400,'Revisión fiscal no válida.');
    const gross=order.items.map(i=>i.price*i.quantity),discounts=allocateCents(order.discount,gross),freight=allocateCents(order.shipping,gross);
    const items=order.items.map((i,index)=>{
      const stored=JSON.parse(i.fiscal||'{}');
      const f=fiscalFields({...stored,...(overrides.items?.[index]||{})});
      for(const key of ['codigo_ncm','cfop','unidade_comercial','icms_origem','icms_situacao_tributaria','pis_situacao_tributaria','cofins_situacao_tributaria'])requireThat(f[key]!==undefined && f[key]!=='',400,`Configura ${key} para ${i.name}.`);
      return{...f,numero_item:index+1,codigo_produto:i.sku,descricao:i.name,quantidade_comercial:i.quantity,quantidade_tributavel:i.quantity,unidade_tributavel:f.unidade_tributavel||f.unidade_comercial,valor_unitario_comercial:i.price/100,valor_unitario_tributavel:i.price/100,valor_bruto:gross[index]/100,valor_desconto:discounts[index]/100,valor_frete:freight[index]/100};
    });
    // Los impuestos proceden de configuraciones revisadas; nunca se deducen el régimen, el CFOP ni los tipos impositivos.
    const payload={...defaults,...emitter,data_emissao:now(),tipo_documento:1,finalidade_emissao:1,presenca_comprador:2,local_destino:emitter.uf_emitente===a.state?1:2,
      nome_destinatario:config.nfeEnvironment==='production'?a.name:'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      [doc.length===11?'cpf_destinatario':'cnpj_destinatario']:doc,email_destinatario:order.customer_email,
      logradouro_destinatario:a.street,numero_destinatario:a.number,complemento_destinatario:a.complement,bairro_destinatario:a.district,municipio_destinatario:a.city,uf_destinatario:a.state,cep_destinatario:a.postal_code,telefone_destinatario:a.phone.replace(/\D/g,''),pais_destinatario:'Brasil',
      valor_produtos:order.subtotal/100,valor_desconto:order.discount/100,valor_frete:order.shipping/100,valor_total:order.total/100,formas_pagamento:[payment],items};
    return payload;
  }
  function apply(id,data) {
    const row=get(id);requireThat(row,404,'NF-e no encontrada.');
    requireThat(!data.ref || data.ref===row.ref,409,'La referencia fiscal no coincide.');
    const mapped={autorizado:'authorized',processando_autorizacao:'processing',erro_autorizacao:'rejected',cancelado:'cancelled'};
    let status=mapped[data.status];requireThat(status,502,'Estado fiscal no reconocido.');
    if(row.status==='cancelled')status='cancelled';
    else if(row.status==='authorized' && ['processing','rejected'].includes(status))status='authorized';
    const key=String(data.chave_nfe||row.invoice_key||'').replace(/^NFe/,'');
    if(status==='authorized')requireThat(/^\d{44}$/.test(key),502,'Clave de la NF-e autorizada no válida.');
    db.prepare('UPDATE invoices SET status=?,invoice_key=?,number=?,series=?,xml_url=?,pdf_url=?,message=?,updated_at=? WHERE order_id=?').run(status,key||null,String(data.numero||row.number||''),String(data.serie||row.series||''),provider.documentUrl(data.caminho_xml_nota_fiscal)||row.xml_url,provider.documentUrl(data.caminho_danfe)||row.pdf_url,String(data.mensagem_sefaz||data.mensagem||'').slice(0,1000),now(),id);
    if(row.status!==status)db.prepare('INSERT INTO order_events(order_id,status,message,created_at) VALUES(?,?,?,?)').run(id,shop.order(id).status,`NF-e: ${status==='authorized'?'autorizada':status==='cancelled'?'cancelada':status==='rejected'?'rechazada':'en proceso'}.`,now());
    return view(get(id));
  }
  async function locked(id,fn){requireThat(!locks.has(id),409,'Hay una operación fiscal en curso.');locks.add(id);try{return await fn();}finally{locks.delete(id);}}
  return {
    get(id){return view(get(id));},
    async download(id,kind){const row=get(id);requireThat(row && ['authorized','cancelled'].includes(row.status),404,'Documento fiscal no encontrado.');requireThat(row.environment===config.nfeEnvironment,409,'El entorno fiscal no coincide.');const url=kind==='pdf'?row.pdf_url:row.xml_url;requireThat(url,404,'El documento fiscal aún no está disponible.');return provider.download(url);},
    list(){return db.prepare('SELECT i.*,o.number order_number,u.name customer_name FROM invoices i JOIN orders o ON o.id=i.order_id JOIN users u ON u.id=o.user_id ORDER BY i.created_at DESC LIMIT 200').all().map(view);},
    preview(user,id){const o=shop.order(id,user,true);const items=o.items.map(i=>({name:i.name,fiscal:JSON.parse(i.fiscal||'{}')}));try{return{payload:draft(o),items,payment:config.nfeDefaults?.formas_pagamento?.[0]||{}};}catch(error){if(error.status===400)return{payload:null,error:error.message,items,payment:config.nfeDefaults?.formas_pagamento?.[0]||{}};throw error;}},
    async emit(user,id,overrides={}) {
      return locked(id,async()=>{
        const o=shop.order(id,user,true);
        let row=get(id);
        if(row){requireThat(row.environment===(config.mode==='demo'?'demo':config.nfeEnvironment),409,'El entorno fiscal no coincide.');if(!['rejected','not_found'].includes(row.status))return view(row);}
        const payload=draft(o,overrides),ref=row?.ref||`edg-${id}-${randomUUID().slice(0,8)}`;
        if(!row)db.prepare('INSERT INTO invoices(order_id,ref,environment,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,ref,config.mode==='demo'?'demo':config.nfeEnvironment,'submitting',JSON.stringify(payload),now(),now());
        else db.prepare("UPDATE invoices SET status='submitting',payload=?,message=NULL,updated_at=? WHERE order_id=?").run(JSON.stringify(payload),now(),id);
        shop.audit(user.id,'invoice.issue',id,{ref,environment:config.mode==='demo'?'demo':config.nfeEnvironment});
        if(config.mode==='demo')return apply(id,{ref,status:'autorizado',chave_nfe:'9'.repeat(44),numero:String(o.number),serie:'0',mensagem_sefaz:'Simulación sin valor fiscal.'});
        try{return apply(id,await provider.emit(ref,payload));}
        catch(error){db.prepare('UPDATE invoices SET status=?,message=?,updated_at=? WHERE order_id=?').run(error.rejected?'rejected':'unknown',error.message.slice(0,1000),now(),id);throw error;}
      });
    },
    async consult(user,id) {
      return locked(id,async()=>{const row=get(id);requireThat(row,404,'NF-e no encontrada.');if(row.environment==='demo')return view(row);requireThat(row.environment===config.nfeEnvironment,409,'El entorno fiscal ha cambiado; consulta con la configuración original.');
        try{return apply(id,await provider.consult(row.ref));}
        catch(error){if(error.status===404 && ['unknown','submitting'].includes(row.status))db.prepare("UPDATE invoices SET status='not_found',message=?,updated_at=? WHERE order_id=?").run(error.message,now(),id);throw error;}
      });
    },
    async cancel(user,id,reason) {
      text(reason,'Justificación',15,255);
      return locked(id,async()=>{const row=get(id);requireThat(row?.status==='authorized',409,'Solo se pueden cancelar las NF-e autorizadas.');const o=shop.order(id,user,true);requireThat(!['shipped','delivered'].includes(o.status),409,'El pedido ya se ha enviado; consulta la devolución fiscal con el responsable contable.');
        db.prepare('UPDATE invoices SET cancel_reason=? WHERE order_id=?').run(reason,id);shop.audit(user.id,'invoice.cancel_requested',id);
        if(row.environment==='demo')return apply(id,{status:'cancelado',mensagem_sefaz:'Cancelación simulada.'});
        requireThat(row.environment===config.nfeEnvironment,409,'El entorno fiscal no coincide.');return apply(id,await provider.cancel(row.ref,reason));
      });
    }
  };
}
