const quote=s=>JSON.stringify(s);
// Split only at the current SNBT level; quoted commands keep all escapes.
function splitLevel(text,separator){let quote='',escaped=false,depth=0,start=0,out=[];for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;else if(c===separator&&depth===0){out.push(text.slice(start,i));start=i+1;}}if(quote||depth!==0)throw Error('Unbalanced item data');out.push(text.slice(start));return out;}
export function minifySNBT(text){let out='',quote='',escaped=false;for(const c of text){if(quote){if(c==='\n')out+='\\n';else if(c==='\r')out+='\\r';else if(c==='\t')out+='\\t';else out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';}else if(c==='"'||c==="'"){quote=c;out+=c;}else if(!/\s/.test(c))out+=c;}if(quote)throw Error('Unclosed item string');return out;}
export function formatItem(text,syntax='client'){
 const match=/^\s*(?:\.give|\/?give\s+\S+)\s+([^\s\[\]]+)\s*\[([\s\S]*)\]\s*(\d+)?\s*$/.exec(text);if(!match)throw Error('The converter did not produce a give item.');
 const id=match[1].includes(':')?match[1]:'minecraft:'+match[1],count=Number(match[3]||1),entries=splitLevel(match[2],',').filter(v=>v.trim()).map(entry=>{const pair=splitLevel(entry,'=');if(pair.length!==2)throw Error('Invalid item component');return [pair[0].trim(),minifySNBT(pair[1])];});
 if(syntax==='snbt'){const components=entries.map(([k,v])=>{if(k.startsWith('"'))k=JSON.parse(k);else if(k.startsWith("'"))k=k.slice(1,-1);return quote(k.includes(':')?k:'minecraft:'+k)+':'+v;});return '{components:{'+components.join(',')+'},id:'+quote(id)+',count:'+count+'}';}
 const command=(syntax==='client'?'.give ':syntax==='datapack'?'give @s ':'give @p ')+id+'['+entries.map(([k,v])=>k+'='+v).join(',')+'] '+count;return command;
}
export function exportExtension(syntax){return syntax==='snbt'?'.snbt':syntax==='datapack'?'.mcfunction':'.txt';}
export function exportFilename(stem,syntax){if(syntax==='datapack')stem=stem.normalize('NFKD').toLowerCase().replace(/[^a-z0-9_.-]+/g,'_').replace(/^[._-]+|[._-]+$/g,'')||'give_item';return stem+exportExtension(syntax);}

// Apply item presentation without touching commands stored in custom_data.
export function updateItemComponents(text,components,customData){
 const normalized=formatItem(text,'client'),match=/^\.give ([^\[]+)\[([\s\S]*)\] (\d+)$/.exec(normalized);
 const entries=splitLevel(match[2],',').map(entry=>{const pair=splitLevel(entry,'=');return [pair[0].replace(/^["']|["']$/g,''),pair[1]];});
 const values=new Map(entries.map(([k,v])=>[k.includes(':')?k:'minecraft:'+k,v]));
 if(customData){const before=values.get('minecraft:custom_data')||'{}';if(!before.startsWith('{')||!before.endsWith('}'))throw Error('Engine custom data must be a compound.');const additions=new Map(Object.entries(customData));const parts=splitLevel(before.slice(1,-1),',').filter(Boolean).filter(part=>!additions.has(splitLevel(part,':')[0].replace(/^["']|["']$/g,'')));for(const [k,v]of additions)parts.push(k+':'+v);values.set('minecraft:custom_data','{'+parts.join(',')+'}');}
 for(const [key,value]of Object.entries(components))values.set(key,value);
 return '.give '+match[1]+'['+[...values].map(([k,v])=>k+'='+v).join(',')+'] '+match[3];
}
