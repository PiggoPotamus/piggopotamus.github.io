// Explicit nearest-neighbour sampling: never average neighbouring colours.
export function resizeNearest(data,width,height,targetWidth,targetHeight){
 const out=new Uint8ClampedArray(targetWidth*targetHeight*4),xs=new Int32Array(targetWidth);
 for(let x=0;x<targetWidth;x++)xs[x]=Math.min(width-1,Math.floor((x+.5)*width/targetWidth))*4;
 for(let y=0;y<targetHeight;y++){const row=Math.min(height-1,Math.floor((y+.5)*height/targetHeight))*width*4;for(let x=0;x<targetWidth;x++){const src=row+xs[x],dst=(y*targetWidth+x)*4;out[dst]=data[src];out[dst+1]=data[src+1];out[dst+2]=data[src+2];out[dst+3]=data[src+3];}}
 return {data:out,width:targetWidth,height:targetHeight};
}
