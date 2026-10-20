import {createDatapack,syncRecipient} from './datapack.js?v=20261020.8';
import {exportFilename} from './item-format.js?v=20261020.8';
import {resizeNearest} from './pixels.js?v=20261020.8';
import {dimensions} from './codec.js?v=20261020.8';
const $=s=>document.querySelector(s),form=$('#settings');
let mode='compact',file=null,worker=null,busy=false,result=null,command='',processed=[],frame=0,playing=false,lastFrame=0,source=null,sourceURL='',view='source',zoom=1,generation=0,controller=null,signature='',adjustTimer=null,adjustSeq=0,conversionStarted=0,progressFloor=0,cachedMediaKey='',conversionKey='',animationHandle=0;
let previewWorker=null,sourceInfo=null;
const placement=new Set(['blocks','billboard','backing','syntax']);
function settings(){const d=new FormData(form);return {mode,colors:Number(d.get('colors'))||0,budget:Number(d.get('budgetKB'))*1000,tpf:Number(d.get('tpf')),still:false,width:Number(d.get('width'))||0,maxFrames:Number(d.get('maxFrames')),dither:d.get('dither'),filter:d.get('filter'),maxPixels:Number(d.get('maxPixels')),patterns:true,blocks:Number(d.get('blocks')),billboard:Number(d.get('billboard')),backing:d.has('backing'),syntax:d.get('syntax')};}
function mediaKey(s){return JSON.stringify([file.name,file.size,file.lastModified,s.tpf,s.still,s.width,s.maxFrames,s.filter,s.maxPixels]);}
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message;}
function status(title,detail){$('#status').textContent=title;$('#statusDetail').textContent=detail;}
function setMode(value){mode=value;for(const b of document.querySelectorAll('[data-mode]')){const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);}$('#modeHint').textContent=mode==='compact'?'Smaller item; slower initial loading in-game':'Bigger item, faster initial loading in-game';}
function progress(value,message){progressFloor=Math.max(progressFloor,Math.min(1,value));$('#progress').value=progressFloor;$('#progressValue').textContent=Math.round(progressFloor*100)+'%';$('#progressMessage').textContent=message;}
function exportsEnabled(enabled){syncRecipient(form,$('#recipientField'));$('#copy').hidden=settings().syntax==='datapack';$('#download').textContent='Download '+(settings().syntax==='snbt'?'.snbt':settings().syntax==='datapack'?'.zip':'.txt');$('#copy').disabled=$('#download').disabled=!enabled;}
function setBusy(value){busy=value;$('#convert').disabled=value||!file;$('#cancel').hidden=!value;$('#drop').disabled=value;$('#sample').disabled=value;$('#remove').disabled=value;for(const e of form.elements)if(!e.classList.contains('help'))e.disabled=value;for(const b of document.querySelectorAll('[data-mode]'))b.disabled=value;}
function resetOutput(){result=null;command='';processed=[];playing=false;frame=0;signature='';exportsEnabled(false);$('#timeline').disabled=$('#play').disabled=$('#viewPixels').disabled=true;$('#timeline').value=0;$('#play').textContent='▶';$('#play').setAttribute('aria-label','Play preview');$('#frameLabel').textContent='0 / 0';for(const id of ['resolution','frameCount','itemSize','elapsed'])$('#'+id).textContent='—';progressFloor=0;progress(0,'Idle');$('#details').textContent='No files are uploaded.';setView('source');}
function stopSourceInfo(){previewWorker?.terminate();previewWorker=null;}
function countSourceColours(chosen){
 stopSourceInfo();sourceInfo=null;$('#sourceInfo').textContent='Counting source colours…';$('#colourCount').textContent='…';
 const current=generation;try{previewWorker=new Worker(new URL('./source-info.js?v=20261020.8',import.meta.url),{type:'module'});
 previewWorker.onmessage=({data})=>{if(current!==generation)return;sourceInfo=data;$('#sourceInfo').textContent=data.error?'Source colour count unavailable.':`Source: ${data.width} × ${data.height} · ${data.frames} frame${data.frames===1?'':'s'} · ${data.colors.toLocaleString()} opaque colours${data.transparent?' + transparency':''}`;if(view==='source')updateColourCount();stopSourceInfo();};
 previewWorker.onerror=()=>{if(current!==generation)return;$('#sourceInfo').textContent='Source colour count unavailable.';stopSourceInfo();};previewWorker.postMessage({file:chosen});}catch{$('#sourceInfo').textContent='Source colour count unavailable.';stopSourceInfo();}
}
function updateColourCount(){$('#colourCount').textContent=view==='pixels'&&result?result.colors.toLocaleString():sourceInfo&&!sourceInfo.error?sourceInfo.colors.toLocaleString():'—';}
function terminate(){stopSourceInfo();worker?.terminate();worker=null;cachedMediaKey='';controller?.abort();controller=null;clearTimeout(adjustTimer);generation++;}
function selectFile(chosen){
 if(!chosen||busy)return;
 if(chosen.size>100*1024*1024){notice('Choose a file under 100 MB.');return;}
 terminate();resetOutput();notice('');file=chosen;$('#selectedFile').hidden=false;$('#fileName').textContent=chosen.name;$('#previewTitle').textContent=chosen.name;$('#empty').hidden=true;$('#stageLabel').textContent='ORIGINAL MEDIA';
 if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=URL.createObjectURL(chosen);source=null;$('#sourceImage').hidden=true;$('#sourceImage').removeAttribute('src');if(!isVideo(chosen))countSourceColours(chosen);else{$('#sourceInfo').textContent='';sourceInfo=null;updateColourCount();}
 const media=isVideo(chosen)?document.createElement('video'):$('#sourceImage');media.onload=media.onloadeddata=()=>{if(media.src!==sourceURL)return;source=media;setView(view);scheduleAnimation();};media.onerror=()=>notice('The source preview is unavailable. You can still try converting the file.');
 if(media.tagName==='VIDEO'){media.muted=true;media.preload='auto';media.playsInline=true;}
 media.src=sourceURL;setBusy(false);status('Ready.','Change settings or press Convert.');draw();
}
function setView(next){view=next;$('#sourceImage').hidden=!(view==='source'&&source?.tagName==='IMG');updateColourCount();for(const [id,v] of [['viewSource','source'],['viewPixels','pixels']]){const active=view===v;$('#'+id).classList.toggle('active',active);$('#'+id).setAttribute('aria-pressed',active);}$('#stageLabel').textContent=view==='pixels'?'CONVERTED PIXELS · FONT NOT SIMULATED':'SOURCE';draw();scheduleAnimation();}
function draw(){
 const c=$('#preview'),bounds=c.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=bounds.width,h=bounds.height;if(!w||!h)return;
 const pw=Math.round(w*dpr),ph=Math.round(h*dpr);if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
 const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const image=view==='pixels'&&processed.length?processed[frame]:source?.tagName==='IMG'?null:source;
 if(source?.tagName==='IMG'){const scale=Math.min((w-70)/source.naturalWidth,(h-82)/source.naturalHeight)*zoom;$('#sourceImage').style.imageRendering=form.elements.filter?.value==='nearest'?'pixelated':'auto';$('#sourceImage').style.width=source.naturalWidth*scale+'px';$('#sourceImage').style.height=source.naturalHeight*scale+'px';}
 if(image){const iw=image.videoWidth||image.naturalWidth||image.width,ih=image.videoHeight||image.naturalHeight||image.height;if(iw&&ih){const scale=Math.min((w-70)/iw,(h-82)/ih)*zoom;ctx.imageSmoothingEnabled=view!=='pixels';ctx.drawImage(image,(w-iw*scale)/2,(h-ih*scale)/2,iw*scale,ih*scale);}}
 if(processed.length){$('#frameLabel').textContent=`${frame+1} / ${processed.length}`;$('#timeline').value=frame;}
}
function needsAnimation(){return !document.hidden&&!busy&&view==='pixels'&&playing&&result&&processed.length>1;}
function scheduleAnimation(){if(!animationHandle&&needsAnimation())animationHandle=requestAnimationFrame(animate);}
function animate(now){animationHandle=0;if(!needsAnimation())return;if(playing&&result&&processed.length>1&&now-lastFrame>=result.tpf*50){const advance=Math.max(1,Math.floor((now-lastFrame)/(result.tpf*50)));frame=(frame+advance)%processed.length;lastFrame=now;draw();}scheduleAnimation();}
function isVideo(f){return f.type.startsWith('video/')||/\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(f.name);}
function event(target,name,signal,timeout=20000){return new Promise((resolve,reject)=>{
 const clean=()=>{target.removeEventListener(name,done);target.removeEventListener('error',fail);signal?.removeEventListener('abort',abort);clearTimeout(timer);};
 const done=()=>{clean();resolve();},fail=()=>{clean();reject(Error('Your browser cannot decode this video. Try MP4 (H.264) or WebM.'));},abort=()=>{clean();reject(new DOMException('Cancelled','AbortError'));};
 const timer=setTimeout(()=>{clean();reject(Error('Video decoding timed out. Try a shorter clip or another codec.'));},timeout);
 target.addEventListener(name,done,{once:true});target.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
async function captureVideo(f,s,signal){
 const video=document.createElement('video'),url=URL.createObjectURL(f);video.muted=true;video.preload='auto';video.playsInline=true;
 try{
  const loaded=event(video,'loadeddata',signal);video.src=url;await loaded;
  if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('Video duration cannot be read. Try an MP4 or WebM file.');
  const interval=s.tpf/20,total=s.still?1:Math.min(s.maxFrames,Math.ceil(video.duration/interval)),target=dimensions(video.videoWidth,video.videoHeight,total,s);
  if(target.width*target.height*total>32000000)throw Error('This conversion needs too much browser memory. Reduce Max pixels per frame or Frame cap.');
  const canvas=document.createElement('canvas');canvas.width=s.filter==='nearest'?video.videoWidth:target.width;canvas.height=s.filter==='nearest'?video.videoHeight:target.height;if(s.filter==='nearest'&&canvas.width*canvas.height>32000000)throw Error('Video frames are too large for Pixel art resizing.');const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=s.filter!=='nearest';ctx.imageSmoothingQuality='high';
  const frames=[];
  for(let i=0;i<total;i++){
   if(signal.aborted)throw new DOMException('Cancelled','AbortError');
   const time=Math.min(Math.max(0,video.duration-.001),i*interval);
   if(Math.abs(video.currentTime-time)>.0001){const seek=event(video,'seeked',signal);video.currentTime=time;await seek;}
   ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(video,0,0,canvas.width,canvas.height);const raw=ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels=s.filter==='nearest'?resizeNearest(raw,canvas.width,canvas.height,target.width,target.height).data:raw;frames.push({...target,data:pixels.buffer});
   progress(.03+.27*(i+1)/total,`Reading video frame ${i+1} / ${total}`);
  }
  return {frames,duration:video.duration*1000,clipped:!s.still&&video.duration>total*interval+.01};
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
function getWorker(){
 if(worker)return worker;
 const current=generation;worker=new Worker(new URL('./worker.js?v=20261020.8',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(current!==generation)return;
  if(data.type==='progress'){progress(data.value,data.message);return;}
  if(data.type==='error'){if(data.request!==undefined&&data.request!==adjustSeq)return;setBusy(false);progress(progressFloor,'Failed');exportsEnabled(false);status('Conversion failed.',data.message);notice(data.message);scheduleAnimation();return;}
  if(data.type==='adjusted'){
   if(data.request!==adjustSeq||signature!==JSON.stringify(settings()))return;
   command=data.command;result.bytes=data.bytes;$('#itemSize').textContent=(data.bytes/1000).toFixed(1)+' KB';exportsEnabled(true);status('Placement settings updated.','Your pixels are unchanged. The new item is ready to download.');return;
  }
  if(data.type==='done'){
   result={...data.result,elapsed:performance.now()-conversionStarted};cachedMediaKey=data.result.cacheKey||conversionKey;command=data.command;processed=data.previews.map(f=>{const c=document.createElement('canvas');c.width=f.width;c.height=f.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.data),f.width,f.height),0,0);return c;});
   frame=0;playing=processed.length>1;lastFrame=performance.now();$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause preview':'Play preview');$('#timeline').max=processed.length-1;$('#timeline').disabled=$('#play').disabled=processed.length<2;$('#viewPixels').disabled=false;
   $('#resolution').textContent=`${result.width} × ${result.height}`;$('#frameCount').textContent=result.frames;$('#itemSize').textContent=(result.bytes/1000).toFixed(1)+' KB';$('#elapsed').textContent=result.elapsed<1000?Math.round(result.elapsed)+' ms':(result.elapsed/1000).toFixed(1)+' s';
   $('#details').textContent=`${result.colors} colours · ${result.entries} palette entries · ${result.entities} text displays`;
   progress(1,'Complete');setBusy(false);exportsEnabled(true);setView('pixels');
   status('Conversion complete.',`${result.mode==='compact'?'Compact':'Fast'} item · ${result.frames} frame${result.frames===1?'':'s'} · Place the MID engine before the image item.`);
   const notes=[];if(result.clipped&&(isVideo(file)||result.sourceFrames>1))notes.push('The clip stops at the frame cap. Increase it to convert more.');if(result.bytes>900000)notes.push('Large items may not be handled well by the server and can get you kicked.');if(result.width*result.height>20000)notes.push('This exceeds the recommended 20,000 pixels per frame and can cause higher FPS lag.');notice(notes.join(' '));
  }
 };
 worker.onerror=()=>{if(current!==generation)return;setBusy(false);progress(progressFloor,'Failed');exportsEnabled(false);notice('The conversion worker could not run. Reload the site and try again.');status('Conversion interrupted.','Your media stayed on this device.');terminate();};
 return worker;
}
async function convert(){
 if(busy||!file||!form.reportValidity())return;
 controller?.abort();clearTimeout(adjustTimer);adjustSeq++;resetOutput();notice('');const s=settings();signature=JSON.stringify(s);conversionKey=mediaKey(s);conversionStarted=performance.now();setBusy(true);status('Converting.','Decoding, selecting colours and fitting max item size.');progress(.01,'Preparing conversion');
 if(matchMedia('(max-width:700px)').matches)$('#progressArea').scrollIntoView({block:'start',behavior:'auto'});
 const current=generation;controller=new AbortController();
 try{
  if(isVideo(file)&&(!worker||cachedMediaKey!==conversionKey)){
   const media=await captureVideo(file,s,controller.signal);if(current!==generation)return;getWorker().postMessage({type:'convert',name:file.name,settings:s,cacheKey:conversionKey,...media},media.frames.map(f=>f.data));
  }else getWorker().postMessage({type:'convert',file,name:file.name,settings:s,cacheKey:conversionKey});
 }catch(error){if(current!==generation)return;setBusy(false);progress(progressFloor,'Failed');notice(error.message);status('Could not read media.','Try an image, GIF or a supported video codec.');scheduleAnimation();}
}
function edited(){syncRecipient(form,$('#recipientField'));draw();
 try{localStorage.setItem('mid-native-settings-v2',JSON.stringify({...Object.fromEntries(new FormData(form)),mode}));}catch{}
 if(!result||busy)return;
 exportsEnabled(false);clearTimeout(adjustTimer);const request=++adjustSeq;
 const next=settings(),previous=JSON.parse(signature);
 if(Object.keys(next).some(k=>!placement.has(k)&&next[k]!==previous[k])){status('Your conversion settings changed.','Convert again to update the pixels and item.');return;}
 signature=JSON.stringify(next);status('Updating placement settings…','No pixel conversion needed.');adjustTimer=setTimeout(()=>getWorker().postMessage({type:'adjust',settings:next,request}),180);
}
$('#drop').onclick=()=>$('#file').click();$('#file').onchange=e=>{selectFile(e.target.files[0]);e.target.value='';};
for(const name of ['dragover','dragenter'])$('#drop').addEventListener(name,e=>{e.preventDefault();if(!busy)$('#drop').classList.add('over');});
$('#drop').ondragleave=()=>$('#drop').classList.remove('over');$('#drop').ondrop=e=>{e.preventDefault();$('#drop').classList.remove('over');if(!busy)selectFile(e.dataTransfer.files[0]);};
$('#remove').onclick=()=>{terminate();file=null;source=null;sourceInfo=null;$('#sourceImage').hidden=true;$('#sourceImage').removeAttribute('src');$('#sourceInfo').textContent='';if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';resetOutput();$('#selectedFile').hidden=true;$('#empty').hidden=false;$('#previewTitle').textContent='Preview';$('#convert').disabled=true;notice('');status('Select a file to convert.','Place the MID engine first, then place your converted image item.');draw();};
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{setMode(b.dataset.mode);edited();};form.oninput=edited;form.onsubmit=e=>e.preventDefault();$('#convert').onclick=convert;
$('#cancel').onclick=()=>{terminate();setBusy(false);progress(progressFloor,'Cancelled');exportsEnabled(false);notice('Conversion cancelled.');status('Conversion cancelled.','Change settings or press Convert to retry.');scheduleAnimation();};
$('#viewSource').onclick=()=>setView('source');$('#viewPixels').onclick=()=>setView('pixels');$('#play').onclick=()=>{playing=!playing;lastFrame=performance.now();$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause preview':'Play preview');scheduleAnimation();};$('#timeline').oninput=e=>{playing=false;frame=Number(e.target.value);$('#play').textContent='▶';$('#play').setAttribute('aria-label','Play preview');setView('pixels');};$('#zoom').onclick=()=>{zoom=zoom===1?2:1;$('#zoom').textContent=zoom===1?'Fit':'2×';draw();};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(command);$('#copy').textContent='Copied';setTimeout(()=>$('#copy').textContent='Copy command',1800);}catch{notice('Clipboard access is unavailable. Download the text file instead.');}};
$('#download').onclick=async()=>{if(!form.reportValidity()||!result)return;const s=settings(),recipient=form.elements.recipient.value;$('#download').disabled=true;try{const blob=s.syntax==='datapack'?new Blob([await createDatapack([command],recipient)],{type:'application/zip'}):new Blob([command+'\n'],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=exportFilename((file?.name.replace(/\.[^.]*$/,'')||'MID')+'-'+mode+'-MID-ITEM',s.syntax).replace(/\.mcfunction$/,'.zip');a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}catch(e){notice(e.message);}finally{exportsEnabled(Boolean(result));}};
$('#help').onclick=()=>$('#guide').showModal();$('#closeGuide').onclick=()=>$('#guide').close();$('#guide').onclick=e=>{if(e.target===$('#guide')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('#sample').onclick=async()=>{const c=document.createElement('canvas');c.width=160;c.height=120;const x=c.getContext('2d');x.fillStyle='#91bbc8';x.fillRect(0,0,160,120);x.fillStyle='#e5e6d1';x.fillRect(105,13,18,18);x.fillStyle='#d4e5de';for(const [a,b] of [[13,19],[55,31],[125,45]]){x.fillRect(a,b,25,4);x.fillRect(a+6,b-4,15,4);}x.fillStyle='#7d9a8c';x.beginPath();x.moveTo(0,87);x.lineTo(38,40);x.lineTo(71,82);x.lineTo(103,50);x.lineTo(160,94);x.closePath();x.fill();x.fillStyle='#b3c4ad';x.fillRect(34,43,9,5);x.fillRect(98,53,9,5);x.fillStyle='#457164';x.fillRect(0,85,160,35);x.fillStyle='#739461';x.fillRect(0,95,55,25);x.fillRect(100,96,60,24);x.fillStyle='#99b374';x.fillRect(0,95,55,5);x.fillRect(100,96,60,5);x.fillStyle='#416641';for(const [a,b] of [[20,65],[129,69]]){x.fillStyle='#5a4f34';x.fillRect(a+9,b+13,4,22);x.fillStyle='#3e633e';x.fillRect(a,b+7,22,15);x.fillRect(a+5,b,12,10);x.fillStyle='#63884d';x.fillRect(a+3,b+8,8,5);}x.fillStyle='#d3cc9d';x.fillRect(57,108,39,5);x.fillRect(63,103,28,5);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));selectFile(new File([blob],'overworld.png',{type:'image/png'}));};
try{const saved=JSON.parse(localStorage.getItem('mid-native-settings-v2')||'null');if(saved){for(const e of form.elements){if(!e.name)continue;if(e.type==='checkbox')e.checked=saved[e.name]==='on';else if(saved[e.name]!==undefined)e.value=saved[e.name];}setMode(saved.mode==='fast'?'fast':'compact');}}catch{}
syncRecipient(form,$('#recipientField'));new ResizeObserver(draw).observe($('#stage'));document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();scheduleAnimation();});window.addEventListener('beforeunload',()=>{terminate();if(sourceURL)URL.revokeObjectURL(sourceURL);});draw();
