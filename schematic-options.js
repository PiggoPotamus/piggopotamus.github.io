export function argsFor(s,name){
 const args=['/home/pyodide/'+name.replace(/[\/\\\0]/g,'_'),'/home/pyodide/result.txt','--origin',String(s.x||0),String(s.y||0),String(s.z||0)];
 for(const [key,flag] of [['absolute','--absolute'],['includeAir','--include-air'],['keepStates','--keep-all-states']])if(s[key])args.push(flag);
 for(const [key,flag] of [['name','--name'],['author','--author'],['description','--description'],['volume','--max-fill-volume'],['boundsBlock','--bounds-block'],['thickness','--bounds-thickness']])if(s[key]!==undefined&&s[key]!=='')args.push(flag,String(s[key]));
 if(!s.credit)args.push('--no-credit');return args;
}
