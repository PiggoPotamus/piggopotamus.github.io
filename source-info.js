import {readGif,lzw} from './gif.js?v=20261020.8';
// Bitset keeps exact RGB counting bounded to 2 MiB, regardless of palette size.
export function colourCounter(){const seen=new Uint8Array(1<<21);let colors=0,transparent=false;return {add(r,g,b,a=255){if(a<128){transparent=true;return;}const key=(r<<16)|(g<<8)|b,mask=1<<(key&7),i=key>>>3;if(!(seen[i]&mask)){seen[i]|=mask;colors++;}},get colors(){return colors;},get transparent(){return transparent;}};}
export function gifInfo(buffer){const gif=readGif(buffer),count=colourCounter();for(const f of gif.frames){const pixels=lzw(f.data,f.min,f.width*f.height),used=new Uint8Array(256);for(const index of pixels)used[index]=1;for(let i=0;i<256;i++)if(used[i])count.add(f.palette[i*3],f.palette[i*3+1],f.palette[i*3+2],i===f.transparent?0:255);}return {width:gif.width,height:gif.height,frames:gif.frames.length,colors:count.colors,transparent:count.transparent};}
export async function imageInfo(file){
 const head=new Uint8Array(await file.slice(0,6).arrayBuffer());
 if(String.fromCharCode(...head).startsWith('GIF8'))return gifInfo(await file.arrayBuffer());
 const bitmap=await createImageBitmap(file);try{
  if(bitmap.width*bitmap.height>32000000)throw Error('Source image too large for colour counting.');
  const canvas=new OffscreenCanvas(bitmap.width,Math.min(bitmap.height,128)),ctx=canvas.getContext('2d',{willReadFrequently:true}),count=colourCounter();
  for(let y=0;y<bitmap.height;y+=canvas.height){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,-y);const data=ctx.getImageData(0,0,canvas.width,Math.min(canvas.height,bitmap.height-y)).data;for(let i=0;i<data.length;i+=4)count.add(data[i],data[i+1],data[i+2],data[i+3]);}
  return {width:bitmap.width,height:bitmap.height,frames:1,colors:count.colors,transparent:count.transparent,firstFrame:/\.(webp|png|avif)$/i.test(file.name)};
 }finally{bitmap.close();}
}
if(typeof self!=='undefined')self.onmessage=async({data})=>{try{self.postMessage(await imageInfo(data.file));}catch(error){self.postMessage({error:error.message});}};
