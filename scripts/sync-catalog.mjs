import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from './build.mjs';
import {cloudflareClient,d1Client} from './cloudflare.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const stringify=value=>JSON.stringify(value,null,2)+'\n';
export function catalogSnapshot({catalog,published,sites,hosts}) {
  const items=catalog.items.map(item=>({id:item.id,kind:item.kind,metadata:JSON.stringify(item),sha256:hash(JSON.stringify(item))}));
  const files=[];
  const add=(path,content,itemId=null,bundlePath=null)=>{
    if(Buffer.byteLength(content)>1_900_000)throw new Error(`D1 file exceeds row limit: ${path}`);
    files.push({path,content,itemId,bundlePath,contentType:path.endsWith('.json')?'application/json; charset=utf-8':'text/plain; charset=utf-8',sha256:hash(content)});
  };
  for(const {meta,files:bundle} of published)for(const [name,content] of Object.entries({'meta.json':stringify(meta),...bundle}))add(`recipes/${meta.id}/${name}`,content,meta.id,name);
  for(const site of sites)add(`bridge/sites/${site.siteId}.json`,stringify(site),site.siteId,`sites/${site.siteId}.json`);
  add('recipes/index.json',stringify(catalog));
  add('bridge/index.json',stringify({schemaVersion:1,items:catalog.items.filter(i=>i.kind==='bridge')}));
  for(const path of ['hosts.json','bridge/hosts.json'])add(path,stringify(hosts));
  add('bridge/policy.json',stringify({origins:[...new Set(sites.filter(s=>s.mode==='api_token').map(s=>new URL(s.api.url).origin))].sort()}));
  const revision=hash(JSON.stringify({items:items.map(i=>[i.id,i.sha256]).sort(),files:files.map(f=>[f.path,f.sha256]).sort()}));
  return {items,files,revision};
}

export function planSync(snapshot,current,{sourceSha='',now=new Date().toISOString()}={}) {
  if(current.revision===snapshot.revision)return [];
  const statements=[{sql:`INSERT INTO catalog_sync_guard(singleton,valid) VALUES(1,
    CASE WHEN COALESCE((SELECT revision FROM catalog_state WHERE singleton=1),'')=? THEN 1 ELSE 0 END)
    ON CONFLICT(singleton) DO UPDATE SET valid=excluded.valid`,params:[current.revision||'']}];
  const itemHashes=new Map(current.items.map(i=>[i.id,i.sha256]));
  const fileHashes=new Map(current.files.map(f=>[f.path,f.sha256]));
  const itemIds=new Set(snapshot.items.map(i=>i.id));
  const filePaths=new Set(snapshot.files.map(f=>f.path));
  for(const file of current.files)if(!filePaths.has(file.path))statements.push({sql:'DELETE FROM catalog_files WHERE path=?',params:[file.path]});
  for(const item of current.items)if(!itemIds.has(item.id))statements.push({sql:'DELETE FROM catalog_items WHERE id=?',params:[item.id]});
  for(const item of snapshot.items)if(itemHashes.get(item.id)!==item.sha256)statements.push({sql:`INSERT INTO catalog_items(id,kind,metadata_json,sha256) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,metadata_json=excluded.metadata_json,sha256=excluded.sha256`,params:[item.id,item.kind,item.metadata,item.sha256]});
  for(const file of snapshot.files)if(fileHashes.get(file.path)!==file.sha256)statements.push({sql:`INSERT INTO catalog_files(path,item_id,bundle_path,content,content_type,sha256) VALUES(?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET item_id=excluded.item_id,bundle_path=excluded.bundle_path,content=excluded.content,content_type=excluded.content_type,sha256=excluded.sha256`,params:[file.path,file.itemId,file.bundlePath,file.content,file.contentType,file.sha256]});
  statements.push({sql:`INSERT INTO catalog_state(singleton,revision,source_sha,synced_at) VALUES(1,?,?,?)
    ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,source_sha=excluded.source_sha,synced_at=excluded.synced_at`,params:[snapshot.revision,sourceSha,now]});
  return statements;
}

export async function syncCatalog(query,snapshot,options={}) {
  const started=performance.now();
  const [state,items,files]=await query([
    {sql:'SELECT revision FROM catalog_state WHERE singleton=1'},
    {sql:'SELECT id,sha256 FROM catalog_items'},
    {sql:'SELECT path,sha256 FROM catalog_files'}
  ]);
  const statements=planSync(snapshot,{revision:state.results[0]?.revision,items:items.results,files:files.results},options);
  // A single atomic batch is intentional. Never chunk a publication into visible partial versions.
  if(statements.length)await query(statements);
  return {revision:snapshot.revision,statements:statements.length,durationMs:Math.round(performance.now()-started)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const snapshot=catalogSnapshot(await build(process.cwd(),{indexOnly:true}));
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const query=d1Client(cloudflareClient(),process.env.CLOUDFLARE_D1_DATABASE_ID||config.d1_databases[0].database_id);
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  console.log(JSON.stringify(await syncCatalog(query,snapshot,{sourceSha})));
}
