// Apply before paint; share the preference between converter pages.
(()=>{
 const key='piggo-theme';let dark=true;
 try{dark=localStorage.getItem(key)!=='light';}catch{}
 function apply(value){dark=value;document.documentElement.dataset.theme=dark?'dark':'light';const button=document.querySelector('#themeToggle');if(button){button.textContent=dark?'Light mode':'Dark mode';button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label','Dark mode');}}
 apply(dark);
 document.addEventListener('DOMContentLoaded',()=>{apply(dark);document.querySelector('#themeToggle')?.addEventListener('click',()=>{apply(!dark);try{localStorage.setItem(key,dark?'dark':'light');}catch{}});});
 addEventListener('storage',event=>{if(event.key===key)apply(event.newValue!=='light');});
})();
