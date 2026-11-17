import {readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateBridge} from '../lib/bridge.js';
import {sitePattern} from '../bridge/core.js';
export const bridgeHash=site=>{const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;return createHash('sha256').update(JSON.stringify(stable(site))).digest('hex');};
export async function readBridges(root=process.cwd()) {
  const dir=path.join(root,'bridge/sites');let entries;
  try{if((await lstat(dir)).isSymbolicLink())throw new Error('Bridge symlinks are forbidden');entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const sites=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name==='_schema.json'){if(!entry.isFile())throw new Error('Invalid bridge schema file');continue;}
    const id=entry.name.slice(0,-5);
    if(!entry.isFile()||!entry.name.endsWith('.json')||!sitePattern.test(id)||id.length>43)throw new Error('Only bridge/sites/<siteId>.json files are permitted');
    const site=JSON.parse(await readFile(path.join(dir,entry.name),'utf8'));
    const errors=validateBridge(site,id);if(errors.length)throw new Error(`${id}: ${errors.join('; ')}`);
    sites.push(site);
  }
  return sites;
}
