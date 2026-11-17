import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readItems} from './catalog.mjs';
import {validateMeta,validateFiles,validateDependencies,sensitiveFindings} from '../lib/validation.js';
export async function validate(root=process.cwd()) {
  const items=await readItems(root); const errors=[];
  for(const {meta,files} of items) for(const message of [...validateMeta(meta),...validateFiles(files),...validateDependencies(meta,items.map(item=>item.meta)),...sensitiveFindings(JSON.stringify(meta)).map(label=>`meta: ${label}`)])errors.push(`${meta.id}: ${message}`);
  for(const {meta} of items)if(meta.parentId && meta.parentId!==meta.id && !items.some(item=>item.meta.id===meta.parentId))errors.push(`${meta.id}: parentId not found`);
  if(errors.length)throw new Error(errors.join('\n'));
  return items;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await validate(path.resolve(process.argv[2]||'.'));console.log('Catalog schema, README, privacy and security validation passed.');}
