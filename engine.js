import {formatItem,exportFilename} from './item-format.js?v=20261020.8';
import {createDatapack,syncRecipient} from './datapack.js?v=20261020.8';
// Keep the supplied engine commands intact; only change the enclosing item format.
let sourcePromise;
export function engineItem(source,syntax){return formatItem(source,syntax);}
async function source(){if(!sourcePromise)sourcePromise=fetch(new URL('./assets/mid-engine.give.txt?v=20261020.8',import.meta.url)).then(r=>{if(!r.ok)throw Error('The engine download could not load. Please try again.');return r.text();}).catch(error=>{sourcePromise=null;throw error;});return sourcePromise;}
export function initEngine(doc=document){
 const form=doc.querySelector('#engineSettings');if(!form)return;
 const save=doc.querySelector('#engineDownload'),copy=doc.querySelector('#engineCopy'),status=doc.querySelector('#engineStatus'),recipient=doc.querySelector('#engineRecipientField');let busy=false;
 function update(){syncRecipient(form,recipient);const syntax=form.elements.syntax.value;copy.hidden=syntax==='datapack';copy.textContent=syntax==='snbt'?'Copy engine SNBT':'Copy engine command';save.textContent='Download engine '+(syntax==='datapack'?'.zip':syntax==='snbt'?'.snbt':'.txt');}
 function setBusy(value){busy=value;for(const control of form.elements)if(!control.classList.contains('help'))control.disabled=value;}
 async function output(clipboard){
  if(busy||!form.reportValidity())return;const {syntax,recipient}=Object.fromEntries(new FormData(form));setBusy(true);status.textContent='Preparing engine download…';
  try{
   const command=engineItem(await source(),syntax);
   if(clipboard)await navigator.clipboard.writeText(command);
   else{const blob=syntax==='datapack'?new Blob([await createDatapack([command],recipient)],{type:'application/zip'}):new Blob([command+'\n'],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=doc.createElement('a');link.href=url;link.download=exportFilename('MID-Engine',syntax).replace(/\.mcfunction$/,'.zip');link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
   status.textContent=clipboard?'Engine copied. Import it and place it before your image items.':'Engine downloaded. Import the item and place it before your image items.';
  }catch(error){status.textContent=error.message||'Could not export the engine. Try downloading instead of copying.';}
  finally{setBusy(false);update();}
 }
 form.onsubmit=e=>e.preventDefault();form.oninput=update;save.onclick=()=>output(false);copy.onclick=()=>output(true);update();
}
if(typeof document!=='undefined')initEngine();
