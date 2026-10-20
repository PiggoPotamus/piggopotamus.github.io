import {paletteFor} from './codec.js?v=20261020.13';

const weights=[2,3,1];
export function paletteTree(palette){
 function build(ids){if(!ids.length)return null;let axis=0,range=-1;for(let a=0;a<3;a++){let lo=255,hi=0;for(const id of ids){lo=Math.min(lo,palette[id][a]);hi=Math.max(hi,palette[id][a]);}const score=(hi-lo)**2*weights[a];if(score>range){range=score;axis=a;}}ids.sort((a,b)=>palette[a][axis]-palette[b][axis]||a-b);const m=ids.length>>1;return {id:ids[m],axis,left:build(ids.slice(0,m)),right:build(ids.slice(m+1))};}
 return {palette,root:build(palette.map((_,i)=>i)),cache:new Map()};
}
export function nearestColor(tree,r,g,b){
 let best=0,distance=Infinity;const rgb=[r,g,b];
 function visit(node){if(!node)return;const c=tree.palette[node.id],d=2*(r-c[0])**2+3*(g-c[1])**2+(b-c[2])**2;if(d<distance||(d===distance&&node.id<best)){distance=d;best=node.id;}const delta=rgb[node.axis]-c[node.axis],first=delta<0?node.left:node.right,second=delta<0?node.right:node.left;visit(first);if(delta*delta*weights[node.axis]<=distance)visit(second);}
 visit(tree.root);return best;
}
export function mediumQualityPalette(frames,limit,onProgress=()=>{}){
 let palette=paletteFor(frames,limit,v=>onProgress(v*.3),{bits:6,samples:1000000});
 const hist=new Map(),total=frames.reduce((n,f)=>n+f.data.length/4,0),stride=Math.max(1,Math.ceil(total/1000000)),exactColors=new Set(palette.map(c=>(c[0]<<16)|(c[1]<<8)|c[2]));let exact=true;
 for(const f of frames)for(let i=0;i<f.data.length;i+=4*stride){if(f.data[i+3]<128)continue;const r=f.data[i],g=f.data[i+1],b=f.data[i+2],key=((r>>2)<<12)|((g>>2)<<6)|(b>>2);if(!exactColors.has((r<<16)|(g<<8)|b))exact=false;let h=hist.get(key);if(!h){h=[0,0,0,0];hist.set(key,h);}h[0]+=r;h[1]+=g;h[2]+=b;h[3]++;}
 if(exact){onProgress(1);return palette;}
 const samples=[...hist.values()].map(h=>[h[0]/h[3],h[1]/h[3],h[2]/h[3],h[3]]);
 for(let pass=0;pass<6;pass++){
  const tree=paletteTree(palette),sums=palette.map(()=>[0,0,0,0]);for(const [r,g,b,n]of samples){const i=nearestColor(tree,r,g,b),s=sums[i];s[0]+=r*n;s[1]+=g*n;s[2]+=b*n;s[3]+=n;}
  const next=palette.map((c,i)=>sums[i][3]?sums[i].slice(0,3).map(v=>Math.round(v/sums[i][3])):c),same=next.every((c,i)=>c.every((v,a)=>v===palette[i][a]));palette=next;onProgress(.3+.7*(pass+1)/6);if(same)break;
 }
 onProgress(1);return [...new Map(palette.map(c=>[c.join(','),c])).values()];
}
export function highQualityPalette(frames,limit,onProgress=()=>{},depth="very-high"){
 const passes=depth==='high'?12:24;
 let palette=paletteFor(frames,limit,v=>onProgress(v*.12),{bits:6,samples:2000000});
 let hist=new Map(),coarse=false;const total=frames.reduce((n,f)=>n+f.data.length/4,0),stride=Math.max(1,Math.ceil(total/2000000)),exactColors=new Set(palette.map(c=>(c[0]<<16)|(c[1]<<8)|c[2]));let exact=true;
 function add(map,key,r,g,b,n=1){let h=map.get(key);if(!h){h=[0,0,0,0];map.set(key,h);}h[0]+=r*n;h[1]+=g*n;h[2]+=b*n;h[3]+=n;}
 for(const f of frames)for(let i=0;i<f.data.length;i+=4*stride){if(f.data[i+3]<128)continue;const r=f.data[i],g=f.data[i+1],b=f.data[i+2],rgb=(r<<16)|(g<<8)|b;if(!exactColors.has(rgb))exact=false;
  if(!coarse&&hist.size>=262144){const smaller=new Map();for(const h of hist.values()){const [r,g,b]=h.slice(0,3).map(v=>v/h[3]);add(smaller,((r>>2)<<12)|((g>>2)<<6)|(b>>2),r,g,b,h[3]);}hist=smaller;coarse=true;}
  add(hist,coarse?((r>>2)<<12)|((g>>2)<<6)|(b>>2):rgb,r,g,b);
 }
 if(exact){onProgress(1);return palette;}
 const samples=[...hist.values()].map(h=>[h[0]/h[3],h[1]/h[3],h[2]/h[3],h[3]]);
 const seeds=[palette,paletteFor(frames,limit,()=>{},{bits:6,samples:2000000,variance:true}),paletteFor(frames,limit,()=>{},{bits:5,samples:2000000,variance:true})];let best=palette,bestError=Infinity;
 function measure(colors){const tree=paletteTree(colors);let error=0;for(const [r,g,b,n]of samples){const c=colors[nearestColor(tree,r,g,b)];error+=n*(2*(r-c[0])**2+3*(g-c[1])**2+(b-c[2])**2);}return error;}
 for(let seed=0;seed<(depth==='high'?2:seeds.length);seed++){
  palette=seeds[seed];const initial=measure(palette);if(initial<bestError){bestError=initial;best=palette;}
  for(let pass=0;pass<passes;pass++){
   const tree=paletteTree(palette),sums=palette.map(()=>[0,0,0,0]);for(const [r,g,b,n]of samples){const i=nearestColor(tree,r,g,b),s=sums[i];s[0]+=r*n;s[1]+=g*n;s[2]+=b*n;s[3]+=n;}
   const next=palette.map((c,i)=>sums[i][3]?sums[i].slice(0,3).map(v=>Math.round(v/sums[i][3])):c),same=next.every((c,i)=>c.every((v,a)=>v===palette[i][a]));palette=next;onProgress(.2+.8*(seed+(pass+1)/passes)/seeds.length);if(same)break;
  }
  const error=measure(palette);if(error<bestError){bestError=error;best=palette;}
 }
 onProgress(1);return [...new Map(best.map(c=>[c.join(','),c])).values()];
}
export function indexHighQuality(frames,palette,dither=false,tree=paletteTree(palette),onProgress=()=>{}){
 const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 return frames.map((f,fi)=>{const out=new Int16Array(f.width*f.height);for(let p=0,i=0;i<f.data.length;p++,i+=4){if(f.data[i+3]<128){out[p]=-1;continue;}const shift=dither?(bayer[((p/f.width|0)%4)*4+p%f.width%4]-7.5)*.5:0,r=Math.round(Math.max(0,Math.min(255,f.data[i]+shift))),g=Math.round(Math.max(0,Math.min(255,f.data[i+1]+shift))),b=Math.round(Math.max(0,Math.min(255,f.data[i+2]+shift))),key=(r<<16)|(g<<8)|b;let index=tree.cache.get(key);if(index===undefined){index=nearestColor(tree,r,g,b);if(tree.cache.size>=65536)tree.cache.clear();tree.cache.set(key,index);}out[p]=index;}onProgress((fi+1)/frames.length);return out;});
}
// Compare candidates at the original target resolution, so fitting a bigger
// colour palette by throwing away spatial detail is not automatically preferred.
export function reconstructionError(reference,indexed,palette,width,height){
 const stride=Math.max(1,Math.ceil(reference.reduce((n,f)=>n+f.width*f.height,0)/120000));let error=0,count=0;
 for(let fi=0;fi<reference.length;fi++){const f=reference[fi],pixels=indexed[fi];for(let p=0;p<f.width*f.height;p+=stride){const i=p*4,sourceAlpha=f.data[i+3]>=128?255:0,x=Math.min(width-1,Math.floor((p%f.width+.5)*width/f.width)),y=Math.min(height-1,Math.floor(((p/f.width|0)+.5)*height/f.height)),id=pixels[y*width+x],rgb=id<0?[0,0,0]:palette[id],r=rgb[0],g=rgb[1],b=rgb[2],a=id<0?0:255;
   error+=(sourceAlpha?(2*(f.data[i]-r)**2+3*(f.data[i+1]-g)**2+(f.data[i+2]-b)**2)/6:0)+(sourceAlpha-a)**2;count++;
 }}return error/Math.max(1,count);
}
