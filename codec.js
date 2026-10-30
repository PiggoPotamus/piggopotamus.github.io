import {encodeMidp,encodeBest} from './midp-codec.js?v=20261031.3';
import {nbtSize,nbtWeight} from './numeric-codec.js?v=20261031.3';
const utf8=new TextEncoder();
export const bytes=s=>utf8.encode(s).length;
export function snbt(v){
 if(v?.$b)return '[B;'+v.$b.join(',')+']';
 if(v?.$s)return '['+v.$s.map(n=>n+'s').join(',')+']';
 if(v?.$i)return '[I;'+v.$i.join(',')+']';
 if(typeof v==='string')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Invalid numeric value');return String(v);}
 if(typeof v==='boolean')return v?'1b':'0b';
 if(Array.isArray(v))return '['+v.map(snbt).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.entries(v).map(([k,x])=>(/^[A-Za-z0-9_.+-]+$/.test(k)?k:JSON.stringify(k))+':'+snbt(x)).join(',')+'}';
 throw Error('Unsupported item value');
}
export function pixelLimit(value){return Math.max(16,Math.round((Number(value)||16000)/4)*4);}
export function dimensions(w,h,count,settings){
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
export function tokenize(indexed,width,height,onProgress,limit=2048){
 const layers=[[],[],[],[]],counts=new Map();let done=0;
 for(const frame of indexed)for(let layer=0;layer<4;layer++){
  const rows=[];
  for(let y=layer>>1;y<height;y+=2){const row=[];for(let x=layer%2;x<width;){const color=frame[y*width+x];let run=0;while(x<width&&frame[y*width+x]===color){run++;x+=2;}
    while(run){const n=Math.min(run,128),key=(color+1)*128+n-1;row.push(key);counts.set(key,(counts.get(key)||0)+1);run-=n;}}
   rows.push(row);
  }layers[layer].push(rows);onProgress(++done/(indexed.length*4)*.7);
 }
 const originalCount=counts.size;
 if(counts.size<=limit){onProgress(1);return {layers,originalCount,keys:[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a))};}
 const required=new Set([...counts.keys()].map(k=>k&~127));
 const selected=new Set(required);
 for(const [key] of [...counts].sort((a,b)=>b[1]-a[1])){if(selected.size>=limit)break;selected.add(key);}
 const lengths=new Map();for(const key of selected){const c=key>>7,n=(key&127)+1;if(!lengths.has(c))lengths.set(c,[]);lengths.get(c).push(n);}for(const v of lengths.values())v.sort((a,b)=>b-a);
 counts.clear();
 for(const layer of layers)for(const rows of layer)for(let y=0;y<rows.length;y++){
  const out=[];for(const key of rows[y]){const color=key>>7,n=(key&127)+1;let left=n;for(const take of lengths.get(color))while(take<=left){const k=color*128+take-1;out.push(k);counts.set(k,(counts.get(k)||0)+1);left-=take;}}rows[y]=out;
 }
 const keys=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a));
 onProgress(1);return {layers,keys,originalCount};
}
export function encodePixels(indexed,palette,width,height,final=false){
 const out=final?encodeBest(indexed,palette,width,height):encodeMidp(indexed,palette,width,height,253,['none','pos']);
 const used=new Set();for(const key of out.keys){const color=(key>>7)-1;if(color>=0)used.add(palette[color].join(','));}
 return {data:out.data,static:indexed.length===1,width,height,frames:indexed.length,colors:used.size,entries:out.entries,oversize:out.oversize,maxText:out.maxText};
}
const encodedWire=new WeakMap();
export function buildItem(encoded,settings,name){
 const {width,height,frames,colors}=encoded;
 const data={mid:true,h:encoded.id||'0'.repeat(64),c:[width,height,width/2*10+5,encoded.static?0:settings.tpf,Number(settings.billboard)||0,frames,settings.backing?1:0],s:settings.blocks*8/width,...encoded.data};
 const customName=[{color:'gold',italic:false,text:'[MID] - '},{color:'white',text:settings.itemName?.trim()||name}];
 let wire=encodedWire.get(encoded);if(!wire){wire=snbt(encoded.data);encodedWire.set(encoded,wire);}
 const customData='{mid:1b,h:'+JSON.stringify(data.h)+',c:'+snbt(data.c)+',s:'+snbt(data.s)+','+wire.slice(1),nameWire=snbt(customName);
 const entity='{id:"minecraft:item_frame",Tags:["mid"],data:'+customData+',Item:{id:"minecraft:egg",count:1,components:{"minecraft:custom_name":{color:"gold",text:"Place the MID command block first!"}}},ItemDropChance:0f,Fixed:1b}';
 const components=[['minecraft:entity_data',entity],['minecraft:custom_data','{mid:1b}'],['minecraft:custom_name',nameWire]];
 const stack=settings.syntax==='snbt';
 const prefix=stack?'{components:{'+components.map(([k,v])=>JSON.stringify(k)+':'+v).join(',')+',"minecraft:lore":':(settings.syntax==='vanilla'?'give @p ':settings.syntax==='datapack'?'give @s ':'.give ' )+'minecraft:item_frame['+components.map(([k,v])=>k+'='+v).join(',')+',minecraft:lore=';
 let command='';let size=0,commandSize=0;
 for(let pass=0;pass<3;pass++){
  const lore=[
   {color:'aqua',italic:false,text:`${width}x${height} | ${encoded.static?'Image':frames+'-frame GIF'} | ${colors} colors${encoded.static?'':' | '+settings.tpf+' tpf'} | ${(size/1000).toFixed(1)} KB`},
   {text:'',italic:false,extra:[{color:'gray',text:'Place in '},{color:'blue',text:'mainhand '},{color:'gray',text:'to place display centered'}]},
   {text:'',italic:false,extra:[{color:'gray',text:'Place in '},{color:'dark_aqua',text:'offhand '},{color:'gray',text:'to place along block face'}]},
   {text:'',italic:false,extra:[{atlas:'minecraft:gui',color:'#FFFFFF',sprite:'minecraft:icon/unseen_notification'},{color:'red',text:" Requires Piggo's "},{color:'gold',text:'Minecraft Image Display Engine'}]},
   {color:'red',italic:false,text:'https://piggopotamus.github.io'}
  ];
  command=prefix+snbt(lore)+(stack?',"minecraft:enchantment_glint_override":1b},id:"minecraft:item_frame",count:1}':',minecraft:enchantment_glint_override=true] 1');commandSize=bytes(command+'\n');
  const entityValue={id:'minecraft:item_frame',Tags:['mid'],data,Item:{id:'minecraft:egg',count:1,components:{'minecraft:custom_name':{color:'gold',text:'Place the MID command block first!'}}},ItemDropChance:0,Fixed:true};
  size=nbtSize({id:'minecraft:item_frame',count:1,components:{'minecraft:entity_data':entityValue,'minecraft:custom_data':{mid:true},'minecraft:custom_name':customName,'minecraft:lore':lore,'minecraft:enchantment_glint_override':true}});
 }
 const entityValue={id:'minecraft:item_frame',Tags:['mid'],data,Item:{id:'minecraft:egg',count:1},ItemDropChance:0,Fixed:true};
 return {command,bytes:size,commandBytes:commandSize,payload:data,weight:nbtWeight(entityValue)};
}
