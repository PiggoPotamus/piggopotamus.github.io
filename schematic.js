import {copyText,saveBlob} from './downloads.js?v=20261031.3';
import {createDatapack,syncRecipient} from './datapack.js?v=20261031.3';
import {exportFilename,exportExtension,formatItem} from './item-format.js?v=20261031.3';
import {argsFor} from './schematic-options.js?v=20261031.3';
const $=s=>document.querySelector(s),form=$('#schemSettings');
let file=null,worker=null,busy=false,files=[],floor=0,started=0,elapsedTimer=null;
function progress(value,message){floor=Math.max(floor,value);$('#schemProgress').value=floor;$('#schemPercent').textContent=Math.round(floor*100)+'%';$('#schemStatus').textContent=message;}
function setBusy(value){if(elapsedTimer)clearInterval(elapsedTimer);elapsedTimer=null;if(value){$('#schemElapsed').textContent='0.0 s';started=performance.now();elapsedTimer=setInterval(()=>$('#schemElapsed').textContent=((performance.now()-started)/1000).toFixed(1)+' s',100);}else if(busy)$('#schemElapsed').textContent=((performance.now()-started)/1000).toFixed(1)+' s';busy=value;$('#schemConvert').disabled=value||!file;$('#schemCancel').hidden=!value;$('#schemDrop').disabled=value;for(const control of form.elements)if(!control.classList.contains('help'))control.disabled=value;}
function error(message){$('#schemError').textContent=message;$('#schemError').hidden=!message;}
function notify(text){$('#schemNotice').textContent=text;$('#schemNotice').hidden=!text;}
let overLimit='';
function clear(){files=[];overLimit='';notify('');$('#schemFiles').replaceChildren();error('');}
function choose(chosen){if(busy||!chosen)return;if(!/\.(?:schem|litematic|schematic)$/i.test(chosen.name)||chosen.size>100*1024*1024){error('Choose a .schem, .litematic or .schematic file under 100 MB.');return;}file=chosen;clear();floor=0;$('#schemElapsed').textContent='0.0 s';progress(0,'Ready to convert.');$('#schemName').textContent=chosen.name;$('#schemLog').textContent='';setBusy(false);}
function download(output){saveBlob(new Blob([output.text],{type:'text/plain;charset=utf-8'}),exportFilename(file.name.replace(/\.(?:schem|litematic|schematic)$/i,'')+'_'+output.name.replace(/\.[^.]+$/,''),output.name.endsWith('.mcfunction')?'datapack':output.name.endsWith('.snbt')?'snbt':'client'));}
async function downloadPack(button){
 if(!form.reportValidity())return;
 const currentFiles=files,currentFile=file,recipient=form.elements.recipient.value;button.disabled=true;
 try{const zip=await createDatapack(currentFiles.map(f=>f.text),recipient);if(files!==currentFiles||file!==currentFile||form.elements.recipient.value!==recipient)return;saveBlob(new Blob([zip],{type:'application/zip'}),exportFilename(file.name.replace(/\.(?:schem|litematic|schematic)$/i,'')+'-schematic','datapack').replace(/\.mcfunction$/,'.zip'));}catch(e){error(e.message);}finally{button.disabled=false;}
}
function showFiles(){
 $('#schemFiles').replaceChildren();
 if(files.length>1){const note=document.createElement('p');note.className='schem-parts-note';note.textContent=`This schematic needs ${files.length} items. In game, place all ${files.length} items, in any order. Place the last one where you want the schematic.`;$('#schemFiles').append(note);}
 if(form.elements.syntax.value==='datapack'){
  const row=document.createElement('div');row.className='schem-output';const label=document.createElement('span');label.textContent=files.length+' item'+(files.length===1?'':'s')+' · For '+(form.elements.recipient.value||'your Minecraft username')+', once';const button=document.createElement('button');button.className='primary';button.textContent='Download datapack .zip';button.onclick=()=>downloadPack(button);row.append(label,button);$('#schemFiles').append(row);return;
 }
 for(const output of files){
  const row=document.createElement('div');row.className='schem-output';const label=document.createElement('span');label.textContent=output.name+' · '+(new TextEncoder().encode(output.text).length/1000).toFixed(1)+' KB';
  const copy=document.createElement('button');copy.className='primary';copy.textContent=output.name.endsWith('.snbt')?'Copy SNBT':'Copy command';copy.onclick=async()=>{try{if(await copyText(output.text))copy.textContent='Copied';}catch{error('Copying is unavailable. Download the file instead.');}};
  const save=document.createElement('button');save.textContent='Download '+output.name.slice(output.name.lastIndexOf('.'));save.onclick=()=>download(output);row.append(label,copy,save);$('#schemFiles').append(row);
 }
}
function getWorker(){if(worker)return worker;worker=new Worker(new URL('./schematic-worker.js?v=20261031.3',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.type==='progress')progress(data.value,data.message);else if(data.type==='log'){const log=$('#schemLog');log.textContent=(log.textContent+'\n'+data.text).slice(-60000);log.scrollTop=log.scrollHeight;}else if(data.type==='notice')notify(data.text);else if(data.type==='warn')overLimit=data.text;else if(data.type==='done'){notify(overLimit);files=data.files;progress(1,'Complete.');setBusy(false);showFiles();}else if(data.type==='error'){error(data.message);progress(floor,'Failed.');setBusy(false);}};worker.onerror=()=>{error('The conversion tools could not load. Check your connection and try again.');progress(floor,'Failed.');setBusy(false);worker?.terminate();worker=null;};return worker;}
$('#schemDrop').onclick=()=>$('#schemFile').click();$('#schemFile').onchange=e=>{choose(e.target.files[0]);e.target.value='';};$('#schemDrop').ondragover=e=>e.preventDefault();$('#schemDrop').ondrop=e=>{e.preventDefault();choose(e.dataTransfer.files[0]);};
function sizeWarning(){$('#schemSizeWarn').hidden=!(Number(form.elements.maxSizeKB.value)>8100);}
form.onsubmit=e=>e.preventDefault();form.oninput=e=>{
 sizeWarning();
 syncRecipient(form,$('#recipientField'));if(!files.length)return;
 if(e.target.name==='recipient'){showFiles();return;}
 if(e.target.name==='syntax'){
  try{
   const syntax=form.elements.syntax.value,next=files.map(output=>({name:output.name.replace(/\.[^.]+$/,exportExtension(syntax)),text:formatItem(output.text,syntax)+'\n'})),limit=Number(form.elements.maxSizeKB.value)*1000;
   if(!limit||next.every(output=>new TextEncoder().encode(output.text).length<=limit)){files=next;error('');showFiles();progress(1,'Output format updated.');return;}
   clear();progress(floor,'This format needs smaller parts. Press Convert again.');return;
  }catch(err){clear();error(err.message);return;}
 }
 clear();progress(floor,'Settings changed. Convert again.');
};
$('#schemConvert').onclick=()=>{if(busy||!file||!form.reportValidity())return;clear();floor=0;$('#schemLog').textContent='';progress(.01,'Preparing…');const settings=Object.fromEntries(new FormData(form));setBusy(true);try{getWorker().postMessage({file,args:argsFor(settings,file.name),syntax:settings.syntax,maxBytes:Number(settings.maxSizeKB||0)*1000});}catch(e){error(e.message);setBusy(false);}};
$('#schemCancel').onclick=()=>{worker?.terminate();worker=null;setBusy(false);progress(floor,'Cancelled.');};window.addEventListener('beforeunload',()=>worker?.terminate());

syncRecipient(form,$('#recipientField'));

$('#schemReset').onclick=()=>{if(busy)return;form.reset();sizeWarning();clear();floor=0;syncRecipient(form,$('#recipientField'));progress(0,file?'Default settings restored. Press Convert when ready.':'Default settings restored. Choose a schematic.');$('#schemElapsed').textContent='0.0 s';};
