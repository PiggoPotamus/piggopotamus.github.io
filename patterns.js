// Lossless substring dictionaries using the existing compact wire format.
// Aliases expand only to original palette entries; no recursive decoding.
export function searchPatterns(values,paletteSize,alphabet,layout,baseline,onProgress,bytes,snbt){
 const capacity=Math.min(128,alphabet.length-paletteSize);if(capacity<1)return baseline;
 const ranks=new Map(Array.from(alphabet,(c,i)=>[c,i])),byteCost=new Map(Array.from(alphabet,c=>[c,bytes(c)]));
 const expand=s=>Array.from(s,c=>'%'+(ranks.get(c)+1)+'$s').join('');
 const rows=new Map();for(const text of values)for(const row of text.split('_'))if(row.length>=3)rows.set(row,(rows.get(row)||0)+1);
 const total=[...rows].reduce((n,[s])=>n+s.length,0),stride=Math.max(1,Math.ceil(total/180000)),pool=new Map();
 function add(pattern,n){const gain=n*(bytes(pattern)-bytes(alphabet[paletteSize]))-bytes(snbt({[alphabet[paletteSize]]:expand(pattern)}));if(n>1&&gain>0&&(!pool.has(pattern)||pool.get(pattern).gain<gain))pool.set(pattern,{pattern,gain});}
 for(const [row,n]of rows)if(row.length<=128)add(row,n);
 const lengths=[3,4,6,8,12,16,24,32];
 lengths.forEach((length,li)=>{const counts=new Map();for(const [row,n]of rows)for(let i=0;i+length<=row.length;i+=stride){const p=row.slice(i,i+length),old=counts.get(p);if(old!==undefined)counts.set(p,old+n);else if(counts.size<65536)counts.set(p,n);}for(const [p,n]of counts)add(p,n);onProgress((li+1)/lengths.length*.35);});
 const candidates=[...pool.values()].sort((a,b)=>b.gain-a.gain||a.pattern.localeCompare(b.pattern)).slice(0,256);
 if(!candidates.length)return baseline;
 function encode(patterns){
  const root=new Map(),aliases={},used=new Set();let longest=7;
  patterns.forEach((p,i)=>{const code=alphabet[paletteSize+i],text=expand(p);aliases[code]=text;longest=Math.max(longest,bytes(text));let node=root;for(const c of p){if(!node.has(c))node.set(c,new Map());node=node.get(c);}node.code=code;});
  const memo=new Map();function row(text){if(memo.has(text))return memo.get(text);const costs=new Float64Array(text.length+1),end=new Int32Array(text.length),out=new Array(text.length);for(let i=text.length-1;i>=0;i--){costs[i]=byteCost.get(text[i])+costs[i+1];end[i]=i+1;out[i]=text[i];let node=root;for(let j=i;j<text.length;j++){node=node.get(text[j]);if(!node)break;if(node.code){const cost=byteCost.get(node.code)+costs[j+1];if(cost<costs[i]){costs[i]=cost;end[i]=j+1;out[i]=node.code;}}}}let result='';for(let i=0;i<text.length;i=end[i]){result+=out[i];if(aliases[out[i]])used.add(out[i]);}memo.set(text,result);return result;}
  const encoded=values.map(v=>v.split('_').map(row).join('_'));for(const code of Object.keys(aliases))if(!used.has(code))delete aliases[code];
  return {data:layout(encoded,aliases,longest),used:patterns.filter((_,i)=>used.has(alphabet[paletteSize+i]))};
 }
 let best=baseline,bestBytes=bytes(snbt(best)),chosen=[];
 const sizes=[...new Set([8,16,32,64,128].map(n=>Math.min(n,capacity,candidates.length)))];
 sizes.forEach((size,i)=>{let trial=encode(candidates.slice(0,size).map(c=>c.pattern));if(trial.used.length<size)trial=encode(trial.used);const cost=bytes(snbt(trial.data));if(cost<bestBytes){best=trial.data;bestBytes=cost;chosen=trial.used;}onProgress(.35+.4*(i+1)/sizes.length);});
 // Greedy removals discard overlapping/unhelpful choices that ranked well only
 // before other patterns were selected. Keep only measured whole-payload wins.
 if(chosen.length){for(let i=0;i<Math.min(24,chosen.length);i++){const trialPatterns=chosen.filter((_,j)=>j!==i),trial=encode(trialPatterns),cost=bytes(snbt(trial.data));if(cost<bestBytes){best=trial.data;bestBytes=cost;chosen=trial.used;i--;}onProgress(.75+.24*(i+1)/Math.min(24,Math.max(1,chosen.length)));}}
 onProgress(1);return best;
}
