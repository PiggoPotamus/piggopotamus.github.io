import {framePlan} from './timing.js?v=20261020.18';
// GIF89a parser and LZW decoder, including interlacing and disposal 2/3.
// Built in so GIF conversion also works without ImageDecoder or a CDN.
export function readGif(buffer){
 const b=new Uint8Array(buffer);let p=0;
 const read=()=>{if(p>=b.length)throw Error('Truncated GIF');return b[p++];};
 const word=()=>read()|read()<<8;
 const table=n=>{if(p+n*3>b.length)throw Error('Truncated GIF colour table');const a=b.slice(p,p+n*3);p+=n*3;return a;};
 const blocks=()=>{const out=[];let total=0;for(let n=read();n;n=read()){if(p+n>b.length)throw Error('Truncated GIF block');out.push(b.subarray(p,p+n));total+=n;p+=n;}const all=new Uint8Array(total);let offset=0;for(const v of out){all.set(v,offset);offset+=v.length;}return all;};
 const signature=String.fromCharCode(...b.subarray(0,6));if(signature!=='GIF87a'&&signature!=='GIF89a')throw Error('Invalid GIF header');p=6;
 const width=word(),height=word(),packed=read(),background=read();read();
 if(!width||!height||width*height>16777216)throw Error('GIF canvas is too large (maximum 16 megapixels).');
 const global=packed&128?table(1<<((packed&7)+1)):null,frames=[];let gce={delay:100,disposal:0,transparent:-1};
 while(p<b.length){const type=read();if(type===0x3b)break;if(type===0x21){const label=read();if(label===0xf9){if(read()!==4)throw Error('Invalid GIF control block');const flags=read(),delay=word(),transparent=read();if(read()!==0)throw Error('Invalid GIF control terminator');gce={delay:delay?Math.max(20,delay*10):100,disposal:(flags>>2)&7,transparent:flags&1?transparent:-1};}else blocks();continue;}
  if(type!==0x2c)throw Error('Unsupported GIF block');
  const x=word(),y=word(),w=word(),h=word(),flags=read(),palette=flags&128?table(1<<((flags&7)+1)):global,min=read(),data=blocks();
  if(!palette||!w||!h||x+w>width||y+h>height||min<2||min>8)throw Error('Invalid GIF frame');
  frames.push({x,y,width:w,height:h,interlaced:!!(flags&64),palette,min,data,...gce});gce={delay:100,disposal:0,transparent:-1};
  if(frames.length>20000)throw Error('GIF has too many frames.');
 }
 if(!frames.length)throw Error('GIF has no frames');return {width,height,background,global,frames};
}
export function lzw(data,min,expected){
 const prefix=new Uint16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097),out=new Uint8Array(expected);
 const clear=1<<min,end=clear+1;let size=min+1,next=end+1,old=-1,first=0,bit=0,pos=0;
 for(let i=0;i<clear;i++)suffix[i]=i;
 while(bit+size<=data.length*8){let code=0;for(let n=0;n<size;n++,bit++)code|=((data[bit>>3]>>(bit&7))&1)<<n;
  if(code===clear){size=min+1;next=end+1;old=-1;continue;}if(code===end)break;
  if(code>next||code>=4096)throw Error('Invalid GIF LZW code');
  if(old<0){if(code>=clear)throw Error('Invalid GIF first pixel');if(pos<expected)out[pos++]=suffix[code];first=code;old=code;continue;}
  const input=code;let top=0;
  if(code===next){stack[top++]=first;code=old;}
  let depth=0;while(code>=clear){if(code>=next||depth++>4096)throw Error('Invalid GIF dictionary');stack[top++]=suffix[code];code=prefix[code];}
  first=suffix[code];stack[top++]=first;
  while(top){if(pos>=expected)throw Error('GIF frame expands past its dimensions');out[pos++]=stack[--top];}
  if(next<4096){prefix[next]=old;suffix[next]=first;next++;if(next===(1<<size)&&size<12)size++;}old=input;
 }
 if(pos!==expected)throw Error('Incomplete GIF pixels');return out;
}
export function decodeGif(buffer,options={}){
 const info=readGif(buffer),{width,height}=info,total=info.frames.reduce((s,f)=>s+f.delay,0);
 const plan=framePlan(total,options.tpf||3,options.maxFrames||75,options.still||info.frames.length===1),count=plan.times.length;
 options.onInfo?.({...info,count,duration:total});
 const canvas=new Uint8ClampedArray(width*height*4),output=[];let time=0;
 const background=info.global&&info.background*3+2<info.global.length?[...info.global.subarray(info.background*3,info.background*3+3),255]:[0,0,0,0];
 if(info.frames[0].transparent<0)for(let p=0;p<canvas.length;p+=4)canvas.set(background,p);
 for(let fi=0;fi<info.frames.length&&output.length<count;fi++){
  const f=info.frames[fi],saved=f.disposal===3?canvas.slice():null,pixels=lzw(f.data,f.min,f.width*f.height);
  const rows=[];if(f.interlaced){for(const [start,step] of [[0,8],[4,8],[2,4],[1,2]])for(let y=start;y<f.height;y+=step)rows.push(y);}else for(let y=0;y<f.height;y++)rows.push(y);
  for(let row=0;row<f.height;row++)for(let x=0;x<f.width;x++){
   const c=pixels[row*f.width+x];if(c===f.transparent)continue;if(c*3+2>=f.palette.length)throw Error('GIF pixel colour is out of range');
   const dst=((f.y+rows[row])*width+f.x+x)*4;canvas[dst]=f.palette[c*3];canvas[dst+1]=f.palette[c*3+1];canvas[dst+2]=f.palette[c*3+2];canvas[dst+3]=255;
  }
  const stop=time+f.delay;
  while(output.length<count&&plan.times[output.length]<stop){output.push(options.capture?options.capture(canvas,width,height):{data:canvas.slice(),width,height});}
  if(f.disposal===2)for(let y=f.y;y<f.y+f.height;y++)for(let x=f.x;x<f.x+f.width;x++)canvas.set(f.transparent<0?background:[0,0,0,0],(y*width+x)*4);
  else if(saved)canvas.set(saved);
  time=stop;options.progress?.(Math.min(1,time/total));
 }
 return {frames:output,duration:total,sourceFrames:info.frames.length,clipped:plan.reduced,ticks:info.frames.length>1?plan.ticks:0};
}
