export function initTooltips(doc=document,win=window){
 const tooltip=doc.querySelector('#tooltip');if(!tooltip)return;
 let active=null,timer=null;
 const cancel=()=>{win.clearTimeout(timer);timer=null;};
 function hide(){cancel();tooltip.hidden=true;if(active){active.setAttribute('aria-expanded','false');active.removeAttribute('aria-describedby');}active=null;}
 function deferHide(){cancel();timer=win.setTimeout(()=>{if(active!==doc.activeElement&&!tooltip.contains(doc.activeElement)&&!tooltip.matches(':hover')&&!active?.matches(':hover'))hide();},250);}
 function show(button){hide();active=button;const template=button.dataset.helpTemplate&&doc.getElementById(button.dataset.helpTemplate);if(template)tooltip.replaceChildren(template.content.cloneNode(true));else tooltip.textContent=button.dataset.help;tooltip.style.left='0px';tooltip.style.top='0px';tooltip.hidden=false;button.setAttribute('aria-expanded','true');button.setAttribute('aria-describedby','tooltip');const r=button.getBoundingClientRect(),box=tooltip.getBoundingClientRect();tooltip.style.left=Math.max(10,Math.min(r.left,win.innerWidth-box.width-10))+'px';tooltip.style.top=(r.bottom+8+box.height<win.innerHeight?r.bottom+8:Math.max(10,r.top-box.height-8))+'px';}
 for(const button of doc.querySelectorAll('.help')){
  const label=button.closest('label,.setting-label'),control=label?.querySelector('input,select'),name=(button.dataset.helpLabel||label?.textContent||'Setting').replace(/\?\s*$/,'').trim();
  button.setAttribute('aria-label','Help: '+name);button.setAttribute('aria-expanded','false');if(control)control.setAttribute('aria-description',button.dataset.help);
  button.onmouseenter=()=>show(button);button.onmouseleave=deferHide;button.onfocus=()=>show(button);button.onblur=deferHide;
  button.onclick=e=>{e.preventDefault();e.stopPropagation();show(button);};
 }
 tooltip.onmouseenter=cancel;tooltip.onmouseleave=deferHide;tooltip.onfocusin=cancel;tooltip.onfocusout=deferHide;
 doc.addEventListener('keydown',e=>{if(e.key==='Escape')hide();if(e.key==='Tab'&&!e.shiftKey&&doc.activeElement===active){const link=tooltip.querySelector?.('a');if(link){e.preventDefault();link.focus();}}});doc.addEventListener('pointerdown',e=>{if(!e.target.closest('.help,#tooltip'))hide();});win.addEventListener('scroll',e=>{if(!tooltip.contains(e.target))hide();},true);win.addEventListener('resize',hide);
 return {hide};
}
if(typeof document!=='undefined')initTooltips();
