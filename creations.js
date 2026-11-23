import {copyText,saveBlob} from './downloads.js?v=20261031.9';
import {formatItem,exportFilename} from './item-format.js?v=20261031.9';
import {createDatapack} from './datapack.js?v=20261031.9';
const sources=new Map();
function source(id){if(!sources.has(id))sources.set(id,fetch(new URL(`./assets/creations/${id}.give.txt?v=20261031.9`,import.meta.url)).then(r=>{if(!r.ok)throw Error('The item could not load. Please try again.');return r.text();}).catch(error=>{sources.delete(id);throw error;}));return sources.get(id);}
for(const card of document.querySelectorAll('.creation')){
 card.append(document.querySelector('#creation-export').content.cloneNode(true));
 const form=card.querySelector('form'),copy=card.querySelector('.copy'),save=card.querySelector('.download'),status=card.querySelector('.status'),recipient=card.querySelector('.recipient'),name=card.dataset.name;
 let busy=false;
 function update(){const syntax=form.elements.syntax.value;recipient.hidden=syntax!=='datapack';form.elements.recipient.required=syntax==='datapack';copy.hidden=syntax==='datapack';copy.textContent=syntax==='snbt'?'Copy SNBT':'Copy command';save.textContent='Download '+(syntax==='datapack'?'.zip':syntax==='snbt'?'.snbt':'.txt');}
 async function output(clipboard){
  if(busy||!form.reportValidity())return;const {syntax,recipient:who}=Object.fromEntries(new FormData(form));busy=true;copy.disabled=save.disabled=true;status.hidden=false;status.textContent='Getting the item…';
  try{
   const command=formatItem(await source(card.dataset.item),syntax);
   if(clipboard)status.textContent=await copyText(command,'Copy '+name)?'Copied.':'Use the copy window to copy it.';
   else{const blob=syntax==='datapack'?new Blob([await createDatapack([command],who)],{type:'application/zip'}):new Blob([command+'\n'],{type:'text/plain;charset=utf-8'});saveBlob(blob,exportFilename(name,syntax).replace(/\.mcfunction$/,'.zip'));status.textContent='Downloaded.';}
  }catch(error){status.textContent=error.message||'Something went wrong. Try downloading instead.';}
  finally{busy=false;copy.disabled=save.disabled=false;}
 }
 form.onsubmit=e=>e.preventDefault();form.elements.syntax.onchange=update;copy.onclick=()=>output(true);save.onclick=()=>output(false);update();
}
