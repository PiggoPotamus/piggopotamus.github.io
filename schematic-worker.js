import {formatItem,exportExtension} from './item-format.js?v=20261020.13';
// The Python converter runs in a dedicated browser worker.
const runtimeURL='https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let runtime;
async function load(){
 if(!runtime)runtime=(async()=>{
  postMessage({type:'progress',value:.02,message:'Loading conversion tools (first use can take a moment)…'});
  const {loadPyodide}=await import(runtimeURL+'pyodide.mjs');
  const py=await loadPyodide({indexURL:runtimeURL});
  const response=await fetch(new URL('./schem_to_commands.py?v=20261020.13',import.meta.url));if(!response.ok)throw Error('Could not load the schematic converter.');
  py.FS.writeFile('/home/pyodide/schem_to_commands.py',await response.text());
  const formats=await fetch(new URL('./schematic_formats.py?v=20261020.13',import.meta.url));if(!formats.ok)throw Error('Could not load schematic format support.');py.FS.writeFile('/home/pyodide/schematic_formats.py',await formats.text());
  const adapter=await fetch(new URL('./schematic_web.py?v=20261020.13',import.meta.url));if(!adapter.ok)throw Error('Could not load the file-size splitter.');py.FS.writeFile('/home/pyodide/schematic_web.py',await adapter.text());
  py.setStdout({batched:text=>postMessage({type:'log',text})});
  py.setStderr({batched:text=>{const match=/\[(\d)\/5\]/.exec(text);if(match)postMessage({type:'progress',value:.1+(+match[1]-1)*.17,message:text});postMessage({type:'log',text});}});
  return py;
 })().catch(error=>{runtime=null;throw error;});
 return runtime;
}
self.onmessage=async({data})=>{
 let inputPath;
 try{
  const py=await load();
  if(/\.schematic$/i.test(data.file.name)&&!py.FS.analyzePath('/home/pyodide/legacy-states.json').exists){const states=await fetch(new URL('./legacy-states.json?v=20261020.13',import.meta.url));if(!states.ok)throw Error('Could not load legacy block support.');py.FS.writeFile('/home/pyodide/legacy-states.json',await states.text());}
  for(const name of py.FS.readdir('/home/pyodide'))if(/^result.*\.txt$/.test(name))py.FS.unlink('/home/pyodide/'+name);
  inputPath=data.args[0];py.FS.writeFile(inputPath,new Uint8Array(await data.file.arrayBuffer()));
  py.globals.set('browser_args_json',JSON.stringify(data.args));py.globals.set('browser_max_bytes',data.maxBytes||600000);py.globals.set('browser_format',raw=>formatItem(String(raw),data.syntax||'client'));
  // Import once and reuse the tools between conversions.
  const code=await py.runPythonAsync(`import json, schematic_web\nschematic_web.convert(json.loads(browser_args_json), browser_max_bytes, browser_format)`);
  if(code!==0)throw Error('Conversion failed. See the processing log for details.');
  const files=py.FS.readdir('/home/pyodide').filter(name=>/^result.*\.txt$/.test(name)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true})).map(name=>({name:name.replace(/\.txt$/,exportExtension(data.syntax)),text:py.FS.readFile('/home/pyodide/'+name,{encoding:'utf8'})}));
  if(!files.length)throw Error('The converter did not create an output file.');
  postMessage({type:'done',files});
 }catch(error){postMessage({type:'error',message:error.message||String(error)});}
 finally{if(runtime){try{const py=await runtime;if(inputPath)py.FS.unlink(inputPath);for(const name of py.FS.readdir('/home/pyodide'))if(/^result.*\.txt$/.test(name))py.FS.unlink('/home/pyodide/'+name);}catch{}}}
};
