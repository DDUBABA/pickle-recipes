import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ID,VERSION} from '../lib/validation.js';
import {assertBridgePr} from '../lib/bridge-pr.js';
import {readBridges} from './bridges.mjs';
const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const pr=event.pull_request;
if(!pr)throw new Error('Pull request context required');
const root=path.resolve(process.argv[2]||'proposed');
const base=JSON.parse(await readFile(new URL('../.github/release-state.json',import.meta.url),'utf8'));
const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/pulls/${pr.number}/files?per_page=100`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'}});
if(!response.ok)throw new Error('Cannot read changed files');
const files=await response.json();
if(pr.changed_files>100||files.length>=100)throw new Error('PR is too large for automatic validation; split it.');
const envelopeBlock=pr.body?.match(/<!-- pickle-submission\s*([\s\S]*?)\s*-->/);
const envelope=envelopeBlock?JSON.parse(envelopeBlock[1]):null;
if(pr.head.ref.startsWith('submissions/')&&!envelope)throw new Error('Submission branches require an API-generated envelope');
if(envelope?.metadata?.artifactType==='bridge'){
  if(!/^[a-f0-9]{64}$/.test(envelope.signature||'')||envelope.metadata.headSha!==pr.head.sha)throw new Error('Invalid bridge signature/head');
  assertBridgePr(envelope.metadata,files,base.bridges?.[envelope.metadata.itemId]);
  await readBridges(root);
}else if(pr.head.ref.startsWith('submissions/')&&!files.some(f=>/^recipes\/[^/]+\//.test(f.filename)))throw new Error('Submission branch cannot modify infrastructure');
if(files.some(file=>/^recipes\/[^/]+\//.test(file.filename))){
  const block=pr.body?.match(/<!-- pickle-submission\s*([\s\S]*?)\s*-->/);
  if(!block)throw new Error('Item PR needs API-generated submission metadata');
  const {metadata,signature}=JSON.parse(block[1]);
  if(!metadata||!ID.test(metadata.itemId||'')||metadata.itemId.length>64||!/^([a-f0-9]{64})$/.test(signature||'')||metadata.headSha!==pr.head.sha)throw new Error('Invalid submission envelope/head');
  if(files.some(file=>!new RegExp(`^recipes/${metadata.itemId}/(?:meta\\.json|README\\.md|scripts/[a-z][a-z0-9_]*\\.py)$`).test(file.filename)))throw new Error('Submission PR changes unrelated files');
  const meta=JSON.parse(await readFile(path.join(root,'recipes',metadata.itemId,'meta.json'),'utf8'));
  if(metadata.type==='patch'){
    if(base.items[metadata.itemId]?.version!==metadata.baseVersion)throw new Error('Stale baseVersion. Refresh the item and submit a new PR.');
  }else{
    if(base.items[metadata.itemId])throw new Error('Duplicate item ID');
    if(metadata.type==='new' ? metadata.baseVersion!==null : !VERSION.test(metadata.baseVersion||'')||base.items[meta.parentId]?.version!==metadata.baseVersion)throw new Error('Invalid source version');
  }
}
console.log('PR scope and baseVersion checks passed; release workflow verifies the HMAC.');
