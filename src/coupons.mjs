import { now, text, integer, requireThat } from './security.mjs';
export function coupons(db,audit) {
  const one=(sql,...a)=>db.prepare(sql).get(...a);
  const count=(sql,...a)=>one(sql,...a).n;
  function normalize(value){const code=text(value,'Cupom',3,40).toUpperCase();requireThat(/^[A-Z0-9_-]+$/.test(code),400,'Código do cupom inválido.');return code;}
  function calculate(user,subtotal,input) {
    if(!input)return{code:null,discount:0};
    const code=normalize(input),c=one('SELECT * FROM coupons WHERE code=?',code),time=now();
    requireThat(c?.active && c.starts_at<=time && c.ends_at>time,422,'Cupom inválido, inativo ou fora da validade.');
    requireThat(subtotal>=c.min_subtotal,422,'O subtotal não atende ao valor mínimo do cupom.');
    requireThat(count("SELECT COUNT(*) n FROM coupon_uses WHERE code=? AND status IN ('reserved','used')",code)<c.max_uses,422,'Cupom esgotado.');
    requireThat(count("SELECT COUNT(*) n FROM coupon_uses WHERE code=? AND user_id=? AND status IN ('reserved','used')",code,user.id)<c.per_user_limit,422,'Limite de uso do cupom atingido para esta conta.');
    let discount=c.type==='fixed'?c.value:Number(BigInt(subtotal)*BigInt(c.value)/10000n);
    if(c.max_discount!==null)discount=Math.min(discount,c.max_discount);
    // Mantém pelo menos um centavo de produtos; frete não é descontado.
    return{code,discount:Math.min(discount,Math.max(0,subtotal-1))};
  }
  return {
    calculate,
    reserve(orderId,userId,code){if(code)db.prepare("INSERT INTO coupon_uses VALUES(?,?,?,'reserved')").run(orderId,code,userId);},
    release(orderId){db.prepare("UPDATE coupon_uses SET status='released' WHERE order_id=? AND status='reserved'").run(orderId);},
    used(orderId){db.prepare("UPDATE coupon_uses SET status='used' WHERE order_id=?").run(orderId);},
    list(){return db.prepare("SELECT c.*,SUM(CASE WHEN u.status='used' THEN 1 ELSE 0 END) used,SUM(CASE WHEN u.status='reserved' THEN 1 ELSE 0 END) reserved FROM coupons c LEFT JOIN coupon_uses u ON u.code=c.code GROUP BY c.code ORDER BY c.created_at DESC").all();},
    save(user,input) {
      const code=normalize(input.code);requireThat(['percent','fixed'].includes(input.type),400,'Tipo de desconto inválido.');
      const value=integer(input.value,'Desconto',1,input.type==='percent'?10000:100000000);
      const start=new Date(input.starts_at),end=new Date(input.ends_at);requireThat(Number.isFinite(+start)&&Number.isFinite(+end)&&end>start,400,'Período de validade inválido.');
      const c={code,type:input.type,value,min_subtotal:integer(input.min_subtotal,'Subtotal mínimo'),max_discount:input.max_discount===null?null:integer(input.max_discount,'Desconto máximo',1),starts_at:start.toISOString(),ends_at:end.toISOString(),max_uses:integer(input.max_uses,'Limite de usos',1,1000000),per_user_limit:integer(input.per_user_limit,'Limite por cliente',1,10000),active:input.active===false?0:1};
      const existing=one('SELECT * FROM coupons WHERE code=?',code);
      requireThat(!existing || count("SELECT COUNT(*) n FROM coupon_uses WHERE code=? AND status IN ('reserved','used')",code)===0,409,'Cupom com pedidos vinculados não pode ser alterado. Desative-o e crie outro código.');
      db.prepare(`INSERT INTO coupons(${Object.keys(c).join(',')},created_at) VALUES(${Array(Object.keys(c).length+1).fill('?').join(',')}) ON CONFLICT(code) DO UPDATE SET ${Object.keys(c).filter(k=>k!=='code').map(k=>`${k}=excluded.${k}`).join(',')}`).run(...Object.values(c),now());
      audit(user.id,'coupon.save',code);return one('SELECT * FROM coupons WHERE code=?',code);
    },
    toggle(user,code,active){code=normalize(code);requireThat(typeof active==='boolean' && one('SELECT code FROM coupons WHERE code=?',code),400,'Cupom ou situação inválidos.');db.prepare('UPDATE coupons SET active=? WHERE code=?').run(active?1:0,code);audit(user.id,'coupon.active',code,{active});return{ok:true};}
  };
}
