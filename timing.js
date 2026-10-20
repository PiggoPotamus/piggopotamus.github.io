// TPF controls sample spacing and playback delay. The cap drops samples across
// the whole clip without increasing the playback delay, shortening capped clips.
export function framePlan(duration,tpf=3,maxFrames=75,still=false){
 const interval=Math.max(50,tpf*50),natural=Math.max(1,Math.ceil(duration/interval)),count=still?1:Math.min(Math.max(1,maxFrames),natural),reduced=!still&&count<natural;
 const times=Array.from({length:count},(_,i)=>reduced&&count>1?Math.round(i*(natural-1)/(count-1))*interval:i*interval);
 return {times,reduced,ticks:count*tpf};
}
export function grayscaleFrames(frames){return frames.map(f=>{const data=new Uint8ClampedArray(f.data);for(let i=0;i<data.length;i+=4){const y=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);data[i]=data[i+1]=data[i+2]=y;}return {...f,data};});}
