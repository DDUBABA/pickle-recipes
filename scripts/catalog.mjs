import {readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ID} from '../lib/validation.js';
export const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
export async function readItems(root=process.cwd()) {
  let entries;try{entries=await readdir(path.join(root,'recipes'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const items=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(entry.name==='index.json')continue;
    if(!entry.isDirectory()||!ID.test(entry.name))throw new Error('Unexpected recipes path');
    const dir=path.join(root,'recipes',entry.name);
    const meta=await readJson(path.join(dir,'meta.json'));
    if(meta.id!==entry.name)throw new Error(`Directory/id mismatch: ${entry.name}`);
    const files={};
    for(const name of await readdir(dir))if(!['meta.json','README.md','scripts'].includes(name))throw new Error(`Unexpected item file: ${entry.name}/${name}`);
    for(const name of ['meta.json','README.md','scripts'])if((await lstat(path.join(dir,name))).isSymbolicLink())throw new Error('Symlinks are forbidden');
    files['README.md']=await readFile(path.join(dir,'README.md'),'utf8');
    for(const script of await readdir(path.join(dir,'scripts'),{withFileTypes:true})) {
      if(!script.isFile()||! /^[a-z][a-z0-9_]*\.py$/.test(script.name))throw new Error(`Unexpected script path: ${entry.name}`);
      files[`scripts/${script.name}`]=await readFile(path.join(dir,'scripts',script.name),'utf8');
    }
    items.push({meta,files});
  }
  return items;
}
export function contentHash(meta,files) {
  const {version,releases,createdAt,updatedAt,status,...common}=meta;
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return createHash('sha256').update(JSON.stringify(stable({meta:common,files}))).digest('hex');
}
