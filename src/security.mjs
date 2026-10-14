import { randomBytes, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function requireThat(condition, status, message) { if (!condition) throw new HttpError(status, message); }
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const now = () => new Date().toISOString();
export function text(value, label, min=1, max=250) {
  requireThat(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, 400, `${label}: informe entre ${min} e ${max} caracteres.`);
  return value.trim();
}
export function integer(value, label, min=0, max=100000000) {
  requireThat(Number.isSafeInteger(value) && value>=min && value<=max,400,`${label}: valor inválido.`); return value;
}
export function positive(value,label) {
  requireThat(typeof value==='number' && Number.isFinite(value) && value>0 && value<=10000,400,`${label}: valor inválido.`); return value;
}
export function email(value) {
  const e = text(value,'E-mail',3,254).toLowerCase();
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),400,'E-mail inválido.'); return e;
}
export function postal(value) {
  const p = text(value,'CEP',8,9).replace(/\D/g,''); requireThat(/^\d{8}$/.test(p),400,'CEP inválido.'); return p;
}
export async function passwordHash(password) {
  requireThat(typeof password==='string' && password.length>=12 && password.length<=128,400,'A senha precisa ter entre 12 e 128 caracteres.');
  const salt=randomBytes(16).toString('hex'); const key=await scrypt(password,salt,64); return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  if(typeof password!=='string' || password.length>128) return false;
  const [salt,key]=encoded.split(':'); const result=await scrypt(password,salt,64);
  return timingSafeEqual(result,Buffer.from(key,'hex'));
}
export function address(input) {
  requireThat(input && typeof input==='object',400,'Endereço obrigatório.');
  const a = Object.fromEntries(['name','phone','document','street','number','district','city','state'].map(k=>[k,text(input[k],k,1,k==='state'?2:150)]));
  requireThat(/^[A-Z]{2}$/.test(a.state),400,'UF inválida.');
  a.postal_code=postal(input.postal_code); a.complement=typeof input.complement==='string'?input.complement.trim().slice(0,150):'';
  return a;
}
export function safeLink(value) {
  if(!value) return null;
  requireThat(typeof value==='string' && value.length<=2000,400,'Link inválido.');
  let u; try {u=new URL(value);}catch {throw new HttpError(400,'Link inválido.');}
  requireThat(u.protocol==='https:' && !u.username && !u.password,400,'O link deve usar HTTPS.'); return u.href;
}
export const roles = ['customer','admin','inventory','finance','shipping','support'];
export const permissions = {
  admin:['dashboard','catalog','stock','orders','finance','shipping','users','audit','coupons','invoices'],
  inventory:['dashboard','catalog','stock','orders'], finance:['dashboard','orders','finance','coupons','invoices'],
  shipping:['dashboard','orders','shipping'], support:['dashboard','orders'], customer:[]
};

export function fiscalFields(input={}) {
  requireThat(input && typeof input==='object' && !Array.isArray(input) && JSON.stringify(input).length<=12000,400,'Dados fiscais inválidos.');
  const output={};
  for(const [key,value] of Object.entries(input)) {
    requireThat(/^(codigo_ncm|cfop|unidade_comercial|unidade_tributavel|codigo_cest|codigo_beneficio_fiscal|icms_[a-z_]+|pis_[a-z_]+|cofins_[a-z_]+|ipi_[a-z_]+|ibs_[a-z_]+|cbs_[a-z_]+)$/.test(key),400,`Campo fiscal não permitido: ${key}`);
    requireThat((typeof value==='string' && value.length<=250) || (typeof value==='number' && Number.isFinite(value) && value>=0),400,`Valor fiscal inválido: ${key}`);
    output[key]=value;
  }
  if(output.codigo_ncm) requireThat(/^\d{8}$/.test(String(output.codigo_ncm)),400,'NCM deve conter 8 dígitos.');
  if(output.cfop)requireThat(/^\d{4}$/.test(String(output.cfop)),400,'CFOP deve conter 4 dígitos.');
  return output;
}
export function allocateCents(amount,weights) {
  const total=weights.reduce((s,w)=>s+BigInt(w),0n);if(!amount || !total)return weights.map(()=>0);
  const parts=weights.map(w=>({value:Number(BigInt(amount)*BigInt(w)/total),remainder:BigInt(amount)*BigInt(w)%total}));
  let left=amount-parts.reduce((s,p)=>s+p.value,0);
  const sorted=parts.map((p,i)=>({...p,i})).sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
  for(let i=0;i<left;i++)parts[sorted[i].i].value++;
  return parts.map(p=>p.value);
}
