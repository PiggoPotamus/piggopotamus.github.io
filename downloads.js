export async function copyText(text, title='Copy your item'){
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{}
 const previous=document.activeElement,dialog=document.createElement('dialog');
 dialog.className='copy-dialog';
 const heading=document.createElement('h2');heading.textContent=title;
 const help=document.createElement('p');help.textContent='Automatic copying is unavailable. The text below is selected: press Ctrl+C (Windows/Linux) or Command+C (Mac), then close this window.';
 const area=document.createElement('textarea');area.readOnly=true;area.value=text;area.spellcheck=false;area.setAttribute('aria-label','Item text to copy');
 const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();
 dialog.append(heading,help,area,close);document.body.append(dialog);
 dialog.addEventListener('close',()=>{area.value='';dialog.remove();previous?.focus();},{once:true});
 dialog.showModal();area.focus();area.select();area.setSelectionRange(0,area.value.length);
 return false;
}

const pendingURLs=new Set();
export function saveBlob(blob,filename){
 const url=URL.createObjectURL(blob),link=document.createElement('a');pendingURLs.add(url);
 link.href=url;link.download=filename;document.body.append(link);
 try{link.click();}finally{link.remove();setTimeout(()=>{URL.revokeObjectURL(url);pendingURLs.delete(url);},30000);}
}
if(typeof window!=='undefined')window.addEventListener('pagehide',()=>{for(const url of pendingURLs)URL.revokeObjectURL(url);pendingURLs.clear();});
