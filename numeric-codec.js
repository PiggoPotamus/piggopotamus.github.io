import {bytes} from './codec.js?v=20261031.4';
export const B=a=>({$b:a}), S=a=>({$s:a}), I=a=>({$i:a});
export const values=v=>v?.$b??v?.$s??v?.$i;
export function nbtSize(v){
 if(v?.$b)return 4+v.$b.length;
 if(v?.$s)return 5+2*v.$s.length;
 if(v?.$i)return 4+4*v.$i.length;
 if(typeof v==='boolean')return 1;
 if(typeof v==='number')return Number.isInteger(v)?4:8;
 if(typeof v==='string')return 2+bytes(v);
 if(Array.isArray(v)){
  const type=x=>x?.$b?7:x?.$s?9:x?.$i?11:typeof x==='string'?8:typeof x==='boolean'?1:typeof x==='number'?(Number.isInteger(x)?3:6):Array.isArray(x)?9:10;
  const same=!v.length||v.every(x=>type(x)===type(v[0]));
  return 5+v.reduce((n,x)=>n+nbtSize(x)+(same||type(x)===10?0:4),0);
 }
 if(v&&typeof v==='object')return 1+Object.entries(v).reduce((n,[k,x])=>n+3+bytes(k)+nbtSize(x),0);
 throw Error('Unsupported NBT value');
}
export const NBT_QUOTA=2097152;
const str=s=>36+2*s.length;
export function nbtWeight(v){
 if(v?.$b)return 24+v.$b.length;
 if(v?.$s)return 36+14*v.$s.length;
 if(v?.$i)return 24+4*v.$i.length;
 if(typeof v==='boolean')return 9;
 if(typeof v==='number')return Number.isInteger(v)?12:16;
 if(typeof v==='string')return str(v);
 if(Array.isArray(v))return 36+v.reduce((n,x)=>n+4+nbtWeight(x),0);
 if(v&&typeof v==='object')return 48+Object.entries(v).reduce((n,[k,x])=>n+32+str(k)+nbtWeight(x),0);
 throw Error('Unsupported NBT value');
}
