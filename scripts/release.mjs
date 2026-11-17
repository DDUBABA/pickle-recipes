import {readFile,writeFile} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readJson,readItems,contentHash} from './catalog.mjs';
import {releaseItem} from '../lib/releases.js';
import {build} from './build.mjs';
import {readBridges,bridgeHash} from './bridges.mjs';
import {assertBridgePr} from '../lib/bridge-pr.js';
import {validateBridge} from '../lib/bridge.js';
const repo=process.env.GITHUB_REPOSITORY, token=process.env.GITHUB_TOKEN;
if(!repo||!token)throw new Error('GitHub workflow context required');
const get=async route=>{const response=await fetch(`https://api.github.com/repos/${repo}${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});if(!response.ok)throw new Error(`GitHub API ${response.status}`);return response.json();};
const ledger=await readJson('.github/release-state.json');const merged=[];
ledger.bridges??={};
for(let page=1;;page++){
  const prs=await get(`/pulls?state=closed&base=main&per_page=100&page=${page}`);
  merged.push(...prs.filter(pr=>pr.merged_at&&!ledger.processedPrs.includes(pr.number)));
  if(prs.length<100)break;
}
merged.sort((a,b)=>a.merged_at.localeCompare(b.merged_at)||a.number-b.number);
for(const pr of merged){
  const match=pr.body?.match(/<!-- pickle-submission\s*([\s\S]*?)\s*-->/);
  // Non-item infrastructure PRs need no release metadata.
  const files=[];for(let page=1;;page++){const part=await get(`/pulls/${pr.number}/files?per_page=100&page=${page}`);files.push(...part);if(part.length<100)break;}
  const bridgeChanges=files.filter(file=>/^bridge\/sites\/(?!_schema\.json$)[^/]+\.json$/.test(file.filename));
  if(bridgeChanges.length){
    let metadata;
    if(match){
      const envelope=JSON.parse(match[1]);metadata=envelope.metadata;
      if(!process.env.SUBMISSION_METADATA_SECRET)throw new Error('Bridge signing key missing');
      const expected=createHmac('sha256',process.env.SUBMISSION_METADATA_SECRET).update(JSON.stringify(metadata)).digest();
      const supplied=Buffer.from(envelope.signature||'','hex');
      if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied)||metadata.headSha!==pr.head.sha)throw new Error('Invalid bridge HMAC or head');
      assertBridgePr(metadata,files,ledger.bridges[metadata.itemId]);
    }else{
      // Maintainer integration changes are code-reviewed infrastructure, never API submissions.
      if(pr.head.ref.startsWith('submissions/')||pr.head.repo?.full_name!==repo)throw new Error('Bridge changes require signed submissions');
      if(pr.author_association!=='OWNER')throw new Error('Unsigned bridge integration requires the repository owner');
    }
    for(const file of bridgeChanges){
      const id=file.filename.slice('bridge/sites/'.length,-5);
      if(file.status==='removed'){delete ledger.bridges[id];continue;}
      const site=JSON.parse(execFileSync('git',['show',`${pr.merge_commit_sha}:${file.filename}`],{encoding:'utf8'}));
      if(validateBridge(site,id).length)throw new Error('Invalid merged bridge');
      const current=ledger.bridges[id];
      const info=metadata||{type:current?'patch':'new',baseVersion:current?.version||null,submittedBy:pr.user.login,summary:pr.title};
      const release=releaseItem(current,info,pr.number,pr.merged_at);
      ledger.bridges[id]={...release,hash:bridgeHash(site),createdAt:current?.createdAt||pr.merged_at,updatedAt:pr.merged_at};
    }
    ledger.processedPrs.push(pr.number);continue;
  }
  if(pr.head.ref.startsWith('submissions/')&&!files.some(f=>/^recipes\/[^/]+\//.test(f.filename)))throw new Error('Submission cannot modify infrastructure');
  const changed=files.filter(file=>/^recipes\/[^/]+\//.test(file.filename));
  if(!changed.length){ledger.processedPrs.push(pr.number);continue;}
  if(!match)throw new Error(`PR #${pr.number}: item changes require signed submission metadata`);
  const {metadata,signature}=JSON.parse(match[1]);
  if(!process.env.SUBMISSION_METADATA_SECRET)throw new Error('SUBMISSION_METADATA_SECRET is required for item releases');
  const expected=createHmac('sha256',process.env.SUBMISSION_METADATA_SECRET).update(JSON.stringify(metadata)).digest();
  const supplied=Buffer.from(signature||'','hex');
  if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied)||metadata.headSha!==pr.head.sha)throw new Error(`PR #${pr.number}: invalid metadata signature or modified head`);
  if(files.some(file=>!new RegExp(`^recipes/${metadata.itemId}/(?:meta\\.json|README\\.md|scripts/[a-z][a-z0-9_]*\\.py)$`).test(file.filename)))throw new Error(`PR #${pr.number}: files outside submitted item`);
  if(metadata.type==='adapt'||metadata.type==='remix'){
    const source=JSON.parse(execFileSync('git',['show',`${pr.merge_commit_sha}:recipes/${metadata.itemId}/meta.json`],{encoding:'utf8'}));
    if(ledger.items[source.parentId]?.version!==metadata.baseVersion)throw new Error(`PR #${pr.number}: parent version conflict`);
  }
  const release=releaseItem(ledger.items[metadata.itemId],metadata,pr.number,pr.merged_at);
  const metaPath=`recipes/${metadata.itemId}/meta.json`;
  const mergedMeta=JSON.parse(execFileSync('git',['show',`${pr.merge_commit_sha}:${metaPath}`],{encoding:'utf8'}));
  const mergedFiles={};
  const paths=execFileSync('git',['ls-tree','-r','--name-only',pr.merge_commit_sha,`recipes/${metadata.itemId}`],{encoding:'utf8'}).trim().split('\n');
  for(const file of paths)if(file.endsWith('/README.md')||/\/scripts\/[a-z][a-z0-9_]*\.py$/.test(file))mergedFiles[file.slice(`recipes/${metadata.itemId}/`.length)]=execFileSync('git',['show',`${pr.merge_commit_sha}:${file}`],{encoding:'utf8'});
  ledger.items[metadata.itemId]={...release,hash:contentHash(mergedMeta,mergedFiles),createdAt:ledger.items[metadata.itemId]?.createdAt||pr.merged_at,updatedAt:pr.merged_at};
  ledger.processedPrs.push(pr.number);
}
// Apply authoritative history only to the exact reviewed common-code bundle.
for(const {meta,files} of await readItems()){
  const record=ledger.items[meta.id];if(!record)continue;
  if(record.hash!==contentHash(meta,files))throw new Error(`Unreleased or conflicting common-code changes: ${meta.id}`);
  await writeFile(`recipes/${meta.id}/meta.json`,JSON.stringify({...meta,version:record.version,releases:record.releases,createdAt:record.createdAt,updatedAt:record.updatedAt},null,2)+'\n');
}
await writeFile('.github/release-state.json',JSON.stringify(ledger,null,2)+'\n');
for(const site of await readBridges())if(ledger.bridges[site.siteId]?.hash!==bridgeHash(site))throw new Error(`Unreleased bridge changes: ${site.siteId}`);
await build(process.cwd(),{indexOnly:true});
console.log(`Release state reconciled (${merged.length} merged PRs considered).`);
