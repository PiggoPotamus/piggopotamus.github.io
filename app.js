import {ITEM_LIMIT} from './numeric-codec.js?v=20261031.8';
import {copyText,saveBlob} from './downloads.js?v=20261031.8';
import {framePlan,frameCapActive} from './timing.js?v=20261031.8';
import {createDatapack,syncRecipient} from './datapack.js?v=20261031.8';
import {exportFilename} from './item-format.js?v=20261031.8';
import {targetPixelCount,resizeNearest,resizeBicubic} from './pixels.js?v=20261031.8';
import {dimensions,pixelLimit} from './codec.js?v=20261031.8';
const $=s=>document.querySelector(s),form=$('#settings');
let file=null,worker=null,busy=false,result=null,command='',processed=[],frame=0,playing=false,lastFrame=0,source=null,sourceURL='',view='source',zoom=1,generation=0,controller=null,signature='',adjustTimer=null,adjustSeq=0,conversionStarted=0,progressFloor=0,cachedMediaKey='',conversionKey='',animationHandle=0,elapsedTimer=null;
let previewWorker=null,sourceInfo=null;
const placement=new Set(['blocks','billboard','backing','syntax','itemName']);
function settings(){const d=new FormData(form);return {grayscale:d.has('grayscale'),itemName:(d.get('itemName')||'').trim(),quality:d.get('quality')||'medium',colors:Number(d.get('colors'))||0,exactColors:d.has('exactColors'),budget:d.get('budgetKB')?Number(d.get('budgetKB'))*1000:Infinity,tpf:Number(d.get('tpf')),still:false,width:Number(d.get('width'))||0,maxFrames:Number(d.get('maxFrames')),capMode:d.get('capMode')||'spread',dither:d.get('dither'),filter:d.get('filter'),maxPixels:Number(d.get('maxPixels')),patterns:true,blocks:Number(d.get('blocks')),billboard:Number(d.get('billboard')),backing:d.has('backing'),syntax:d.get('syntax')};}
function mediaKey(s){return JSON.stringify([file.name,file.size,file.lastModified,s.tpf,s.still,s.width,s.maxFrames,s.capMode,s.filter,s.maxPixels,s.quality,s.grayscale]);}
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message;}
function status(title,detail){$('#status').textContent=title;$('#statusDetail').textContent=detail;}
function progress(value,message){progressFloor=Math.max(progressFloor,Math.min(1,value));$('#progress').value=progressFloor;$('#progressValue').textContent=Math.round(progressFloor*100)+'%';$('#progressMessage').textContent=message;}
function exportsEnabled(enabled){syncRecipient(form,$('#recipientField'));$('#copy').hidden=settings().syntax==='datapack';$('#copy').textContent=settings().syntax==='snbt'?'Copy SNBT':'Copy command';$('#download').textContent='Download '+(settings().syntax==='snbt'?'.snbt':settings().syntax==='datapack'?'.zip':'.txt');$('#copy').disabled=$('#download').disabled=!enabled;}
function setBusy(value){const wasBusy=busy;busy=value;if(elapsedTimer)clearInterval(elapsedTimer);elapsedTimer=null;if(value){elapsedTimer=setInterval(()=>{$('#conversionElapsed').textContent=((performance.now()-conversionStarted)/1000).toFixed(1)+' s';},100);}else if(wasBusy&&conversionStarted)$('#conversionElapsed').textContent=((performance.now()-conversionStarted)/1000).toFixed(1)+' s';$('#convert').disabled=value||!file;$('#cancel').hidden=!value;$('#drop').disabled=value;$('#sample').disabled=value;$('#remove').disabled=value;for(const e of form.elements)if(!e.classList.contains('help'))e.disabled=value;}
function resetOutput(){if(animationHandle)cancelAnimationFrame(animationHandle);animationHandle=0;for(const canvas of processed)canvas.width=canvas.height=0;result=null;command='';processed=[];playing=false;frame=0;signature='';exportsEnabled(false);$('#timeline').disabled=$('#play').disabled=$('#viewPixels').disabled=true;$('#timeline').value=0;$('#play').textContent='▶';$('#play').setAttribute('aria-label','Play preview');$('#frameLabel').textContent='0 / 0';for(const id of ['resolution','frameCount','colourCount','itemSize','elapsed'])$('#'+id).textContent='—';progressFloor=0;$('#conversionElapsed').textContent='0.0 s';progress(0,'Idle');$('#details').textContent='No files are uploaded.';setView('source');}
function stopSourceInfo(){previewWorker?.terminate();previewWorker=null;}
function countSourceColours(chosen){
 stopSourceInfo();sourceInfo=null;$('#sourceInfo').textContent='Reading source details…';updateSourceDetails();$('#sourceColours').textContent='…';
 const current=generation;try{previewWorker=new Worker(new URL('./source-info.js?v=20261031.8',import.meta.url),{type:'module'});
 previewWorker.onmessage=({data})=>{if(current!==generation)return;sourceInfo=data;if(data.error)$('#sourceInfo').textContent='Source details unavailable.';updateSourceDetails();stopSourceInfo();};
 previewWorker.onerror=()=>{if(current!==generation)return;$('#sourceInfo').textContent='Source colour count unavailable.';stopSourceInfo();};previewWorker.postMessage({file:chosen});}catch{$('#sourceInfo').textContent='Source colour count unavailable.';stopSourceInfo();}
}
function durationText(ms){return (ms/1000).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+' s';}
function updateWidthWarning(){
 const s=settings(),big=$('#budgetWarning');big.hidden=!(s.budget>ITEM_LIMIT&&s.budget<Infinity);
 const info=sourceInfo&&!sourceInfo.error?sourceInfo:null,w=info?.width||source?.videoWidth||source?.naturalWidth,h=info?.height||source?.videoHeight||source?.naturalHeight,request=targetPixelCount(s.width,w,h),warning=$('#widthWarning'),limit=pixelLimit(s.maxPixels);
 warning.hidden=!request||request.pixels<=limit;
 warning.textContent=warning.hidden?'':`⚠ Target width implies ${request.width} × ${request.height} (${request.pixels.toLocaleString()} pixels per frame), exceeding your ${limit.toLocaleString()} pixel limit. The output will be made smaller. Lower Target width or increase Max pixels per frame.`;
}
function updateFrameCapWarning(){
 const s=settings(),info=sourceInfo&&!sourceInfo.error?sourceInfo:null;
 const active=frameCapActive(info?.duration,s.tpf,s.maxFrames,!!file&&(isVideo(file)||(info?.frames||0)>1));
 const help=$('#frameCapHelp');help.classList.toggle('help-warning',active);help.querySelector('.warning-badge').hidden=!active;help.setAttribute('aria-label',active?'Frame cap is dropping frames; read the warning':'About Frame cap');
}
function updateSourceDetails(){
 updateWidthWarning();updateFrameCapWarning();
 const info=sourceInfo&&!sourceInfo.error?sourceInfo:null,size=file?(file.size/1000).toFixed(1)+' KB':'—';
 $('#sourceSize').textContent=size;
 $('#sourceResolution').textContent=info?`${info.width} × ${info.height} (${(info.width*info.height).toLocaleString()} pixels)`:'—';
 $('#sourceFrames').textContent=info?.frames??'—';
 $('#sourceColours').textContent=Number.isFinite(info?.colors)?info.colors.toLocaleString():'—';
 $('#sourceDuration').textContent=info&&Number.isFinite(info.duration)?info.duration?durationText(info.duration):'Still image':'—';
 if(info){const parts=[`Source: ${info.width} × ${info.height}`,info.frames?`${info.frames} frame${info.frames===1?'':'s'}`:null,Number.isFinite(info.colors)?`${info.colors.toLocaleString()} opaque colours${info.transparent?' + transparency':''}`:null,Number.isFinite(info.duration)?info.duration?durationText(info.duration):'Still image':null,size];$('#sourceInfo').textContent=parts.filter(Boolean).join(' · ');}
}
function updateColourCount(){
 $('#colourCount').textContent=result?result.colors.toLocaleString():'—';
 updateSourceDetails();
}
function terminate(){stopSourceInfo();worker?.terminate();worker=null;cachedMediaKey='';controller?.abort();controller=null;clearTimeout(adjustTimer);generation++;}
function selectFile(chosen){
 if(!chosen||busy)return;
 
 terminate();releaseVideo();source=null;sourceInfo=null;resetOutput();notice('');file=chosen;updateSourceDetails();$('#selectedFile').hidden=false;$('#fileName').textContent=chosen.name;$('#previewTitle').textContent=chosen.name;$('#empty').hidden=true;$('#stageLabel').textContent='ORIGINAL MEDIA';
 if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=URL.createObjectURL(chosen);source=null;$('#sourceImage').hidden=true;$('#sourceImage').removeAttribute('src');if(!isVideo(chosen))countSourceColours(chosen);else{$('#sourceInfo').textContent='';sourceInfo=null;updateColourCount();}
 const media=isVideo(chosen)?$('#sourceVideo'):$('#sourceImage');media.onload=media.onloadeddata=()=>{if(media.src!==sourceURL)return;source=media;if(media.tagName==='VIDEO'){sourceInfo={width:media.videoWidth,height:media.videoHeight,duration:Number.isFinite(media.duration)?media.duration*1000:undefined};updateSourceDetails();}setView(view);scheduleAnimation();};media.onerror=()=>notice('The source preview is unavailable. You can still try converting the file.');
 if(media.tagName==='VIDEO'){media.muted=true;media.preload='auto';media.playsInline=true;}
 media.src=sourceURL;setBusy(false);status('Ready.','Change settings or press Convert.');draw();
}
function releaseVideo(){const video=$('#sourceVideo');video.pause();video.onload=video.onloadeddata=video.onerror=null;video.removeAttribute('src');video.load();video.hidden=true;}
function setView(next){view=next;$('#sourceVideo').hidden=!(view==='source'&&source?.tagName==='VIDEO');if(view!=='source')$('#sourceVideo').pause();$('#sourceImage').hidden=!(view==='source'&&source?.tagName==='IMG');updateColourCount();for(const [id,v] of [['viewSource','source'],['viewPixels','pixels']]){const active=view===v;$('#'+id).classList.toggle('active',active);$('#'+id).setAttribute('aria-pressed',active);}$('#stageLabel').textContent=view==='pixels'?'CONVERTED PIXELS':'SOURCE';draw();scheduleAnimation();}
function draw(){
 const c=$('#preview'),bounds=c.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=bounds.width,h=bounds.height;if(!w||!h)return;
 const pw=Math.round(w*dpr),ph=Math.round(h*dpr);if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
 const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const image=view==='pixels'&&processed.length?processed[frame]:null;
 if(source?.tagName==='IMG'||source?.tagName==='VIDEO'){const iw=source.videoWidth||source.naturalWidth,ih=source.videoHeight||source.naturalHeight,scale=Math.max(.01,Math.min((w-30)/iw,(h-50)/ih))*zoom;source.style.imageRendering=form.elements.filter?.value==='nearest'?'pixelated':'auto';source.style.width=iw*scale+'px';source.style.height=ih*scale+'px';}
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
  const plan=framePlan(video.duration*1000,s.tpf,s.maxFrames,s.still,s.capMode),total=plan.times.length,target=dimensions(video.videoWidth,video.videoHeight,total,s);
  if(target.width*target.height*total>32000000)notice('Large conversion: continuing. Your browser may use substantial memory.');
  const nativeResize=s.filter==='nearest'||(s.quality!=='low'&&s.quality!=='standard'),canvas=document.createElement('canvas');canvas.width=nativeResize?video.videoWidth:target.width;canvas.height=nativeResize?video.videoHeight:target.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=s.filter!=='nearest';ctx.imageSmoothingQuality='high';
  const frames=[];
  for(let i=0;i<total;i++){
   if(signal.aborted)throw new DOMException('Cancelled','AbortError');
   const time=Math.min(Math.max(0,video.duration-.001),plan.times[i]/1000);
   if(Math.abs(video.currentTime-time)>.0001){const seek=event(video,'seeked',signal);video.currentTime=time;await seek;}
   ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(video,0,0,canvas.width,canvas.height);const raw=ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels=nativeResize?(s.filter==='nearest'?resizeNearest:resizeBicubic)(raw,canvas.width,canvas.height,target.width,target.height).data:raw;frames.push({...target,data:pixels.buffer});
   progress(.03+.27*(i+1)/total,`Reading video frame ${i+1} / ${total}`);
  }
  return {frames,sourceFrames:Math.max(2,Math.ceil(video.duration*20)),duration:video.duration*1000,clipped:plan.reduced};
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
function getWorker(){
 if(worker)return worker;
 const current=generation;worker=new Worker(new URL('./worker.js?v=20261031.8',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(current!==generation)return;
  if(data.type==='warning'){notice(data.message);return;}
  if(data.type==='progress'){progress(data.value,data.message);return;}
  if(data.type==='error'){if(data.request!==undefined&&data.request!==adjustSeq)return;setBusy(false);progress(progressFloor,'Failed');exportsEnabled(false);status('Conversion failed.',data.message);notice(data.message);scheduleAnimation();return;}
  if(data.type==='adjusted'){
   if(data.request!==adjustSeq||signature!==JSON.stringify(settings()))return;
   command=data.command;result.bytes=data.bytes;result.commandBytes=data.commandBytes;$('#itemSize').textContent=(data.bytes/1000).toFixed(1)+' KB';exportsEnabled(true);status('Placement settings updated.','Your pixels are unchanged. Copy the updated item or download it.');return;
  }
  if(data.type==='done'){
   result={...data.result,elapsed:performance.now()-conversionStarted};cachedMediaKey=data.result.cacheKey||conversionKey;command=data.command;processed=data.previews.map(f=>{const c=document.createElement('canvas');c.width=f.width;c.height=f.height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.data),f.width,f.height),0,0);return c;});
   if(result.sourceFrames>1){sourceInfo={...(sourceInfo||{}),duration:result.sourceDuration,frames:result.sourceFrames};updateSourceDetails();}
   frame=0;playing=processed.length>1;lastFrame=performance.now();$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause preview':'Play preview');$('#timeline').max=processed.length-1;$('#timeline').disabled=$('#play').disabled=processed.length<2;$('#viewPixels').disabled=false;
   $('#resolution').textContent=`${result.width} × ${result.height} (${(result.width*result.height).toLocaleString()} pixels)`;$('#frameCount').textContent=result.frames;$('#itemSize').textContent=(result.bytes/1000).toFixed(1)+' KB';$('#elapsed').textContent=result.ticks?`${(result.ticks/20).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} s (${result.ticks} ticks)`:'Still image';
   $('#details').textContent=`${result.colors} colours · ${result.entries} palette entries · ${result.entities} text displays · Command text: ${(result.commandBytes/1000).toFixed(1)} KB`;
   progress(1,'Complete');setBusy(false);exportsEnabled(true);setView('pixels');
   status('Conversion complete.',`${result.frames} frame${result.frames===1?'':'s'} · Place the MID engine before the image item.`);
   const notes=[];if(result.clipped&&(isVideo(file)||result.sourceFrames>1))notes.push(settings().capMode==='cut'?'The clip was cut short at the frame cap. Raise Frame cap to keep more of it.':'Frames were dropped across the whole clip to meet the frame cap. Playback is shorter; raise Frame cap to retain more frames.');if(result.weightLimited)notes.push('Hit the server\'s item data limit (about 2 MB of NBT), so this image was made smaller or given fewer colours. Going over gets you kicked when you take the item.');if(result.overQuota)notes.push('Warning: this item is over the server\'s item data limit. Taking or holding it can get you kicked.');if(result.oversize)notes.push('Warning: this image is very large. Some frames are past the size Minecraft can safely send or save, so the display could kick players who go near it or stop its chunk from saving (a chunk ban). Lower the resolution to be safe.');if(result.exactColors&&result.colors<result.exactColors)notes.push(`Only ${result.colors} of the ${result.exactColors} colours could be used: at any size that fits Max item size, the image has no more distinct colours. Raise Max item size for more.`);if(result.bytes>ITEM_LIMIT)notes.push('Large items may not be handled well by the server and can get you kicked.');if(result.width*result.height>20000)notes.push('This exceeds the recommended 20,000 pixels per frame and can cause higher FPS lag.');notice(notes.join(' '));
  }
 };
 worker.onerror=()=>{if(current!==generation)return;setBusy(false);progress(progressFloor,'Failed');exportsEnabled(false);notice('The conversion worker could not run. Reload the site and try again.');status('Conversion interrupted.','Your media stayed on this device.');terminate();};
 return worker;
}
async function convert(){
 if(busy||!file||!form.reportValidity())return;$('#sourceVideo').pause();
 controller?.abort();clearTimeout(adjustTimer);adjustSeq++;resetOutput();notice('');const s=settings();signature=JSON.stringify(s);conversionKey=mediaKey(s);conversionStarted=performance.now();setBusy(true);status('Converting.','Decoding, selecting colours and fitting max item size.');progress(.01,'Preparing conversion');
 if(matchMedia('(max-width:700px)').matches)$('#progressArea').scrollIntoView({block:'start',behavior:'auto'});
 const current=generation;controller=new AbortController();
 try{
  if(isVideo(file)&&(!worker||cachedMediaKey!==conversionKey)){
   const media=await captureVideo(file,s,controller.signal);if(current!==generation)return;getWorker().postMessage({type:'convert',file,name:file.name,settings:s,cacheKey:conversionKey,...media},media.frames.map(f=>f.data));
  }else getWorker().postMessage({type:'convert',file,name:file.name,settings:s,cacheKey:conversionKey});
 }catch(error){if(current!==generation)return;setBusy(false);progress(progressFloor,'Failed');notice(error.message);status('Could not read media.','Try an image, GIF or a supported video codec.');scheduleAnimation();}
}
function edited(){syncRecipient(form,$('#recipientField'));draw();updateWidthWarning();updateFrameCapWarning();
 try{localStorage.setItem('mid-native-settings-v3',JSON.stringify(Object.fromEntries(new FormData(form))));}catch{}
 if(!result||busy)return;
 exportsEnabled(false);clearTimeout(adjustTimer);const request=++adjustSeq;
 const next=settings(),previous=JSON.parse(signature);if(!form.checkValidity()){status('Check your settings.','Enter valid values before exporting.');return;}if(JSON.stringify(next)===signature){exportsEnabled(true);return;}
 if(Object.keys(next).some(k=>!placement.has(k)&&next[k]!==previous[k])){status('Your conversion settings changed.','Convert again to update the pixels and item.');return;}
 signature=JSON.stringify(next);status('Updating placement settings…','No pixel conversion needed.');adjustTimer=setTimeout(()=>getWorker().postMessage({type:'adjust',settings:next,request}),180);
}
$('#drop').onclick=()=>$('#file').click();$('#file').onchange=e=>{selectFile(e.target.files[0]);e.target.value='';};
for(const name of ['dragover','dragenter'])$('#drop').addEventListener(name,e=>{e.preventDefault();if(!busy)$('#drop').classList.add('over');});
$('#drop').ondragleave=()=>$('#drop').classList.remove('over');$('#drop').ondrop=e=>{e.preventDefault();$('#drop').classList.remove('over');if(!busy)selectFile(e.dataTransfer.files[0]);};
$('#remove').onclick=()=>{terminate();releaseVideo();file=null;source=null;sourceInfo=null;$('#sourceImage').hidden=true;$('#sourceImage').removeAttribute('src');$('#sourceInfo').textContent='';if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';resetOutput();$('#selectedFile').hidden=true;$('#empty').hidden=false;$('#previewTitle').textContent='Preview';$('#convert').disabled=true;notice('');status('Select a file to convert.','Place the MID engine first, then place your converted image item.');draw();};
form.oninput=edited;form.onsubmit=e=>e.preventDefault();$('#convert').onclick=convert;
$('#cancel').onclick=()=>{terminate();setBusy(false);progress(progressFloor,'Cancelled');exportsEnabled(false);notice('Conversion cancelled.');status('Conversion cancelled.','Change settings or press Convert to retry.');scheduleAnimation();};
$('#viewSource').onclick=()=>setView('source');$('#viewPixels').onclick=()=>setView('pixels');$('#play').onclick=()=>{playing=!playing;lastFrame=performance.now();$('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause preview':'Play preview');scheduleAnimation();};$('#timeline').oninput=e=>{playing=false;frame=Number(e.target.value);$('#play').textContent='▶';$('#play').setAttribute('aria-label','Play preview');setView('pixels');};$('#zoom').onclick=()=>{zoom=zoom===1?2:1;$('#zoom').textContent=zoom===1?'Fit':'2×';draw();};
$('#copy').onclick=async()=>{
 if(!command||!result||!form.reportValidity())return;
 const current=command;try{const copied=await copyText(current);if(current!==command)return;if(copied){$('#copy').textContent='Copied';setTimeout(()=>{if(current===command)exportsEnabled(signature===JSON.stringify(settings()));},1800);}else notice('Use the copy window to copy your item.');}catch{notice('Copying is unavailable. Download the file instead.');}
};
$('#download').onclick=async()=>{
 if(!command||!form.reportValidity()||!result||signature!==JSON.stringify(settings()))return;
 const s=settings(),recipient=form.elements.recipient.value,current=command,currentResult=result,currentFile=file,stem=(file?.name.replace(/\.[^.]*$/,'')||'MID')+'-MID-ITEM';$('#download').disabled=true;
 try{const blob=s.syntax==='datapack'?new Blob([await createDatapack([current],recipient)],{type:'application/zip'}):new Blob([current+'\n'],{type:'text/plain;charset=utf-8'});if(result!==currentResult||file!==currentFile||command!==current||signature!==JSON.stringify(settings()))return;saveBlob(blob,exportFilename(stem,s.syntax).replace(/\.mcfunction$/,'.zip'));}catch(e){notice(e.message);}finally{exportsEnabled(Boolean(result)&&signature===JSON.stringify(settings()));}
};
$('#resetSettings').onclick=()=>{if(busy)return;form.reset();try{localStorage.removeItem('mid-native-settings-v3');}catch{}edited();if(!result)status('Default settings restored.',file?'Press Convert when ready.':'Choose a file to begin.');};

$('#sample').onclick=async()=>{const r=await fetch('./assets/sample.gif?v=20261031.8');if(!r.ok){notice('The sample image could not be loaded.');return;}selectFile(new File([await r.blob()],'sample.gif',{type:'image/gif'}));};
try{const saved=JSON.parse(localStorage.getItem('mid-native-settings-v3')||'null');if(saved){for(const e of form.elements){if(!e.name)continue;if(e.type==='checkbox')e.checked=saved[e.name]==='on';else if(saved[e.name]!==undefined)e.value=saved[e.name];}}}catch{}
syncRecipient(form,$('#recipientField'));updateFrameCapWarning();new ResizeObserver(draw).observe($('#stage'));document.addEventListener('visibilitychange',()=>{if(document.hidden)$('#sourceVideo').pause();lastFrame=performance.now();scheduleAnimation();});window.addEventListener('beforeunload',()=>{terminate();releaseVideo();if(sourceURL)URL.revokeObjectURL(sourceURL);});draw();
