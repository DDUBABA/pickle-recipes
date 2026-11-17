import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {D1,meta,files,request,call,payload,credentials} from './helpers.mjs';
import {catalog,bundles,loadCatalog,loadItem} from '../lib/catalog.js';
import {storedFile} from '../lib/catalog-store.js';
import {bridgeItem} from '../lib/bridge.js';
import {terms} from '../lib/consent.js';
import {catalogSnapshot,planSync,syncCatalog} from '../scripts/sync-catalog.mjs';
import {cloudflareClient,d1Client} from '../scripts/cloudflare.mjs';
import {requiresSiteDeployment} from '../scripts/deployment-scope.mjs';
import {configurePages} from '../scripts/configure-pages.mjs';
import {onRequest as publicRoute} from '../functions/_middleware.js';
import {onRequestGet as search} from '../functions/api/search.js';
import {onRequestGet as detail} from '../functions/api/items/[id].js';
import {onRequestPost as download} from '../functions/api/download.js';
import {onRequestPost as grant} from '../functions/api/consent.js';
import {onRequestPost as submit} from '../functions/api/submit.js';
import {routeBridge} from '../workers/bridge-router/index.js';

const bridge=JSON.parse(await readFile(new URL('../bridge/sites/knocktown-appapi.json',import.meta.url),'utf8'));
function snapshot({items=[meta],bundle=files,sites=[bridge]}={}){
  const all=[...items,...sites.map(site=>bridgeItem(site,{version:'1.0'}))];
  return catalogSnapshot({catalog:{...catalog,items:all},published:items.map(meta=>({meta,files:bundle})),sites,
    hosts:Object.fromEntries(sites.flatMap(site=>[[`loginbridge--${site.siteId}.pickle-recipes.com`,site.siteId],[`pickle-loginbridge--${site.siteId}.pages.dev`,site.siteId]]))});
}
function queryAdapter(DB){
  return async batch=>{
    DB.db.exec('BEGIN');
    try{
      const results=batch.map(({sql,params=[]})=>({success:true,results:DB.db.prepare(sql).all(...params)}));
      DB.db.exec('COMMIT');return results;
    }catch(error){DB.db.exec('ROLLBACK');throw error;}
  };
}
const publicRequest=(DB,path,options={})=>publicRoute({env:{DB},request:request(path,options),next:async()=>new Response('static fallback',{status:404,headers:{'X-Fallback':'yes'}})});

test('Empty or unmigrated D1 uses static fallback; real D1 failures fail closed',async()=>{
  const DB=new D1();
  for(const binding of [undefined,DB,{prepare(){throw new Error('D1_ERROR: no such table: catalog_state: SQLITE_ERROR');}}]){
    assert.equal(await loadCatalog(binding),catalog);
    const item=catalog.items[0];assert.equal((await loadItem(binding,item.id)).item,item);
    const result=await publicRequest(binding,'/recipes/index.json');assert.equal(result.status,404);assert.equal(result.headers.get('X-Fallback'),'yes');
    assert.equal(result.headers.get('Cache-Control'),'no-store');
  }
  const failed={prepare(){throw new Error('D1 quota exhausted');}};
  await assert.rejects(loadCatalog(failed),/quota/);
  assert.equal((await publicRequest(failed,'/recipes/index.json')).status,503);
});

test('New D1 items override baked data in search, details, download and submission conflict checks',async()=>{
  const DB=new D1(),env={DB};const live={...meta,version:'2.1',name:'D1 최신 항목'};
  const liveFiles={...files,'README.md':files['README.md']+'\n최신 README', 'scripts/service.py':"print('new')\n"};
  await syncCatalog(queryAdapter(DB),snapshot({items:[live],bundle:liveFiles}));
  const listing=await call(search,request('/api/search?q=D1'),env);assert.equal(listing.status,200);assert.equal((await listing.json()).items[0].version,'2.1');
  const info=await call(detail,request('/api/items/'+live.id),env,{id:live.id});assert.equal((await info.json()).item.readme,liveFiles['README.md']);
  const consent=await (await call(grant,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'catalog-test'})),env)).json();
  const result=await call(download,request('/api/download',payload({itemId:live.id,...consent,clientType:'web'},credentials(consent))),env);
  assert.equal(result.status,200);const body=await result.json();assert.equal(body.version,'2.1');assert.equal(body.files['scripts/service.py'],liveFiles['scripts/service.py']);
  assert.equal(JSON.parse(body.files['meta.json']).version,'2.1');assert.equal(DB.db.prepare('SELECT version FROM download_logs').get().version,'2.1');
  const {version,releases,createdAt,updatedAt,...submissionMeta}=meta;
  const duplicate=await call(submit,request('/api/submit',payload({...consent,type:'new',baseVersion:null,submittedBy:'tester',summary:'new',meta:submissionMeta,files},credentials(consent))),env);
  assert.equal(duplicate.status,409);
  // Artifact files remain behind the consent-gated download API.
  assert.equal((await publicRequest(DB,`/recipes/${live.id}/scripts/service.py`)).status,404);
});

test('Deletion, empty publication and blocking never resurrect a static item or its files',async()=>{
  const DB=new D1();const original=catalog.items[0];
  await syncCatalog(queryAdapter(DB),snapshot({items:[],sites:[]}));
  assert.equal((await loadCatalog(DB)).items.length,0);
  await assert.rejects(loadItem(DB,original.id),error=>error.status===404);
  await syncCatalog(queryAdapter(DB),snapshot({items:[{...meta,status:'blocked'}],sites:[]}));
  await assert.rejects(loadItem(DB,meta.id),error=>error.status===403);
  await syncCatalog(queryAdapter(DB),snapshot({items:[],sites:[]}));
  assert.equal(DB.db.prepare('SELECT count(*) n FROM catalog_items').get().n,0);
  assert.equal(DB.db.prepare('SELECT count(*) n FROM catalog_files WHERE item_id IS NOT NULL').get().n,0);
});

test('Sync writes deltas, removes obsolete files, handles unicode and quotes, and is idempotent',async()=>{
  const DB=new D1(),query=queryAdapter(DB);const initial=snapshot();
  assert.ok((await syncCatalog(query,initial)).statements>0);
  assert.equal((await syncCatalog(query,initial)).statements,0);
  const changed=snapshot({bundle:{'README.md':"한글 ' ; DELETE FROM catalog_items; --",'scripts/new_file.py':'print(2)'}});
  const calls=[];await syncCatalog(async statements=>{calls.push(statements);return query(statements);},changed);
  assert.equal(calls.length,2);assert.equal(calls[1].filter(s=>s.sql.startsWith('INSERT INTO catalog_files')).length,2);
  assert.equal(calls[1].some(s=>s.sql.startsWith('INSERT INTO catalog_items')),false);
  assert.equal(DB.db.prepare("SELECT content FROM catalog_files WHERE path=?").get(`recipes/${meta.id}/README.md`).content,"한글 ' ; DELETE FROM catalog_items; --");
  assert.equal(DB.db.prepare('SELECT path FROM catalog_files WHERE path=?').get(`recipes/${meta.id}/scripts/service.py`),undefined);
});

test('Failed batches and competing revisions roll back the whole catalog',async()=>{
  const DB=new D1(),query=queryAdapter(DB),initial=snapshot();await syncCatalog(query,initial);
  const state={revision:initial.revision,items:DB.db.prepare('SELECT id,sha256 FROM catalog_items').all(),files:DB.db.prepare('SELECT path,sha256 FROM catalog_files').all()};
  const changed=snapshot({items:[],sites:[]});const batch=planSync(changed,state);
  await assert.rejects(query([...batch,{sql:'INSERT INTO catalog_sync_guard(singleton,valid) VALUES(2,0)'}]));
  assert.equal((await loadItem(DB,meta.id)).item.version,meta.version);
  assert.equal(DB.db.prepare('SELECT revision FROM catalog_state').get().revision,initial.revision);
  await syncCatalog(query,snapshot({items:[{...meta,version:'3.0'}]}));
  await assert.rejects(query(batch),/CHECK/);
  assert.equal((await loadItem(DB,meta.id)).item.version,'3.0');
});

test('Public JSON, HEAD, new bridge host and runtime CSP use the current publication without a build',async()=>{
  const DB=new D1();const site={...bridge,siteId:'new-live-service',bridgeUrl:'https://loginbridge--new-live-service.pickle-recipes.com/?download=1',api:{...bridge.api,url:'https://new-api.example.com/login'}};
  await syncCatalog(queryAdapter(DB),snapshot({sites:[site]}));
  for(const path of ['/recipes/index.json','/bridge/index.json','/hosts.json','/bridge/hosts.json','/bridge/sites/new-live-service.json']){
    const response=await publicRequest(DB,path);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(await response.text(),/new-live-service/);
    const head=await publicRequest(DB,path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
  assert.equal((await publicRequest(DB,'/bridge/sites/removed-service.json')).status,404);
  assert.equal((await publicRequest(DB,'/hosts.json',{method:'POST'})).status,405);
  const next=async()=>new Response('<html><meta http-equiv="Content-Security-Policy" content="connect-src https://old.example.com"><body>engine</body></html>',{headers:{'Content-Type':'text/html','Content-Security-Policy':'old-policy',ETag:'old'}});
  const html=await publicRoute({env:{DB},request:request('/bridge/'),next});
  assert.match(html.headers.get('Content-Security-Policy'),/https:\/\/new-api.example.com/);assert.equal(html.headers.get('ETag'),null);assert.doesNotMatch(await html.text(),/old.example.com|http-equiv/);
  const routed=await routeBridge(new Request(site.bridgeUrl),async(url,options)=>publicRoute({env:{DB},request:new Request(url,options),next}));
  assert.equal(routed.status,200);assert.match(routed.headers.get('Content-Security-Policy'),/new-api.example.com/);
  const config=await call(detail,request('/api/items/'+site.siteId),{DB},{id:site.siteId});assert.equal((await config.json()).item.config.api.url,site.api.url);
  await syncCatalog(queryAdapter(DB),snapshot({sites:[]}));
  assert.equal((await routeBridge(new Request(site.bridgeUrl),async url=>publicRequest(DB,new URL(url).pathname))).status,404);
});

test('D1 sessions start on primary so new requests see the latest publication',async()=>{
  let constraint;const DB=new D1();await syncCatalog(queryAdapter(DB),snapshot());
  const binding={withSession(value){constraint=value;return DB;}};
  assert.equal((await storedFile(binding,'hosts.json')).ready,true);assert.equal(constraint,'first-primary');
});

test('REST client checks HTTP, envelope and per-statement errors without exposing credentials',async()=>{
  const api=cloudflareClient({token:'secret-test',account:'account',fetcher:async(url,options)=>{
    assert.match(url,/\/accounts\/account\/d1\/database\/db\/query$/);assert.equal(options.headers.Authorization,'Bearer secret-test');
    assert.deepEqual(JSON.parse(options.body),{batch:[{sql:'SELECT 1'}]});return Response.json({success:true,result:[{success:false}]});
  }});
  await assert.rejects(d1Client(api,'db')([{sql:'SELECT 1'}]),/D1 batch failed/);
  const denied=cloudflareClient({token:'secret-test',account:'account',fetcher:async()=>Response.json({success:false,errors:[{code:10000,message:'sensitive upstream'}]},{status:403})});
  await assert.rejects(denied('/test'),error=>error.message==='Cloudflare 403: 10000');
});

test('Only deployed code changes require Pages; data, ledgers and docs alone never do',()=>{
  for(const file of ['recipes/test-service/README.md','recipes/index.json','bridge/sites/test-service.json','bridge/index.json','bridge/hosts.json','hosts.json','.github/release-state.json','sitemap.xml','robots.txt','docs/operations.md','README.md'])assert.equal(requiresSiteDeployment([file]),false,file);
  for(const file of ['functions/api/search.js','lib/catalog.js','public/new.css','bridge/core.js','bridge/index.html','bridge/sites/_schema.json','scripts/build.mjs','wrangler.jsonc','terms.json','app.js','.github/workflows/build-index.yml'])assert.equal(requiresSiteDeployment([file]),true,file);
  assert.equal(requiresSiteDeployment(['recipes/a/meta.json','lib/catalog.js']),true);
  assert.equal(requiresSiteDeployment(Array.from({length:3001},(_,i)=>`recipes/item-${i}/README.md`)),false);
});

test('Pages configuration disables both Git deployment paths and preserves repository settings',async()=>{
  let project={source:{type:'github',config:{owner:'DDUBABA',repo_name:'pickle-recipes',production_branch:'production',production_deployments_enabled:true,preview_deployment_setting:'all'}}};
  const api=async(route,options)=>{assert.equal(route,'/pages/projects/pickle-recipes');if(options){assert.equal(options.method,'PATCH');project={...project,...options.body};}return project;};
  assert.deepEqual(await configurePages(api),{project:'pickle-recipes',productionAutomatic:false,previewAutomatic:false});
  assert.equal(project.source.config.production_branch,'production');assert.equal(project.source.config.repo_name,'pickle-recipes');
});
