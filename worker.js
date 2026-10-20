import {framePlan,grayscaleFrames} from './timing.js?v=20261020.18';
import {resizeNearest,resizeBicubic} from './pixels.js?v=20261020.18';
import {paletteCounts,mediumQualityPalette,highQualityPalette,indexHighQuality,paletteTree,reconstructionError} from './quality.js?v=20261020.18';
import {dimensions,paletteFor,raster,encodePixels,buildItem} from './codec.js?v=20261020.18';
import {decodeGif} from './gif.js?v=20261020.18';
let lastProgress=0;
const say=(value,message,force=false)=>{const now=performance.now();if(force||now-lastProgress>=33){lastProgress=now;postMessage({type:'progress',value,message});}};
let last=null,decodedCache=null;
function scaler(settings,snapshot=false){
 const source=new OffscreenCanvas(1,1),dest=new OffscreenCanvas(1,1),a=source.getContext('2d'),b=dest.getContext('2d',{willReadFrequently:true});
 return (data,width,height,w,h)=>{
  if(width===w&&height===h)return {data:snapshot?new Uint8ClampedArray(data):data,width:w,height:h};
  if(settings.filter==='nearest')return resizeNearest(data,width,height,w,h);
  if(settings.quality!=='low'&&settings.quality!=='standard')return resizeBicubic(data,width,height,w,h);
  source.width=width;source.height=height;dest.width=w;dest.height=h;
  a.putImageData(new ImageData(data,width,height),0,0);b.imageSmoothingEnabled=settings.filter!=='nearest';b.imageSmoothingQuality='high';b.drawImage(source,0,0,w,h);
  return {data:b.getImageData(0,0,w,h).data,width:w,height:h};
 };
}
function captureImage(image,width,height,settings,count){
 const target=dimensions(width,height,count,settings);
 if(settings.filter==='nearest'||settings.quality!=='low'&&settings.quality!=='standard'){checkMemory(width,height,1);checkMemory(target.width,target.height,count);const native=new OffscreenCanvas(width,height),ctx=native.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);return (settings.filter==='nearest'?resizeNearest:resizeBicubic)(ctx.getImageData(0,0,width,height).data,width,height,target.width,target.height);}
 const canvas=new OffscreenCanvas(target.width,target.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
 checkMemory(target.width,target.height,count);
 ctx.imageSmoothingEnabled=settings.filter!=='nearest';ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,target.width,target.height);
 return {data:ctx.getImageData(0,0,target.width,target.height).data,...target};
}
async function decodeImage(file,settings){
 const buffer=await file.arrayBuffer(),signature=new Uint8Array(buffer,0,Math.min(6,buffer.byteLength));
 const isGif=String.fromCharCode(...signature).startsWith('GIF8');
 if(isGif){let target;const scale=scaler(settings,true);return decodeGif(buffer,{tpf:settings.tpf,maxFrames:settings.maxFrames,still:settings.still,
  onInfo:info=>{target=dimensions(info.width,info.height,info.count,settings);checkMemory(target.width,target.height,info.count);},
  capture:(data,w,h)=>scale(data,w,h,target.width,target.height),progress:v=>say(.03+v*.27,'Decoding GIF frames')});}
 if(typeof ImageDecoder!=='undefined'&&file.type&&await ImageDecoder.isTypeSupported(file.type)){
  const decoder=new ImageDecoder({data:buffer,type:file.type,preferAnimation:true});
  try{
   await decoder.tracks.ready;await decoder.completed;
   const sourceFrames=decoder.tracks.selectedTrack?.frameCount||1,durations=[];let duration=0;
   for(let i=0;i<sourceFrames;i++){const {image}=await decoder.decode({frameIndex:i,completeFramesOnly:true});try{durations.push(Math.max(20,(image.duration||100000)/1000));duration+=durations[i];}finally{image.close();}say(.03+.08*(i+1)/sourceFrames,'Reading animation timing');}
   const plan=framePlan(duration,settings.tpf,settings.maxFrames,settings.still||sourceFrames===1),frames=[];let time=0;
   for(let i=0;i<sourceFrames&&frames.length<plan.times.length;i++){const stop=time+durations[i];if(plan.times[frames.length]<stop){const {image}=await decoder.decode({frameIndex:i,completeFramesOnly:true});try{while(frames.length<plan.times.length&&plan.times[frames.length]<stop)frames.push(captureImage(image,image.displayWidth,image.displayHeight,settings,plan.times.length));}finally{image.close();}}time=stop;say(.11+.19*(i+1)/sourceFrames,'Decoding image frames');}
   if(!frames.length)throw Error('This image has no readable frames');
   return {frames,duration:sourceFrames>1?duration:0,sourceFrames,clipped:plan.reduced};
  }finally{decoder.close();}
 }
 // Static images use the browser's own format decoders. Animated formats
 // without ImageDecoder are never silently exported as a single-frame GIF.
 if(/\.webp$/i.test(file.name)&&!settings.still){const b=new Uint8Array(buffer);if(b.length>21&&(b[20]&2))throw Error('Animated WebP needs ImageDecoder in this browser. Use a GIF, Chrome/Edge.');}
 if(!settings.still&&/\.png$/i.test(file.name)){
  const view=new DataView(buffer);for(let p=8;p+12<=buffer.byteLength;){const n=view.getUint32(p),tag=view.getUint32(p+4);if(tag===0x6163544c)throw Error('Animated PNG needs ImageDecoder in this browser. Use a GIF.');if(tag===0x49444154)break;if(n>buffer.byteLength-p-12)break;p+=n+12;}
 }
 let bitmap;try{bitmap=await createImageBitmap(new Blob([buffer],{type:file.type}));}catch{throw Error('Your browser cannot decode this image. Try PNG, JPEG, GIF or WebP.');}
 try{return {frames:[captureImage(bitmap,bitmap.width,bitmap.height,settings,1)],duration:0,sourceFrames:1,clipped:false};}finally{bitmap.close();}
}
function checkMemory(width,height,count){if(width*height*count>32000000)throw Error('This conversion needs too much browser memory. Reduce Max pixels per frame or Frame cap.');}
function rememberRaster(cache,key,value){const pixels=value.reduce((s,f)=>s+f.length,0);if(pixels>8000000)return;cache.rasters.set(key,value);let total=[...cache.rasters.values()].reduce((sum,frames)=>sum+frames.reduce((s,f)=>s+f.length,0),0);while(total>8000000||cache.rasters.size>3){const oldest=cache.rasters.keys().next().value;total-=cache.rasters.get(oldest).reduce((s,f)=>s+f.length,0);cache.rasters.delete(oldest);}}
function fitQuality(base,settings,name,scale){
 const quality=settings.quality,cap=settings.colors||256,minimum=Math.min(cap,32),all=paletteCounts(cap,quality==='low'||quality==='standard'?'medium':quality),counts=all.filter(n=>n>=minimum),label=quality==='very-high'?'Very high':quality==='high'?'High':quality==='medium'?'Medium':'Low';
 let best=null,bestError=Infinity,trial=0,firstFit=-1;
 const paletteMaker=quality==='very-high'||quality==='high'?highQualityPalette:quality==='medium'?mediumQualityPalette:paletteFor;
 const afterFit=quality==='very-high'?5:quality==='high'?3:2,refinements=quality==='very-high'?8:quality==='high'?5:3;
 let width=base[0].width,height=base[0].height;
 for(let level=0;level<18;level++){
  const frames=base.map(f=>scale(f.data,f.width,f.height,width,height));let failed=cap+1,fitted=null,smallest=Infinity;
  function attempt(colors){
   say(.32+.58*(1-.96**trial++),`${label}: ${width} × ${height}, ${colors} colours`,true);
   const pk=JSON.stringify([quality,width,height,colors]);let p=decodedCache.palettes.get(pk);
   if(!p){const palette=paletteMaker(frames,colors,()=>{},quality);p={palette,lookup:paletteTree(palette)};decodedCache.palettes.set(pk,p);if(decodedCache.palettes.size>3)decodedCache.palettes.delete(decodedCache.palettes.keys().next().value);}
   const {palette,lookup}=p,key=JSON.stringify([pk,settings.dither]);let indexed=decodedCache.rasters.get(key);
   if(!indexed){indexed=indexHighQuality(frames,palette,settings.dither==='ordered',lookup);rememberRaster(decodedCache,key,indexed);}
   try{const encoded=encodePixels(indexed,palette,width,height,settings),item=buildItem(encoded,settings,name);smallest=Math.min(smallest,item.bytes);if(item.bytes>settings.budget)return null;
    const error=reconstructionError(base,indexed,palette,width,height),candidate={encoded,item,palette,error};
    if(!best||(width===best.encoded.width&&height===best.encoded.height&&encoded.colors>best.encoded.colors)||((width!==best.encoded.width||height!==best.encoded.height||encoded.colors===best.encoded.colors)&&error<bestError)){best=candidate;bestError=error;}
    return candidate;
   }catch(error){if(!/string limit|safe text size/.test(error.message))throw error;return null;}
  }
  // Search at least 32 colours (or the user's lower target), then lower pixels.
  for(const colors of counts){const candidate=attempt(colors);if(candidate){fitted=colors;break;}failed=colors;}
  // Spend spare budget on intermediate palettes rather than stopping at 16/32/64.
  if(fitted!==null){if(firstFit<0)firstFit=level;let lo=fitted,hi=failed-1;for(let n=0;n<refinements&&lo<hi;n++){const mid=Math.ceil((lo+hi)/2),candidate=attempt(mid);if(candidate)lo=mid;else hi=mid-1;}
   if(level===0&&fitted===cap)break;
  }
  if(width<=2||(firstFit>=0&&level>=firstFit+afterFit))break;
  const factor=firstFit>=0?.9:Math.min(.9,Number.isFinite(smallest)?Math.sqrt(settings.budget/smallest)*.98:.8);
  width=Math.max(2,Math.floor(width*factor/2)*2);height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);
 }
 if(!best)return null;
 const frames=base.map(f=>scale(f.data,f.width,f.height,best.encoded.width,best.encoded.height));best.indexed=indexHighQuality(frames,best.palette,settings.dither==='ordered');return best;
}
self.onmessage=async({data})=>{
 try{
  if(data.type==='adjust'){
   if(!last)throw Error('Convert media first');
   const item=buildItem(last.encoded,data.settings,last.name);
   if(item.bytes>data.settings.budget)throw Error('New placement settings exceed the item budget. Convert again.');
   postMessage({type:'adjusted',request:data.request,command:item.command,bytes:item.bytes});return;
  }
  if(data.type!=='convert')return;
  if(typeof OffscreenCanvas==='undefined')throw Error('This browser needs OffscreenCanvas. Please use a current Chrome, Edge, Firefox or Safari.');
  const started=performance.now(),settings={...data.settings,quality:data.settings.quality||'medium'};
  lastProgress=0;say(.02,'Reading media',true);
  const reused=!!(data.cacheKey&&decodedCache?.key===data.cacheKey&&decodedCache.quality===(settings.quality||'medium')&&decodedCache.grayscale===!!settings.grayscale);
  const media=reused?decodedCache.media:data.frames?{frames:data.frames.map(f=>({...f,data:new Uint8ClampedArray(f.data)})),sourceFrames:data.sourceFrames??data.frames.length,duration:data.duration,clipped:data.clipped}:await decodeImage(data.file,settings);
  const base=reused?media.frames:settings.grayscale?grayscaleFrames(media.frames):media.frames;
  if(!reused)media.frames=base;
  if(!base.length)throw Error('No frames were decoded');
  checkMemory(base[0].width,base[0].height,base.length);
  if(!reused)decodedCache={key:data.cacheKey,quality:settings.quality||'medium',grayscale:!!settings.grayscale,media,palettes:new Map(),rasters:new Map()};
  say(.3,reused?'Reusing decoded frames':'Frames decoded',true);
  const scale=scaler(settings);let width=base[0].width,height=base[0].height,final=null;
  final=fitQuality(base,settings,data.name,scale);
  if(final){width=final.encoded.width;height=final.encoded.height;}
  if(!final)throw Error('Cannot fit this media into the item budget. Raise the budget, reduce the frame cap, or use Compact mode.');
  say(.94,'Preparing preview',true);
  const previews=final.indexed.map((f,i)=>{const out=raster(f,final.palette,width,height);say(.94+.05*(i+1)/final.indexed.length,'Preparing preview');return out;});
  last={encoded:final.encoded,name:data.name};
  const result={width,height,frames:previews.length,colors:final.encoded.colors,bytes:final.item.bytes,entries:final.encoded.entries,entities:4*(final.encoded.static?final.encoded.bands:previews.length),elapsed:performance.now()-started,mode:settings.mode,quality:settings.quality||'medium',tpf:settings.tpf,ticks:(media.sourceFrames===1||media.frames.length===1&&!media.duration)?0:previews.length*settings.tpf,clipped:media.clipped,sourceFrames:media.sourceFrames,cacheKey:data.cacheKey};
  postMessage({type:'done',result,command:final.item.command,previews:previews.map(f=>({...f,data:f.data.buffer}))},previews.map(f=>f.data.buffer));
 }catch(error){postMessage({type:'error',request:data.request,message:error.message||String(error)});}
};
