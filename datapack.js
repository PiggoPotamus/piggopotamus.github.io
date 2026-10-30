import {digest256} from './hash.js?v=20261031.2';
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const n of bytes)crc=crcTable[(crc^n)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function zipFiles(entries){
 const locals=[],directory=[];let offset=0,centralSize=0;
 for(const [path,text] of Object.entries(entries)){
  const name=encoder.encode(path),data=encoder.encode(text),crc=crc32(data),local=new Uint8Array(30+name.length+data.length),v=new DataView(local.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);local.set(data,30+name.length);locals.push(local);
  const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=local.length;centralSize+=central.length;
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,locals.length,true);v.setUint16(10,locals.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
 const zip=new Uint8Array(offset+centralSize+end.length);let pos=0;for(const part of [...locals,...directory,end]){zip.set(part,pos);pos+=part.length;}return zip;
}
export function syncRecipient(form,label){const enabled=new FormData(form).get('syntax')==='datapack';label.hidden=!enabled;const input=form.elements.recipient;if(input)input.required=enabled;}
export async function datapackFiles(commands,username){
 username=username.trim();if(!/^[A-Za-z0-9_]{1,16}$/.test(username))throw Error('Enter a Minecraft Java username (1–16 letters, numbers or underscores).');
 const gives=commands.map(s=>s.trim());if(!gives.length||gives.some(s=>!s.startsWith('give @s ')||/[\r\n]/.test(s)))throw Error('The datapack needs complete player-targeted give commands.');
 const hash=await digest256(encoder.encode(JSON.stringify([username,gives]))),id='gift_'+Array.from(new Uint8Array(hash).slice(0,12),n=>n.toString(16).padStart(2,'0')).join(''),state=id+':state',base='data/'+id+'/function/';
 const files={
  'pack.mcmeta':JSON.stringify({pack:{description:'Converter items for '+username+' (once)',min_format:[94,1],max_format:[121,0]}},null,2)+'\n',
  'data/minecraft/tags/function/load.json':JSON.stringify({values:[id+':load']})+'\n',
  [base+'load.mcfunction']:`execute unless data storage ${state} delivered unless data storage ${state} failed run schedule function ${id}:check 1t replace\n`,
  [base+'check.mcfunction']:`execute if data storage ${state} delivered run return 0\nexecute if data storage ${state} failed run return 0\nexecute as @a[name=${username},limit=1] run function ${id}:give\nexecute unless data storage ${state} delivered unless data storage ${state} failed if entity @a[name=${username},limit=1] run schedule function ${id}:check 1t replace\nexecute unless data storage ${state} delivered unless data storage ${state} failed unless entity @a[name=${username},limit=1] run schedule function ${id}:check 20t replace\n`,
  [base+'give.mcfunction']:`execute unless entity @s[type=minecraft:player,name=${username}] run return 0\nexecute if data storage ${state} delivered run return 0\nexecute if data storage ${state} failed run return 0\n`+gives.map((_,i)=>`execute unless data storage ${state} items.i${i} run return run function ${id}:item_${i}\n`).join('')+`data modify storage ${state} delivered set value 1b\n`,
  'README.txt':`YOUR CONVERTER ITEMS\n\nRecipient: ${username}\nNumber of items: ${gives.length}\nMinecraft Java Edition 1.21.11–26.3\n\n1. Put this ZIP, without unzipping it, in your world's datapacks folder.\n2. Open the world or run /reload.\n3. Join as ${username}. Delivery usually takes less than one second.\n   If already online, delivery starts as soon as the pack loads.\n\nSplit items arrive one at a time to avoid sending a large batch at once.\nOnly ${username} receives the items. Successful delivery is remembered across\nrejoins, world restarts and /reload. Exporting the same items for the same\nusername uses the same delivery record. You can remove this ZIP afterwards.\n\nIf delivery fails, the pack stops instead of retrying every tick. Check your\nserver's item-size limits and permissions first. To retry undelivered items:\n/data remove storage ${state} failed\n/reload\nItems already delivered are remembered and will not be duplicated.\n\nFor MID images/GIFs, place the MID engine before placing the media items.\n`
 };
 for(let i=0;i<gives.length;i++)files[base+`item_${i}.mcfunction`]=`execute store success storage ${state} ok byte 1 run ${gives[i]}\nexecute if data storage ${state} {ok:1b} run data modify storage ${state} items.i${i} set value 1b\nexecute unless data storage ${state} {ok:1b} run data modify storage ${state} failed set value 1b\n`;
 return files;
}
export async function createDatapack(commands,username){return zipFiles(await datapackFiles(commands,username));}
