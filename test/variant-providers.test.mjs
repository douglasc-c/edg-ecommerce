import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providers} from '../src/providers.mjs';
import {invoiceService} from '../src/invoices.mjs';

const items=[
  {id:'shirt',product_id:'shirt',variant_id:'black-s',sku:'SHIRT-BLACK-S',name:'Camiseta EDG',selected_color:'Negro',selected_size:'S',price:2990,quantity:2,weight:.3,width:20,height:5,length:25},
  {id:'shirt',product_id:'shirt',variant_id:'white-l',sku:'SHIRT-WHITE-L',name:'Camiseta EDG',selected_color:'Blanco',selected_size:'L',price:3490,quantity:1,weight:.3,width:20,height:5,length:25},
];

for(const discount of [0,1])test(`el checkout externo distingue las variantes y conserva el total con descuento ${discount}`,async()=>{
  let payload;
  const provider=providers({mode:'live',mpToken:'fixture',mpSecret:'fixture',collectorId:'1',url:'https://store.example.test'},async(url,options)=>{
    assert.ok(url.endsWith('/checkout/preferences'));
    payload=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:'preference',init_point:'https://www.mercadopago.com.br/checkout'})};
  });
  await provider.preference({id:'order',shipping:1990,discount,created_at:'2026-10-22T12:00:00Z',reserved_until:'2026-10-22T12:30:00Z'},items,{email:'customer@example.test'});
  assert.deepEqual(payload.items.slice(0,2).map(item=>item.id),['black-s','white-l']);
  assert.ok(payload.items[0].title.includes('Camiseta EDG · Negro · S'));
  assert.ok(payload.items[1].title.includes('Camiseta EDG · Blanco · L'));
  assert.equal(payload.items.reduce((sum,item)=>sum+Math.round(item.unit_price*100)*item.quantity,0),2990*2+3490+1990-discount);
});

test('la cotización y etiqueta distinguen dos variantes del mismo producto',async()=>{
  const calls=[];
  const provider=providers({mode:'live',meToken:'fixture',originPostal:'80010000',supportEmail:'support@example.test',shippingFrom:{state_register:'123'}},async(url,options)=>{
    calls.push({url,payload:JSON.parse(options.body)});
    return {ok:true,json:async()=>url.endsWith('/shipment/calculate')?[{id:1,name:'PAC',price:'19.90',packages:[]}]:{id:'label'}};
  });
  await provider.quote(items,'01001000');
  assert.deepEqual(calls[0].payload.products.map(item=>item.id),['black-s','white-l']);
  assert.deepEqual(calls[0].payload.products.map(item=>item.insurance_value),[29.90,34.90]);
  await provider.createLabel({address:JSON.stringify({name:'Cliente',postal_code:'01001000'}),shipping_service:JSON.stringify({id:'1',packages:[{height:10,width:20,length:25,weight:.9}]}),subtotal:9470},items,'9'.repeat(44));
  assert.deepEqual(calls[1].payload.products.map(item=>item.name),['Camiseta EDG · Negro · S','Camiseta EDG · Blanco · L']);
});

test('la factura conserva SKU, color, talla y reparto de céntimos por línea',()=>{
  const fiscal=JSON.stringify({codigo_ncm:'61091000',cfop:'5102',unidade_comercial:'UN',icms_origem:'0',icms_situacao_tributaria:'400',pis_situacao_tributaria:'07',cofins_situacao_tributaria:'07'});
  const order={id:'order',status:'paid',payment_status:'approved',refunded:0,subtotal:9470,shipping:1990,discount:1,total:11459,
    address:{document:'12345678901',state:'PR',phone:'41999999999'},items:items.map(item=>({...item,fiscal}))};
  const config={mode:'live',nfeToken:'fixture',nfeEnvironment:'homologation',
    nfeEmitter:{cnpj_emitente:'12345678000123',nome_emitente:'Empresa',inscricao_estadual_emitente:'123',uf_emitente:'PR',regime_tributario_emitente:1},
    nfeDefaults:{natureza_operacao:'Venda',modalidade_frete:0,indicador_inscricao_estadual_destinatario:9,formas_pagamento:[{forma_pagamento:'17'}]}};
  const {payload}=invoiceService(null,config,{}, {order:()=>order}).preview({id:'admin'},order.id);
  assert.deepEqual(payload.items.map(item=>item.codigo_produto),['SHIRT-BLACK-S','SHIRT-WHITE-L']);
  assert.deepEqual(payload.items.map(item=>item.descricao),['Camiseta EDG · Negro · S','Camiseta EDG · Blanco · L']);
  assert.equal(payload.items.reduce((sum,item)=>sum+Math.round(item.valor_desconto*100),0),1);
  assert.equal(payload.items.reduce((sum,item)=>sum+Math.round(item.valor_frete*100),0),1990);
  assert.equal(payload.valor_total,114.59);
});
