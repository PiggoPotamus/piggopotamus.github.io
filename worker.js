import {resizeNearest} from './pixels.js?v=20261020.8';
import {dimensions,paletteFor,indexFrames,quantizerCache,raster,encodePixels,buildItem} from './codec.js?v=20261020.8';
import {decodeGif} from './gif.js?v=20261020.8';
let lastProgress=0;
const say=(value,message,force=false)=>{const now=performance.now();if(force||now-lastProgress>=33){lastProgress=now;postMessage({type:'progress',value,message});}};
let last=null,decodedCache=null;
function scaler(settings,snapshot=false){
 const source=new OffscreenCanvas(1,1),dest=new OffscreenCanvas(1,1),a=source.getContext('2d'),b=dest.getContext('2d',{willReadFrequently:true});
 return (data,width,height,w,h)=>{
  if(width===w&&height===h)return {data:snapshot?new Uint8ClampedArray(data):data,width:w,height:h};
  if(settings.filter==='nearest')return resizeNearest(data,width,height,w,h);
  source.width=width;source.height=height;dest.width=w;dest.height=h;
  a.putImageData(new ImageData(data,width,height),0,0);b.imageSmoothingEnabled=settings.filter!=='nearest';b.imageSmoothingQuality='high';b.drawImage(source,0,0,w,h);
  return {data:b.getImageData(0,0,w,h).data,width:w,height:h};
 };
}
function captureImage(image,width,height,settings,count){
 const target=dimensions(width,height,count,settings);
 if(settings.filter==='nearest'){checkMemory(width,height,1);const native=new OffscreenCanvas(width,height),ctx=native.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);return resizeNearest(ctx.getImageData(0,0,width,height).data,width,height,target.width,target.height);}
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
  const started=performance.now(),settings=data.settings;
  lastProgress=0;say(.02,'Reading media',true);
  const reused=!!(data.cacheKey&&decodedCache?.key===data.cacheKey);
  const media=reused?decodedCache.media:data.frames?{frames:data.frames.map(f=>({...f,data:new Uint8ClampedArray(f.data)})),sourceFrames:data.frames.length,duration:data.duration,clipped:data.clipped}:await decodeImage(data.file,settings);
  const base=media.frames;
  if(!base.length)throw Error('No frames were decoded');
  checkMemory(base[0].width,base[0].height,base.length);
  if(!reused)decodedCache={key:data.cacheKey,media,palettes:new Map(),rasters:new Map()};
  say(.3,reused?'Reusing decoded frames':'Frames decoded',true);
  const scale=scaler(settings);let width=base[0].width,height=base[0].height,final=null;
  const colors=settings.colors||256;
  let prepared=decodedCache.palettes.get(colors);
  if(!prepared){say(.31,'Selecting palette',true);const palette=paletteFor(base,colors,v=>say(.31+v*.05,'Selecting palette'));prepared={palette,lookup:quantizerCache(palette)};decodedCache.palettes.set(colors,prepared);if(decodedCache.palettes.size>3)decodedCache.palettes.delete(decodedCache.palettes.keys().next().value);}
  const {palette,lookup}=prepared;
  for(let attempt=0;attempt<16;attempt++){
   const start=.36+.52*(1-.45**attempt),end=.36+.52*(1-.45**(attempt+1)),part=(v,message)=>say(start+(end-start)*v,message);
   part(0,`Pass ${attempt+1}: ${width} × ${height} pixels`);
   const rasterKey=JSON.stringify([width,height,colors,settings.dither]);let indexed=decodedCache.rasters.get(rasterKey);
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
  if(!final)throw Error('Cannot fit this media into the item budget. Raise the budget, reduce the frame cap, or use Compact mode.');
  say(.94,'Preparing preview',true);
  const previews=final.indexed.map((f,i)=>{const out=raster(f,final.palette,width,height);say(.94+.05*(i+1)/final.indexed.length,'Preparing preview');return out;});
  last={encoded:final.encoded,name:data.name};
  const result={width,height,frames:previews.length,colors:final.encoded.colors,bytes:final.item.bytes,entries:final.encoded.entries,entities:4*(final.encoded.static?final.encoded.bands:previews.length),elapsed:performance.now()-started,mode:settings.mode,tpf:settings.tpf,clipped:media.clipped,sourceFrames:media.sourceFrames,cacheKey:data.cacheKey};
  postMessage({type:'done',result,command:final.item.command,previews:previews.map(f=>({...f,data:f.data.buffer}))},previews.map(f=>f.data.buffer));
 }catch(error){postMessage({type:'error',request:data.request,message:error.message||String(error)});}
};
