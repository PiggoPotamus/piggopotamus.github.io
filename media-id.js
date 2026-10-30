import {digest256} from './hash.js?v=20261031.3';

export async function mediaId(frames,width,height){
 const header=new TextEncoder().encode(`MID-pixels-v2:${width}:${height}:${frames.length}:`);
 const frameBytes=width*height*4,bytes=new Uint8Array(header.length+frameBytes*frames.length);
 bytes.set(header);let offset=header.length;
 for(const frame of frames){bytes.set(frame.data,offset);offset+=frameBytes;}
 return Array.from(await digest256(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
