import {tokenize} from './codec.js?v=20261031.4';
import {B,I,nbtSize,values} from './numeric-codec.js?v=20261031.4';

export const MAX_TEXT=64000; // translate strings stay under NBT's 65535-byte string limit
export const PREFIX_TIERS=[5,10,20],NARROW=255,SUFFIX0=156;
const direct=wide=>SUFFIX0-1-wide;
export const prefixesFor=ids=>ids<=NARROW?0:PREFIX_TIERS.find(p=>ids<=p*100+99)??0;
export const wideOf=data=>data.w===true||data.w===1?20:data.w||0;  // true: the 20-prefix table
const signed=u=>u>127?u-256:u;
export const idBytes=(v,wide)=>!wide||v<=direct(wide)?1:2;
function streamBytes(s,wide){
 const out=[];
 for(const v of s){if(idBytes(v,wide)===1)out.push(signed(v));else{if(v>wide*100+99)throw Error('Palette too large');out.push(signed(direct(wide)+Math.floor(v/100)),signed(SUFFIX0+v%100));}}
 return out;
}
export function byteText(b,wide){
 const u=b<0?b+256:b;
 return u===0?'\n':!wide||u<=direct(wide)?'%'+u+'$s':u<SUFFIX0?'%'+(u-direct(wide)):String(u-SUFFIX0).padStart(2,'0')+'$s';
}
export const CHUNK=500;

const sb=v=>v>127?v-256:v;
function palette(keys,colors,wide){
 const one=wide?direct(wide):Infinity,tiers=wide?[9,99,one,Infinity]:[9,99,Infinity];
 const run=k=>(k&127)+1,rank=new Map(keys.map((k,i)=>[k,i]));
 const clear=keys.filter(k=>k<128&&rank.get(k)<one),late=keys.filter(k=>k<128&&rank.get(k)>=one),ranked=keys.filter(k=>k>=128),solid=[];
 for(let t=0,id=clear.length,i=0;i<ranked.length;t++){
  const end=Math.max(0,tiers[t]-id),tier=ranked.slice(i,i+end);
  tier.sort((a,b)=>run(a)-run(b)||a-b);solid.push(...tier);i+=tier.length;id+=tier.length;
 }
 const groups=[];
 for(const k of solid){const c=colors[(k>>7)-1],h=((c[0]<<16)|(c[1]<<8)|c[2]).toString(16).toUpperCase();
  if(!groups.length||groups[groups.length-1].n!==run(k))groups.push({n:run(k),c:[]});groups[groups.length-1].c.push(h);}
 const clearJob=list=>list.length?[{b:B(list.map(k=>sb(run(k))))}]:[];
 const byValue=[...clearJob(clear),...groups.map(g=>({n:B([sb(g.n)]),c:g.c})),...clearJob(late)];
 const hexes=[...new Set(groups.flatMap(g=>g.c))],key=new Map(hexes.map((h,i)=>[h,sb(i)]));
 const cl=Object.fromEntries(hexes.map((h,i)=>[sb(i)+'b',h]));
 const byIndex=[...clearJob(clear),...groups.map(g=>({n:B([sb(g.n)]),i:B(g.c.map(h=>key.get(h)))})),...clearJob(late)];
 const indexed=nbtSize({p:byIndex,cl})<nbtSize({p:byValue});
 return {order:[...clear,...solid,...late],p:indexed?byIndex:byValue,cl:indexed?cl:null};
}
export function expandPalette(data){
 const runs=n=>{const v=values(n)[0];return v<=0?v+256:v;},hex=data.cl?Object.fromEntries(Object.entries(data.cl)):{};
 const out=(data.pt||[]).slice();
 for(const g of data.p){
  if(g.t)out.push(...g.c.map(h=>({text:g.t,color:'#'+h})));
  else if(g.b)out.push(...values(g.b).map(v=>({text:'  '.repeat(v<=0?v+256:v),bold:true})));
  else{const t='■ '.repeat(runs(g.n));out.push(...(g.c||values(g.i).map(v=>hex[v+'b'])).map(h=>({text:t,color:'#'+h})));}
 }
 return [...out,...(data.pt2||[]),...(data.x||[])];
}

function segments(seqs,rowCount){
 const succ=new Int32Array(rowCount).fill(-2),pred=new Int32Array(rowCount).fill(-2);
 const note=(arr,i,v)=>{arr[i]=arr[i]===-2||arr[i]===v?v:-3;};
 for(const s of seqs)s.forEach((r,i)=>{note(succ,r,i+1<s.length?s[i+1]:-1);note(pred,r,i?s[i-1]:-1);});
 const joins=r=>succ[r]>=0&&succ[r]!==r&&pred[succ[r]]===r;
 const segOf=new Int32Array(rowCount).fill(-1),segs=[];
 for(const s of seqs)for(const r of s){
  if(segOf[r]>=0)continue;
  const chain=[r];segOf[r]=segs.length;
  for(let x=r;joins(x)&&segOf[succ[x]]<0;){x=succ[x];segOf[x]=segs.length;chain.push(x);}
  segs.push(chain);
 }
 const layers=seqs.map(s=>{const out=[];for(let i=0;i<s.length;){const g=segOf[s[i]];out.push(g);i+=segs[g].length;}return out;});
 return {segs,layers};
}

function build(t,colors,mode,pairs=false){
 const wide=prefixesFor(t.keys.length),pal=palette(t.keys,colors,wide),ids=new Map(pal.order.map((k,i)=>[k,i+1]));
 const chunked=s=>{const b=streamBytes(s,wide),parts=[];for(let i=0;i<b.length;i+=CHUNK)parts.push(B(b.slice(i,i+CHUNK)));return parts;};
 const seen=new Map(),unique=[];
 const frameLayers=t.layers.map((frames,l)=>frames.map(rows=>{
  const key=l+':'+rows.map(r=>r.join(',')).join('|');
  if(!seen.has(key)){seen.set(key,unique.length);unique.push({l,rows});}return seen.get(key);
 }));
 const text=s=>s.reduce((n,v)=>n+(v?String(v).length+3:1),0);
 const rowIds=new Map(),rowTokens=[];
 const rowSeqs=unique.map(({l,rows},u)=>rows.map((r,y)=>{
  const key=(mode==='none'?u+'#'+y+'#':mode==='pos'?l+'@'+y+'#':'')+r.join(',');
  if(!rowIds.has(key)){rowIds.set(key,rowTokens.length);rowTokens.push(r.map(k=>ids.get(k)));}return rowIds.get(key);
 }));
 const partOf=[],partsOf=unique.map(()=>[]),seqs=[];
 rowSeqs.forEach((rows,u)=>{let cur=[],len=0;
  const close=()=>{partsOf[u].push(seqs.length);partOf.push(u);seqs.push(cur);cur=[];len=0;};
  for(const r of rows){const n=text(rowTokens[r]);if(cur.length&&len+1+n+1>MAX_TEXT)close();len+=(cur.length?1:0)+n;cur.push(r);}
  close();
 });
 const more=p=>partsOf[partOf[p]].at(-1)!==p;  // another part of the same layer follows
 const {segs,layers}=segments(seqs,rowTokens.length);
 const uses=new Int32Array(segs.length),last=new Uint8Array(segs.length);
 for(const ls of layers){for(const g of ls)uses[g]++;last[ls[ls.length-1]]=1;}
 const whole=partsOf.map(ps=>ps.every(p=>layers[p].length===1&&uses[layers[p][0]]===1));
 const direct=layers.map((ls,p)=>whole[partOf[p]]);
 const stream=(g,brk)=>{const o=[];segs[g].forEach((r,i)=>{if(i)o.push(0);o.push(...rowTokens[r]);});if(!last[g]||brk)o.push(0);return o;};
 const dict=[],dictId=new Map();
 layers.forEach((ls,i)=>{if(!direct[i])for(const g of ls)if(!dictId.has(g)){dictId.set(g,dict.length+1);dict.push(g);}});
 const order=[...layers.keys()].filter(i=>direct[i]).concat([...layers.keys()].filter(i=>!direct[i]));
 const layerId=new Map();let done=0;
 for(const p of order)if(!more(p))layerId.set(partOf[p],done++);
 const plans=order.filter(i=>!direct[i]).map(i=>{const o=[];layers[i].forEach((g,j)=>{o.push(dictId.get(g));if(j+1<layers[i].length&&last[g])o.push(0);});if(more(i))o.push(0);return o;});
 let streams=[...order.filter(i=>direct[i]).map(i=>stream(layers[i][0],more(i))),...dict.map(g=>stream(g))],x=[];
 if(pairs&&pal.order.length<255)({streams,x}=pairUp(streams,pal.order,colors));
 const segText=streams.map(text),n=order.length-plans.length;
 const maxText=Math.max(0,...segText.slice(0,n),...plans.map(p=>p.reduce((m,x)=>m+(x?segText[n+x-1]:1),0))),oversize=maxText>MAX_TEXT;
 const parted=seqs.length>unique.length;
 const data={codec:'midp2',p:pal.p,u:streams.map(chunked),f:frameLayers.map(a=>I(a.map(u=>layerId.get(u))))};
 if(parted)data.pm=B(order.map(p=>more(p)?1:0));
 if(plans.length){data.k=n;data.a=plans.map(I);}
 if(pal.cl)data.cl=pal.cl;
 if(x.length)data.x=x;
 if(wide)data.w=wide===20||wide;
 const tokens=streams.reduce((m,s)=>m+s.reduce((n,v)=>n+idBytes(v,wide),0),0);
 return {data,size:nbtSize(data),entries:t.keys.length+x.length,keys:t.keys,unique:unique.length,parts:order.length,tokens,mode,assembled:plans.length,pairs:x.length,oversize,maxText};
}

function pairUp(streams,order,colors){
 const S=streams.map(s=>Int32Array.from(s)),len=S.map(s=>s.length),count=new Int32Array(65536),leaves=[],x=[];
 const base=v=>v?[v]:[0],expand=v=>v>order.length?leaves[v-order.length-1]:base(v);
 for(let id=order.length+1;id<=255;id++){
  count.fill(0);
  for(let k=0;k<S.length;k++){const s=S[k];for(let i=1;i<len[k];i++)count[s[i-1]<<8|s[i]]++;}
  const gain=i=>count[i]*(idBytes(i>>8)+idBytes(i&255)-idBytes(id));
  let best=0;for(let i=1;i<65536;i++)if(count[i]&&gain(i)>gain(best))best=i;
  const a=best>>8,b=best&255,flat=[...expand(a),...expand(b)],c=component(flat,order,colors);
  if(gain(best)<=nbtSize(c))break;
  leaves.push(flat);x.push(c);
  for(let k=0;k<S.length;k++){const s=S[k];let j=0;for(let i=0;i<len[k];i++){if(i+1<len[k]&&s[i]===a&&s[i+1]===b){s[j++]=id;i++;}else s[j++]=s[i];}len[k]=j;}
 }
 return {streams:S.map((s,k)=>Array.from(s.subarray(0,len[k]))),x};
}
function component(ids,order,colors){
 const parts=[];
 for(const v of ids){
  const k=order[v-1],part=!v?{text:'\n'}:k<128?{text:'  '.repeat((k&127)+1),bold:true}:{text:'■ '.repeat((k&127)+1),color:hex(colors[(k>>7)-1])};
  const prev=parts[parts.length-1];
  if(prev&&(!v||prev.color===part.color&&prev.bold===part.bold))prev.text+=part.text;else parts.push(part);
 }
 const [root,...rest]=parts;
 if(rest.length)root.extra=rest.map(p=>root.bold&&!p.bold&&p.color?{...p,bold:false}:p);
 return root;
}
const hex=c=>'#'+((c[0]<<16)|(c[1]<<8)|c[2]).toString(16).toUpperCase();

export function encodeMidp(indexed,colors,width,height,limit=255,modes=['none','pos','content']){
 const t=tokenize(indexed,width,height,()=>{},limit);
 return modes.map(mode=>build(t,colors,mode)).reduce((a,b)=>b.size<a.size?b:a);
}

export const PAIR_GAIN=0;
export const IN_WORLD_WEIGHT=0.005;
export function encodeBest(indexed,colors,width,height,pairGain=PAIR_GAIN){
 const banked=new WeakMap(),world=e=>{if(!banked.has(e))banked.set(e,bankedBytes(e.data));return banked.get(e);};
 const cost=e=>e.size+e.tokens+world(e)*IN_WORLD_WEIGHT,min=a=>a.reduce((x,y)=>cost(y)<cost(x)?y:x);
 const plain=[],paired=[],seen=new Set();
 for(const limit of [64,128,160,192,224,253,320,384,448,512,599,768,1024,1099,1536,2048]){
  const t=tokenize(indexed,width,height,()=>{},limit);
  if(seen.has(t.keys.length))continue;seen.add(t.keys.length);
  const e=min(['none','pos','content'].map(mode=>build(t,colors,mode)));
  plain.push(e);if(t.keys.length<255)paired.push(build(t,colors,e.mode,true));
  if(t.keys.length===t.originalCount)break;  // every run already has its own entry
 }
 const a=min(plain),b=paired.length&&min(paired);
 const pairWins=b&&b.pairs&&b.tokens<=a.tokens&&cost(b)<cost(a)*(1-pairGain);
 return pairWins?b:a;
}

export function layerParts(data){
 const wide=wideOf(data),seg=data.u.map(parts=>parts.map(a=>values(a).map(b=>byteText(b,wide)).join('')).join('')),n=data.k??seg.length;
 const flat=[...seg.slice(0,n),...(data.a||[]).map(p=>values(p).map(x=>x?seg[n+x-1]:'\n').join(''))];
 const more=data.pm?values(data.pm):[],out=[];let cur=[];
 flat.forEach((s,i)=>{cur.push(s);if(!more[i]){out.push(cur);cur=[];}});
 return out;
}
export const layerTexts=data=>layerParts(data).map(p=>p.join(''));
export function bankedBytes(data){
 const P=nbtSize(expandPalette(data)),S=layerParts(data).map(p=>p.reduce((n,s)=>n+s.length+P+40,0));
 return data.f.reduce((sum,layer)=>sum+values(layer).reduce((n,i)=>n+S[i],0),0);
}
