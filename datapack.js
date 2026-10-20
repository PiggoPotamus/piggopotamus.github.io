const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const n of bytes)crc=crcTable[(crc^n)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// STORE keeps ZIP creation quick and works without downloads or browser compression APIs.
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
 // A stable identity prevents the same export being given again after reload or reinstallation.
 const hash=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([username,gives]))),id='gift_'+Array.from(new Uint8Array(hash).slice(0,12),n=>n.toString(16).padStart(2,'0')).join(''),state=id+':state',base='data/'+id+'/function/';
 return {
  'pack.mcmeta':JSON.stringify({pack:{description:'Converter items for '+username+' (once)',min_format:[94,1],max_format:[121,0]}},null,2)+'\n',
  'data/minecraft/tags/function/load.json':JSON.stringify({values:[id+':load']})+'\n',
  [base+'load.mcfunction']:`execute unless data storage ${state} delivered run schedule function ${id}:check 1t replace\n`,
  [base+'check.mcfunction']:`execute if data storage ${state} delivered run return 0\nexecute as @a[name=${username},limit=1] run function ${id}:give\nexecute unless data storage ${state} delivered run schedule function ${id}:check 1t replace\n`,
  [base+'give.mcfunction']:`execute unless entity @s[type=minecraft:player,name=${username}] run return 0\nexecute if data storage ${state} delivered run return 0\n${gives.join('\n')}\ndata modify storage ${state} delivered set value 1b\n`,
  'README.txt':`ITEM DELIVERY FOR ${username}\n\nPut this ZIP (do not unzip it) in your world's datapacks folder.\nRun /reload, or open the world.\nAll ${gives.length} item(s) go only to ${username}, once, when they join.\nIf already online, they receive the items immediately after loading the pack.\nDelivery is remembered across rejoins, world restarts and /reload.\nAfter delivery, the pack stops checking for players.\nAn identical export for the same username shares its delivery record.\nYou can remove the ZIP after receiving the items.\nMID image items still need the MID engine to display images.\nCompatible pack metadata: Java 1.21.11 through 26.3.\n`
 };
}
export async function createDatapack(commands,username){return zipFiles(await datapackFiles(commands,username));}
