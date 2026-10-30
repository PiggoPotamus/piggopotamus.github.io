import {copyText,saveBlob} from './downloads.js?v=20261031.3';
import {formatItem,exportFilename} from './item-format.js?v=20261031.3';
import {createDatapack,syncRecipient} from './datapack.js?v=20261031.3';
let sourcePromise;
export function engineItem(source,syntax){return formatItem(source,syntax);}
export function engineVersion(source){const m=/custom_name=.*?\b(V\d+(?:\.\d+)+)\b/.exec(source);return m?m[1]:null;}
async function source(){if(!sourcePromise)sourcePromise=fetch(new URL('./assets/mid-engine.give.txt?v=20261031.3',import.meta.url)).then(r=>{if(!r.ok)throw Error('The engine download could not load. Please try again.');return r.text();}).catch(error=>{sourcePromise=null;throw error;});return sourcePromise;}
export function initEngine(doc=document){
 const form=doc.querySelector('#engineSettings');if(!form)return;
 const save=doc.querySelector('#engineDownload'),copy=doc.querySelector('#engineCopy'),status=doc.querySelector('#engineStatus'),recipient=doc.querySelector('#engineRecipientField');let busy=false;
 function update(){syncRecipient(form,recipient);const syntax=form.elements.syntax.value;copy.hidden=syntax==='datapack';copy.textContent=syntax==='snbt'?'Copy SNBT':'Copy command';save.textContent='Download '+(syntax==='datapack'?'.zip':syntax==='snbt'?'.snbt':'.txt');}
 function setBusy(value){busy=value;for(const control of form.elements)if(!control.classList.contains('help'))control.disabled=value;}
 async function output(clipboard){
  if(busy||!form.reportValidity())return;const {syntax,recipient}=Object.fromEntries(new FormData(form));setBusy(true);status.hidden=false;status.textContent='Preparing engine item…';
  try{
   const text=await source(),version=engineVersion(text),label=doc.querySelector('#engineVersion');if(version&&label)label.textContent=version;
   const command=engineItem(text,syntax);
   let copied=true;if(clipboard)copied=await copyText(command,'Copy the MID engine item');
   else{const blob=syntax==='datapack'?new Blob([await createDatapack([command],recipient)],{type:'application/zip'}):new Blob([command+'\n'],{type:'text/plain;charset=utf-8'});saveBlob(blob,exportFilename('MID-Engine',syntax).replace(/\.mcfunction$/,'.zip'));}
   status.textContent=clipboard?(copied?'Engine copied. Import it and place it before your image items.':'Use the copy window to copy the engine item.'):'Engine downloaded. Import the item and place it before your image items.';
  }catch(error){status.textContent=error.message||'Could not export the engine. Try downloading instead of copying.';}
  finally{setBusy(false);update();}
 }
 form.onsubmit=e=>e.preventDefault();form.oninput=update;save.onclick=()=>output(false);copy.onclick=()=>output(true);update();
}
if(typeof document!=='undefined')initEngine();
