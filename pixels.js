// Explicit nearest-neighbour sampling: never average neighbouring colours.
export function resizeNearest(data,width,height,targetWidth,targetHeight){
 const out=new Uint8ClampedArray(targetWidth*targetHeight*4),xs=new Int32Array(targetWidth);
 for(let x=0;x<targetWidth;x++)xs[x]=Math.min(width-1,Math.floor((x+.5)*width/targetWidth))*4;
 for(let y=0;y<targetHeight;y++){const row=Math.min(height-1,Math.floor((y+.5)*height/targetHeight))*width*4;for(let x=0;x<targetWidth;x++){const src=row+xs[x],dst=(y*targetWidth+x)*4;out[dst]=data[src];out[dst+1]=data[src+1];out[dst+2]=data[src+2];out[dst+3]=data[src+3];}}
 return {data:out,width:targetWidth,height:targetHeight};
}

function cubic(x){x=Math.abs(x);return x<1?1.5*x*x*x-2.5*x*x+1:x<2?-.5*x*x*x+2.5*x*x-4*x+2:0;}
function contributions(source,target){const scale=Math.max(1,source/target),radius=2*scale;return Array.from({length:target},(_,i)=>{const center=(i+.5)*source/target-.5,points=[];let sum=0;for(let p=Math.ceil(center-radius);p<=Math.floor(center+radius);p++){const weight=cubic((p-center)/scale);if(weight){points.push([Math.max(0,Math.min(source-1,p)),weight]);sum+=weight;}}return points.map(([p,w])=>[p,w/sum]);});}
// Antialiased bicubic filtering with premultiplied alpha. Work is separable,
// and the kernel widens when downscaling instead of aliasing fine detail.
export function resizeBicubic(data,width,height,targetWidth,targetHeight){
 if(width===targetWidth&&height===targetHeight)return {data:new Uint8ClampedArray(data),width,height};
 const xs=contributions(width,targetWidth),ys=contributions(height,targetHeight),horizontal=new Float32Array(targetWidth*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<targetWidth;x++){const dst=(y*targetWidth+x)*4;let r=0,g=0,b=0,a=0;for(const [p,w]of xs[x]){const src=(y*width+p)*4,alpha=data[src+3];r+=data[src]*alpha/255*w;g+=data[src+1]*alpha/255*w;b+=data[src+2]*alpha/255*w;a+=alpha*w;}horizontal[dst]=r;horizontal[dst+1]=g;horizontal[dst+2]=b;horizontal[dst+3]=a;}
 const out=new Uint8ClampedArray(targetWidth*targetHeight*4);
 for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){let r=0,g=0,b=0,a=0;for(const [p,w]of ys[y]){const src=(p*targetWidth+x)*4;r+=horizontal[src]*w;g+=horizontal[src+1]*w;b+=horizontal[src+2]*w;a+=horizontal[src+3]*w;}const dst=(y*targetWidth+x)*4;if(a>1e-6){out[dst]=r*255/a;out[dst+1]=g*255/a;out[dst+2]=b*255/a;out[dst+3]=a;}}
 return {data:out,width:targetWidth,height:targetHeight};
}
