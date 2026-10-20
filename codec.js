import {searchPatterns} from './patterns.js?v=20261020.18';
// Native MID encoder. No runtime, package downloads, network calls or DOM.
export const ASCII="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'()*+,-./:;<=>?@[]^`{|}~";
export const ALPHABET=ASCII+Array.from({length:2048-ASCII.length},(_,i)=>String.fromCharCode(256+i)).join('');
const utf8=new TextEncoder();
export const bytes=s=>utf8.encode(s).length;
export function snbt(v){
 if(typeof v==='string')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Invalid numeric value');return String(v);}
 if(typeof v==='boolean')return v?'1b':'0b';
 if(Array.isArray(v))return '['+v.map(snbt).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.entries(v).map(([k,x])=>(/^[A-Za-z0-9_.+-]+$/.test(k)?k:JSON.stringify(k))+':'+snbt(x)).join(',')+'}';
 throw Error('Unsupported item value');
}
export function pixelLimit(value){return Math.max(16,Math.round((Number(value)||16000)/4)*4);}
export function dimensions(w,h,count,settings){
 // Frame count deliberately has no effect on the resolution of one frame.
 let width=Math.max(2,Math.floor((settings.width||w)/2)*2);
 width=Math.min(width,Math.max(2,Math.ceil(w/2)*2));
 const cap=pixelLimit(settings.maxPixels);
 const ratio=h/w;
 width=Math.min(width,Math.max(2,Math.floor(Math.sqrt(cap/ratio)/2)*2));
 let height=Math.max(2,Math.round(width*ratio/2)*2);
 while(width*height>cap&&width>2){width-=2;height=Math.max(2,Math.round(width*ratio/2)*2);}
 if(width*height>cap)throw Error('Pixel limit is too small for this aspect ratio. Increase Max pixels per frame.');
 return {width,height};
}
export function paletteFor(frames,limit,onProgress=()=>{},options={}){
 const bits=options.bits||5,shift=8-bits,size=1<<(bits*3);
 const hist=new Uint32Array(size),sr=new Float64Array(size),sg=new Float64Array(size),sb=new Float64Array(size);
 const stride=Math.max(1,Math.ceil(frames.reduce((s,f)=>s+f.data.length/4,0)/(options.samples||260000)));
 let exact=new Map(),fi=0;
 for(const f of frames){for(let i=0;i<f.data.length;i+=4*stride){if(f.data[i+3]<128)continue;const r=f.data[i],g=f.data[i+1],b=f.data[i+2],k=((r>>shift)<<(bits*2))|((g>>shift)<<bits)|(b>>shift);hist[k]++;sr[k]+=r;sg[k]+=g;sb[k]+=b;
  if(exact){exact.set((r<<16)|(g<<8)|b,[r,g,b]);if(exact.size>limit)exact=null;}
 }onProgress(++fi/frames.length*.45);}
 if(exact?.size){onProgress(1);return [...exact.values()];}
 const colors=[];
 for(let k=0;k<hist.length;k++)if(hist[k])colors.push({r:sr[k]/hist[k],g:sg[k]/hist[k],b:sb[k]/hist[k],n:hist[k]});
 if(!colors.length)return [[0,0,0]];
 function box(list){let lo=[255,255,255],hi=[0,0,0],n=0;const sums=[0,0,0],squares=[0,0,0];for(const c of list){n+=c.n;for(let j=0;j<3;j++){const v=c[['r','g','b'][j]];lo[j]=Math.min(lo[j],v);hi[j]=Math.max(hi[j],v);if(options.variance){sums[j]+=v*c.n;squares[j]+=v*v*c.n;}}}const ranges=options.variance?squares.map((v,i)=>Math.max(0,v-sums[i]*sums[i]/n)*[2,3,1][i]):hi.map((v,i)=>v-lo[i]);const axis=ranges.indexOf(Math.max(...ranges));return {list,n,axis,weight:options.variance?ranges.reduce((a,b)=>a+b,0):Math.max(...ranges)*Math.sqrt(n)};}
 const boxes=[box(colors)];
 while(boxes.length<limit){let best=-1;for(let i=0;i<boxes.length;i++)if(boxes[i].list.length>1&&(best<0||boxes[i].weight>boxes[best].weight))best=i;if(best<0)break;
  const current=boxes[best],key=['r','g','b'][current.axis];current.list.sort((a,b)=>a[key]-b[key]);let n=0,m=0;for(;m<current.list.length-1;m++){n+=current.list[m].n;if(n>=current.n/2)break;}
  // A dominant final colour can put the weighted median at the end. Keep
  // both partitions nonempty so empty boxes cannot fill the palette with NaN.
  m=Math.max(1,Math.min(current.list.length-1,m+1));
  boxes.splice(best,1,box(current.list.slice(0,m)),box(current.list.slice(m)));
  onProgress(.45+.55*boxes.length/limit);
 }
 return boxes.map(b=>{let r=0,g=0,blue=0;for(const c of b.list){r+=c.r*c.n;g+=c.g*c.n;blue+=c.b*c.n;}return [Math.round(r/b.n),Math.round(g/b.n),Math.round(blue/b.n)];});
}
export function quantizerCache(palette){const bins=new Int16Array(32768);bins.fill(-1);return {bins,exact:new Map(palette.map((c,i)=>[(c[0]<<16)|(c[1]<<8)|c[2],i]))};}
export function indexFrames(frames,palette,dither=false,lookup=quantizerCache(palette),onProgress=()=>{}){
 const cache=lookup.bins;let fi=0;
 const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 return frames.map(f=>{const out=new Int16Array(f.width*f.height);for(let p=0,i=0;i<f.data.length;p++,i+=4){if(f.data[i+3]<128){out[p]=-1;continue;}
  const shift=dither?(bayer[((p/f.width|0)%4)*4+p%f.width%4]-7.5)*1.5:0;
  const r=Math.max(0,Math.min(255,f.data[i]+shift)),g=Math.max(0,Math.min(255,f.data[i+1]+shift)),b=Math.max(0,Math.min(255,f.data[i+2]+shift));
  const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3),exact=lookup.exact.get((r<<16)|(g<<8)|b);let best=exact??cache[key];
  if(best<0){let distance=Infinity;for(let c=0;c<palette.length;c++){const a=palette[c],d=2*(r-a[0])**2+3*(g-a[1])**2+(b-a[2])**2;if(d<distance){distance=d;best=c;}}cache[key]=best;}
  out[p]=best;
 }onProgress(++fi/frames.length);return out;});
}
export function raster(indexed,palette,width,height){const out=new Uint8ClampedArray(width*height*4);for(let p=0;p<indexed.length;p++){const c=indexed[p];if(c<0)continue;const rgb=palette[c],i=p*4;out[i]=rgb[0];out[i+1]=rgb[1];out[i+2]=rgb[2];out[i+3]=255;}return {data:out,width,height};}
const hex=rgb=>rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
function tokenize(indexed,width,height,onProgress){
 const layers=[[],[],[],[]],counts=new Map();let done=0;
 for(const frame of indexed)for(let layer=0;layer<4;layer++){
  const rows=[];
  for(let y=layer>>1;y<height;y+=2){const row=[];for(let x=layer%2;x<width;){const color=frame[y*width+x];let run=0;while(x<width&&frame[y*width+x]===color){run++;x+=2;}
    while(run){const n=Math.min(run,128),key=(color+1)*128+n-1;row.push(key);counts.set(key,(counts.get(key)||0)+1);run-=n;}}
   rows.push(row);
  }layers[layer].push(rows);onProgress(++done/(indexed.length*4)*.7);
 }
 if(counts.size<=2048){onProgress(1);return {layers,keys:[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a))};}
 // Bound compact palettes without dropping pixels: uncommon runs decompose
 // into smaller same-colour runs, and every colour retains its unit run.
 const required=new Set([...counts.keys()].map(k=>k&~127));
 const selected=new Set(required);
 for(const [key] of [...counts].sort((a,b)=>b[1]-a[1])){if(selected.size>=2048)break;selected.add(key);}
 const lengths=new Map();for(const key of selected){const c=key>>7,n=(key&127)+1;if(!lengths.has(c))lengths.set(c,[]);lengths.get(c).push(n);}for(const v of lengths.values())v.sort((a,b)=>b-a);
 counts.clear();
 for(const layer of layers)for(const rows of layer)for(let y=0;y<rows.length;y++){
  const out=[];for(const key of rows[y]){const color=key>>7,n=(key&127)+1;let left=n;for(const take of lengths.get(color))while(take<=left){const k=color*128+take-1;out.push(k);counts.set(k,(counts.get(k)||0)+1);left-=take;}}rows[y]=out;
 }
 const keys=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a));
 onProgress(1);return {layers,keys};
}
function packedRun(key,palette){const color=(key>>7)-1,n=(key&127)+1;return (color<0?'000000':hex(palette[color]))+ALPHABET[(color<0?128:0)+n-1];}
function component(key,palette){const c=(key>>7)-1,n=(key&127)+1;return c<0?{text:'  '.repeat(n),bold:true}:{text:'■ '.repeat(n),color:'#'+hex(palette[c])};}
function compactPayload(tokens,palette,patterns,onProgress,high=false){
 const lookup=new Map(tokens.keys.map((key,i)=>[key,ALPHABET[i]]));
 const layers=tokens.layers.map(layer=>layer.map(rows=>rows.map(row=>row.map(k=>lookup.get(k)).join('')).join('_')));
 const groups=[];for(let i=0;i<tokens.keys.length;i+=8)groups.push(tokens.keys.slice(i,i+8).map(k=>packedRun(k,palette)).join(''));
 const unique=[],ids=new Map(),uses=[];const refs=layers.map(layer=>layer.map(text=>{if(!ids.has(text)){ids.set(text,unique.length);unique.push(text);uses.push(0);}const id=ids.get(text);uses[id]++;return id;}));
 function layout(values,aliases={},longest=7){
  const out={codec:'letters5',n:tokens.keys.length,p:groups,k:Math.max(64,Math.min(4096,Math.floor(60000/longest/64)*64))};
  if(Object.keys(aliases).length)out.d=aliases;
  const costs=values.map(v=>bytes(JSON.stringify(v))),directCost=2+refs.length-1+refs.reduce((s,row)=>s+2+Math.max(0,row.length-1)+row.reduce((n,id)=>n+costs[id],0),0);
  const directWork=values.reduce((s,t,i)=>s+uses[i]*120*Math.ceil(t.length/64),0),sharedWork=values.reduce((s,t)=>s+120*Math.ceil(t.length/64),0)+uses.reduce((s,n)=>s+n*30,0);
  if(sharedWork<directWork&&bytes(snbt(values))+bytes(snbt(refs))+5<directCost){out.v=values;out.f=refs;}else out.f=refs.map(row=>row.map(id=>values[id]));
  return out;
 }
 const baseline=layout(unique);onProgress(.3);
 const aliases={},replacements=new Map();let longest=7;
 if(patterns&&tokens.keys.length<2048){
  const rows=new Map();for(const text of unique)for(const row of text.split('_'))if(row.length>=3&&row.length<=128)rows.set(row,(rows.get(row)||0)+1);
  const candidates=[...rows].map(([row,n])=>({row,n,gain:n*(bytes(row)-2)-row.length*6-12})).filter(x=>x.n>=3&&x.gain>0).sort((a,b)=>b.gain-a.gain).slice(0,32);
  for(const {row} of candidates){const code=ALPHABET[tokens.keys.length+Object.keys(aliases).length];if(!code)break;
   const expanded=Array.from(row,ch=>'%'+(ALPHABET.indexOf(ch)+1)+'$s').join('');
   if(rows.get(row)*(bytes(row)-bytes(code))<=bytes(snbt({[code]:expanded})))continue;
   aliases[code]=expanded;replacements.set(row,code);longest=Math.max(longest,bytes(expanded));onProgress(.3+.5*Object.keys(aliases).length/32);
  }
 }
 let best=baseline;
 if(replacements.size){const values=unique.map(text=>text.split('_').map(row=>replacements.get(row)||row).join('_')),out=layout(values,aliases,longest);if(bytes(snbt(out))<bytes(snbt(best)))best=out;}
 if(high&&patterns)best=searchPatterns(unique,tokens.keys.length,ALPHABET,layout,best,v=>onProgress(.8+v*.19),bytes,snbt);
 onProgress(1);return best;
}
function fastPayload(tokens,palette,still){
 const parts=tokens.keys.map(k=>component(k,palette)),lookup=new Map(tokens.keys.map((k,i)=>[k,i+1]));
 const layers=tokens.layers.map(layer=>layer.map(rows=>rows.map(row=>row.map(k=>'%'+lookup.get(k)+'$s').join('')).join('\n')));
 if(!still)return {p:parts,f:layers};
 const height=tokens.layers[0][0].length,rows=layers.map(layer=>layer[0].split('\n')),bands=[[],[],[],[]];
 function band(start,end){return rows.map(rows=>{
  const text='\n'.repeat(start)+rows.slice(start,end).join('\n')+'\n'.repeat(height-end);
  const ids=[...new Set([...text.matchAll(/%(\d+)\$s/g)].map(m=>+m[1]))],map=new Map(ids.map((id,i)=>[id,i+1]));
  return {translate:text.replace(/%(\d+)\$s/g,(_,n)=>'%'+map.get(+n)+'$s'),with:ids.map(i=>parts[i-1])};
 });}
 const full=band(0,height);if(full.every(v=>bytes(snbt(v))<=48000))return {p:[],f:full.map(v=>[v])};
 let start=0;
 while(start<height){let lo=start+1,hi=height,best=null;while(lo<=hi){const end=lo+hi>>1,candidate=band(start,end);if(candidate.every(v=>bytes(snbt(v))<=48000)){best={end,candidate};lo=end+1;}else hi=end-1;}if(!best)throw Error('A row exceeds the safe text size. Reduce pixel width.');for(let i=0;i<4;i++)bands[i].unshift(best.candidate[i]);start=best.end;}
 return {p:[],f:bands};
}
export function encodePixels(indexed,palette,width,height,settings,onProgress=()=>{}){
 const tokens=tokenize(indexed,width,height,v=>onProgress(v*.6)),still=indexed.length===1;
 const data=settings.mode==='fast'?fastPayload(tokens,palette,still):compactPayload(tokens,palette,settings.patterns!==false,v=>onProgress(.6+v*.4),(settings.quality==='high'||settings.quality==='very-high'));onProgress(1);
 const strings=data.v||data.f.flat();
 for(const s of strings)if(typeof s==='string'&&bytes(s)>64000)throw Error('Frame string exceeds Minecraft’s string limit. Reduce pixel width.');
 const used=new Set();for(const key of tokens.keys){const color=(key>>7)-1;if(color>=0)used.add(palette[color].join(','));}
 return {data,static:still,width,height,frames:indexed.length,colors:used.size,entries:tokens.keys.length,bands:still?data.f[0].length:1};
}
const encodedWire=new WeakMap();
export function buildItem(encoded,settings,name){
 const {width,height,frames,colors}=encoded;
 const data={mid:true,c:[width,height,width/2*10+5,encoded.static?0:settings.tpf,Number(settings.billboard)||0,frames,settings.backing?1:0],s:settings.blocks*8/width,...encoded.data};
 const customName=[{color:'gold',italic:false,text:'[MID] - '},{color:'white',text:settings.itemName?.trim()||name}];
 let wire=encodedWire.get(encoded);if(!wire){wire=snbt(encoded.data);encodedWire.set(encoded,wire);}
 const customData='{mid:1b,c:'+snbt(data.c)+',s:'+snbt(data.s)+','+wire.slice(1),nameWire=snbt(customName);
 const entity='{id:"minecraft:item_frame",Tags:["mid"],Item:{id:"minecraft:egg",count:1,components:{"minecraft:custom_name":{color:"gold",text:"Place the MID command block first!"}}},ItemDropChance:0f,Fixed:1b}';
 const components=[['minecraft:entity_data',entity],['minecraft:custom_data',customData],['minecraft:custom_name',nameWire]];
 const stack=settings.syntax==='snbt';
 const prefix=stack?'{components:{'+components.map(([k,v])=>JSON.stringify(k)+':'+v).join(',')+',"minecraft:lore":':(settings.syntax==='vanilla'?'give @p ':settings.syntax==='datapack'?'give @s ':'.give ' )+'minecraft:item_frame['+components.map(([k,v])=>k+'='+v).join(',')+',minecraft:lore=';
 let command='';let size=0;
 for(let pass=0;pass<3;pass++){
  const lore=[
   {color:'aqua',italic:false,text:`${width}x${height} | ${encoded.static?'Image':frames+'-frame GIF'} | ${colors} colors${encoded.static?'':' | '+settings.tpf+' tpf'} | ${(size/1000).toFixed(1)} KB`},
   {text:'',italic:false,extra:[{color:'gray',text:'Place in '},{color:'blue',text:'mainhand '},{color:'gray',text:'to place display centered'}]},
   {text:'',italic:false,extra:[{color:'gray',text:'Place in '},{color:'dark_aqua',text:'offhand '},{color:'gray',text:'to place along block face'}]},
   {text:'',italic:false,extra:[{atlas:'minecraft:gui',color:'#FFFFFF',sprite:'minecraft:icon/unseen_notification'},{color:'red',text:" Requires Piggo's "},{color:'gold',text:'Minecraft Image Display Engine'}]},
   {color:'red',italic:false,text:'https://piggopotamus.github.io'}
  ];
  command=prefix+snbt(lore)+(stack?',"minecraft:enchantment_glint_override":1b},id:"minecraft:item_frame",count:1}':',minecraft:enchantment_glint_override=true] 1');size=bytes(command+'\n');
 }
 return {command,bytes:size,payload:data};
}
