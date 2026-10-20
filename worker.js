import {resizeNearest,resizeBicubic} from './pixels.js?v=20261020.13';
import {mediumQualityPalette,highQualityPalette,indexHighQuality,paletteTree,reconstructionError} from './quality.js?v=20261020.13';
import {dimensions,paletteFor,indexFrames,quantizerCache,raster,encodePixels,buildItem} from './codec.js?v=20261020.13';
import {decodeGif} from './gif.js?v=20261020.13';
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
   const track=decoder.tracks.selectedTrack,count=settings.still?1:Math.min(settings.maxFrames,Math.max(1,track?.frameCount||1));
   const frames=[];let time=0,target=0,sourceFrames=track?.frameCount||1,decoded=0;
   for(let i=0;i<sourceFrames&&frames.length<count;i++){
    const {image}=await decoder.decode({frameIndex:i,completeFramesOnly:true});
    try{const duration=Math.max(20,(image.duration||100000)/1000),stop=time+duration;
     while(target<stop&&frames.length<count){frames.push(captureImage(image,image.displayWidth,image.displayHeight,settings,count));target+=settings.tpf*50;}
     time=stop;decoded++;
    }finally{image.close();}
    say(.03+.27*((i+1)/sourceFrames),'Decoding image frames');
   }
   if(!frames.length)throw Error('This image has no readable frames');
   return {frames,duration:time,sourceFrames,clipped:sourceFrames>1&&!settings.still&&(decoded<sourceFrames||time>frames.length*settings.tpf*50+1)};
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
function fitMediumQuality(base,settings,name,scale){
 const cap=settings.colors||256,counts=[...new Set([cap,...[192,128,96,64,48,32,16,8,2].filter(n=>n<cap)])];
 let width=base[0].width,height=base[0].height,best=null,firstFit=-1,trial=0;
 for(let level=0;level<16;level++){
  const frames=base.map(f=>scale(f.data,f.width,f.height,width,height));let smallest=Infinity;
  for(const colors of counts){
   const start=.32+.56*(1-.93**trial++),step=(v,message)=>say(Math.min(.9,start+v*.025),message);
   say(start,`Medium: ${width} × ${height}, ${colors} colours`,true);
   const paletteKey=JSON.stringify(['high',width,height,colors]);let p=decodedCache.palettes.get(paletteKey);
   if(!p){const palette=mediumQualityPalette(frames,colors,v=>step(v*.4,'Refining colour palette'));p={palette,lookup:paletteTree(palette)};decodedCache.palettes.set(paletteKey,p);if(decodedCache.palettes.size>3)decodedCache.palettes.delete(decodedCache.palettes.keys().next().value);}
   const {palette,lookup}=p,key=JSON.stringify(['high',width,height,colors,settings.dither]);let indexed=decodedCache.rasters.get(key);
   if(!indexed){indexed=indexHighQuality(frames,palette,settings.dither==='ordered',lookup,v=>step(.4+v*.25,'Matching exact pixel colours'));rememberRaster(decodedCache,key,indexed);}
   try{
    const encoded=encodePixels(indexed,palette,width,height,settings,v=>step(.65+v*.25,'Checking high-quality item size')),item=buildItem(encoded,settings,name);smallest=Math.min(smallest,item.bytes);
    if(item.bytes<=settings.budget){const error=reconstructionError(base,indexed,palette,width,height),candidate={encoded,item,indexed,palette,error};if(!best||error<best.error||(error===best.error&&item.bytes<best.item.bytes))best=candidate;if(level===0&&colors===cap)return best;if(firstFit<0)firstFit=level;break;}
   }catch(error){if(!/string limit|safe text size/.test(error.message))throw error;}
  }
  if(width<=2||(firstFit>=0&&level>=firstFit+2))break;
  const factor=firstFit>=0?.9:Math.min(.9,Number.isFinite(smallest)?Math.sqrt(settings.budget/smallest)*.96:.8);
  width=Math.max(2,Math.floor(width*factor/2)*2);height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);
 }
 return best;
}
function fitHighQuality(base,settings,name,scale){
 const deep=settings.quality==='very-high',cap=settings.colors||256,counts=[...new Set([cap,...Array.from({length:11},(_,i)=>256-i*16),88,80,72,64,56,48,40,32,24,16,12,8,4,2].filter(n=>n<=cap))].sort((a,b)=>b-a);
 let width=base[0].width,height=base[0].height,frontier=[],firstFit=-1,trial=0,bestError=Infinity;const visited=new Set();
 function keep(candidate){bestError=Math.min(bestError,candidate.error);if(frontier.some(c=>c.error<=candidate.error&&c.item.bytes<=candidate.item.bytes))return;frontier=frontier.filter(c=>!(candidate.error<=c.error&&candidate.item.bytes<=c.item.bytes));frontier.push(candidate);if(frontier.length>16){frontier.sort((a,b)=>a.error-b.error);frontier.splice(frontier.length-2,1);}}
 function explore(){
  if(visited.has(width))return Infinity;visited.add(width);
  const frames=base.map(f=>scale(f.data,f.width,f.height,width,height));let smallest=Infinity;
  const seen=new Set();let poor=0;
  for(const colors of (deep?counts:counts.filter((_,i)=>i%2===0||i===counts.length-1))){
   const start=.32+.56*(1-.96**trial++),step=(v,message)=>say(Math.min(.92,start+v*.025),message);
   say(start,`${deep?'Very high':'High'}: trial ${trial}, ${width} × ${height}, ${colors} colours`,true);
   const paletteKey=JSON.stringify(['high',width,height,colors]);let p=decodedCache.palettes.get(paletteKey);
   if(!p){const palette=highQualityPalette(frames,colors,v=>step(v*.4,'Refining colour palette'),settings.quality);p={palette,lookup:paletteTree(palette)};decodedCache.palettes.set(paletteKey,p);if(decodedCache.palettes.size>3)decodedCache.palettes.delete(decodedCache.palettes.keys().next().value);}
   const fingerprint=p.palette.map(c=>c.join(',')).join(';');if(seen.has(fingerprint))continue;seen.add(fingerprint);
   const {palette,lookup}=p,key=JSON.stringify(['high',width,height,colors,settings.dither]);let indexed=decodedCache.rasters.get(key);
   if(!indexed){indexed=indexHighQuality(frames,palette,settings.dither==='ordered',lookup,v=>step(.4+v*.25,'Matching exact pixel colours'));rememberRaster(decodedCache,key,indexed);}
   try{
    const encoded=encodePixels(indexed,palette,width,height,settings,v=>step(.65+v*.25,v>.85?'Searching repeated patterns':'Checking high-quality item size')),item=buildItem(encoded,settings,name);smallest=Math.min(smallest,item.bytes);
    if(item.bytes<=settings.budget){const error=reconstructionError(base,indexed,palette,width,height);keep({encoded,item,palette,error});poor=error>(Math.sqrt(bestError)*1.25+1)**2?poor+1:0;if(poor>=3)break;}
   }catch(error){if(!/string limit|safe text size/.test(error.message))throw error;}
  }
  return smallest;
 }
 for(let level=0;level<16;level++){
  const smallest=explore();if(frontier.length&&firstFit<0)firstFit=level;
  if(width<=2||(firstFit>=0&&level>=firstFit+(deep?5:2)))break;
  const factor=firstFit>=0?.9:Math.min(.9,Number.isFinite(smallest)?Math.sqrt(settings.budget/smallest)*.96:.8);
  width=Math.max(2,Math.floor(width*factor/2)*2);height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);
 }
 if(!frontier.length)return null;
 const sharpest=frontier.reduce((a,b)=>a.error<b.error?a:b).encoded.width;
 for(const delta of (deep?[-4,-2,2,4]:[-2,2])){width=sharpest+delta;if(width<2||width>base[0].width)continue;height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);explore();}
 // Prefer smaller data only inside a tight reconstruction-error tolerance.
 const acceptable=(Math.sqrt(bestError)*1.015+.15)**2,best=frontier.filter(c=>c.error<=acceptable).sort((a,b)=>a.item.bytes-b.item.bytes||a.error-b.error)[0];
 const finalFrames=base.map(f=>scale(f.data,f.width,f.height,best.encoded.width,best.encoded.height));best.indexed=indexHighQuality(finalFrames,best.palette,settings.dither==='ordered');
 return best;
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
  const reused=!!(data.cacheKey&&decodedCache?.key===data.cacheKey&&decodedCache.quality===(settings.quality||'medium'));
  const media=reused?decodedCache.media:data.frames?{frames:data.frames.map(f=>({...f,data:new Uint8ClampedArray(f.data)})),sourceFrames:data.frames.length,duration:data.duration,clipped:data.clipped}:await decodeImage(data.file,settings);
  const base=media.frames;
  if(!base.length)throw Error('No frames were decoded');
  checkMemory(base[0].width,base[0].height,base.length);
  if(!reused)decodedCache={key:data.cacheKey,quality:settings.quality||'medium',media,palettes:new Map(),rasters:new Map()};
  say(.3,reused?'Reusing decoded frames':'Frames decoded',true);
  const scale=scaler(settings);let width=base[0].width,height=base[0].height,final=null;
  if(settings.quality!=='low'&&settings.quality!=='standard'){
   final=(settings.quality==='medium'?fitMediumQuality:fitHighQuality)(base,settings,data.name,scale);
   if(final){width=final.encoded.width;height=final.encoded.height;}
  }else{
  const colors=settings.colors||256;
  let prepared=decodedCache.palettes.get(colors);
  if(!prepared){say(.31,'Selecting palette',true);const palette=paletteFor(base,colors,v=>say(.31+v*.05,'Selecting palette'));prepared={palette,lookup:quantizerCache(palette)};decodedCache.palettes.set(colors,prepared);if(decodedCache.palettes.size>3)decodedCache.palettes.delete(decodedCache.palettes.keys().next().value);}
  const {palette,lookup}=prepared;
  for(let attempt=0;attempt<16;attempt++){
   const start=.36+.52*(1-.45**attempt),end=.36+.52*(1-.45**(attempt+1)),part=(v,message)=>say(start+(end-start)*v,message);
   part(0,`Pass ${attempt+1}: ${width} × ${height} pixels`);
   const rasterKey=JSON.stringify(['standard',width,height,colors,settings.dither]);let indexed=decodedCache.rasters.get(rasterKey);
   if(!indexed){const frames=base.map(f=>scale(f.data,f.width,f.height,width,height));indexed=indexFrames(frames,palette,settings.dither==='ordered',lookup,v=>part(.05+v*.45,'Mapping pixels to palette'));rememberRaster(decodedCache,rasterKey,indexed);}
   try{
    const encoded=encodePixels(indexed,palette,width,height,settings,v=>part(.5+v*.45,'Encoding frame data'));part(.96,'Checking max item size');const item=buildItem(encoded,settings,data.name);
    if(item.bytes<=settings.budget){final={encoded,item,indexed,palette};break;}
    say(end,`Fitting ${(item.bytes/1000).toFixed(0)} KB into ${(settings.budget/1000).toFixed(0)} KB`,true);
    const factor=Math.min(.9,Math.sqrt(settings.budget/item.bytes)*.92);
    if(width<=2)break;width=Math.max(2,Math.floor(width*factor/2)*2);height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);
   }catch(error){
    if(!/string limit|safe text size/.test(error.message)||width<=2)throw error;
    width=Math.max(2,Math.floor(width*.8/2)*2);height=Math.max(2,Math.round(width*base[0].height/base[0].width/2)*2);
   }
  }
  }
  if(!final)throw Error('Cannot fit this media into the item budget. Raise the budget, reduce the frame cap, or use Compact mode.');
  say(.94,'Preparing preview',true);
  const previews=final.indexed.map((f,i)=>{const out=raster(f,final.palette,width,height);say(.94+.05*(i+1)/final.indexed.length,'Preparing preview');return out;});
  last={encoded:final.encoded,name:data.name};
  const result={width,height,frames:previews.length,colors:final.encoded.colors,bytes:final.item.bytes,entries:final.encoded.entries,entities:4*(final.encoded.static?final.encoded.bands:previews.length),elapsed:performance.now()-started,mode:settings.mode,quality:settings.quality||'medium',tpf:settings.tpf,clipped:media.clipped,sourceFrames:media.sourceFrames,cacheKey:data.cacheKey};
  postMessage({type:'done',result,command:final.item.command,previews:previews.map(f=>({...f,data:f.data.buffer}))},previews.map(f=>f.data.buffer));
 }catch(error){postMessage({type:'error',request:data.request,message:error.message||String(error)});}
};
