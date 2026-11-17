import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,createHmac} from 'node:crypto';
import {validateBridge,bridgeSubmission,bridgeItem} from '../lib/bridge.js';
import {publicApiUrl,selectSite} from '../bridge/core.js';
import {assertBridgePr} from '../lib/bridge-pr.js';
import {readBridges,bridgeHash} from '../scripts/bridges.mjs';
import {build} from '../scripts/build.mjs';
import {openBridgeSubmission} from '../lib/github.js';
import {routeBridge} from '../workers/bridge-router/index.js';
import {catalog,bundles,searchItems} from '../lib/catalog.js';
import {terms} from '../lib/consent.js';
import {onRequestPost as submit} from '../functions/api/submit.js';
import {onRequestPost as consentPost} from '../functions/api/consent.js';
import {onRequestGet as detail} from '../functions/api/items/[id].js';
import {D1,call,request,payload,credentials} from './helpers.mjs';
const sites=await readBridges();const site=sites.find(s=>s.siteId==='smartthings-pat');
const input={type:'bridge',changeType:'new',siteId:site.siteId,baseVersion:null,submittedBy:'tester',summary:'공통 연결 설정',files:{[`sites/${site.siteId}.json`]:JSON.stringify(site)}};
test('All imported sites pass strict schema and privacy validation',()=>{assert.ok(sites.length>=3);for(const s of sites)assert.deepEqual(validateBridge(s),[]);});
for(const url of ['http://api.example.com/','https://localhost/','https://127.0.0.1/','https://10.1.1.1/','https://169.254.169.254/','https://[::1]/','https://[::ffff:127.0.0.1]/','https://2130706433/','https://0x7f000001/','https://0177.0.0.1/','https://api.local/','https://user:pass@api.example.com/','https://api.example.com/?token=x','https://api.example.com/#x','https://api.example.com:444/','https://api.example.com./','javascript:alert(1)','data:text/html,x'])test(`Reject unsafe API URL ${url}`,()=>assert.throws(()=>publicApiUrl(url)));
test('Only one declarative JSON file is accepted, with no code/PII/secrets',()=>{
  assert.deepEqual(bridgeSubmission(input).errors,[]);
  for(const change of [{files:{...input.files,'app.js':'alert(1)'}},{files:{'../sites/test.json':'{}'}},{files:{[`sites/${site.siteId}.json`]:'<script>alert(1)</script>'}},{html:'x'},{siteId:'../x'},{siteId:'A_bad'},{siteId:'a'.repeat(44)+'-x'}])assert.ok(bridgeSubmission({...input,...change}).errors.length);
  for(const config of [{...site,html:'x'},{...site,description:'<img src=x onerror=alert(1)>'},{...site,description:'user@example.com'},{...site,output:{token:'hardcoded-secret-value'}},{...site,output:{token:{$field:'unknown'}}},{...site,fields:[{...site.fields[0],value:'secret'}]},{...site,bridgeUrl:'https://evil.example.com/'}])assert.ok(validateBridge(config).length);
});
test('Dedicated hosts override query site and nested hosts fail closed',()=>{
  assert.equal(selectSite('smartthings-pat.login.pickle-recipes.com','?site=knocktown-appapi').siteId,'smartthings-pat');
  assert.equal(selectSite('pickle-loginbridge--smartthings-pat.pages.dev','?site=knocktown-appapi').siteId,'smartthings-pat');
  assert.equal(selectSite('pickle-recipes.pages.dev','?site=smartthings-pat').preview,true);
  assert.throws(()=>selectSite('evil.smartthings-pat.login.pickle-recipes.com','?site=smartthings-pat'));
  assert.throws(()=>selectSite('pickle-recipes.pages.dev','?site=../../secret'));
});
test('Bridge PR scope rejects code, extra JSON, renames, deletions and stale versions',()=>{
  const metadata={artifactType:'bridge',itemId:site.siteId,type:'new',baseVersion:null};const files=[{filename:`bridge/sites/${site.siteId}.json`,status:'added'}];
  assert.doesNotThrow(()=>assertBridgePr(metadata,files));
  for(const changes of [[...files,{filename:'bridge/app.js',status:'modified'}],[{filename:'bridge/sites/_schema.json',status:'modified'}],[{...files[0],status:'renamed',previous_filename:'bridge/app.js'}],[{...files[0],status:'removed'}],[{filename:'README.md',status:'modified'}]])assert.throws(()=>assertBridgePr(metadata,changes));
  assert.throws(()=>assertBridgePr(metadata,files,{version:'1.0'}));
  assert.throws(()=>assertBridgePr({...metadata,type:'patch',baseVersion:'1.0'},[{...files[0],status:'modified'}],{version:'1.1'}));
});
test('Bridge router only fetches published assets without forwarding secrets or query',async()=>{
  const calls=[];const fake=async(url,options)=>{calls.push({url,options});return new Response(url.endsWith('index.json')?JSON.stringify({items:[bridgeItem(site)]}):'public asset',{headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'",'Set-Cookie':'unwanted=1'}});};
  const r=await routeBridge(new Request('https://smartthings-pat.login.pickle-recipes.com/?site=other-site&token=not-forwarded',{headers:{Cookie:'private=x',Authorization:'Bearer private'}}),fake);
  assert.equal(r.status,200);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(calls.length,2);assert.ok(calls.every(c=>!c.url.includes('?')&&!JSON.stringify(c.options).includes('private')));
  for(const url of ['https://evil.example.com/','https://smartthings-pat.login.pickle-recipes.com/api/submit','https://smartthings-pat.login.pickle-recipes.com/sites/knocktown-appapi.json','https://unknown-site.login.pickle-recipes.com/'])assert.equal((await routeBridge(new Request(url),fake)).status,404);
  assert.equal((await routeBridge(new Request('https://smartthings-pat.login.pickle-recipes.com/',{method:'POST',body:'secret'}),fake)).status,405);
});
test('Search and item APIs support bridge while preserving kind compatibility',async()=>{
  const fixture={...site,siteId:'search-test-bridge',bridgeUrl:'https://pickle-loginbridge--search-test-bridge.pages.dev/'};
  const item=bridgeItem(fixture);catalog.items.push(item);bundles[item.id]={[`sites/${item.id}.json`]:JSON.stringify(fixture)};
  try{
    assert.equal(searchItems([item],new URLSearchParams('type=bridge')).total,1);
    assert.equal(searchItems([item],new URLSearchParams('kind=bridge')).total,1);
    assert.equal(searchItems([item],new URLSearchParams('type=recipe')).total,0);
    assert.throws(()=>searchItems([item],new URLSearchParams('type=bridge&kind=recipe')));
    const env={DB:new D1()};const response=await call(detail,request(`/api/items/${item.id}?type=bridge`),env,{id:item.id});assert.equal(response.status,200);assert.equal((await response.json()).item.config.mode,'token_convert');
    assert.equal((await call(detail,request(`/api/items/${item.id}?type=recipe`),env,{id:item.id})).status,404);
  }finally{catalog.items.splice(catalog.items.indexOf(item),1);delete bundles[item.id];}
});
test('Submission endpoint validates bridge before any GitHub request and honors consent',async()=>{
  const env={DB:new D1()};const consent=await(await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'bridge-test',clientType:'web'})),env)).json();
  const newSite={...site,siteId:'submission-new-bridge',bridgeUrl:'https://pickle-loginbridge--submission-new-bridge.pages.dev/'};
  const data={...input,siteId:newSite.siteId,files:{[`sites/${newSite.siteId}.json`]:JSON.stringify(newSite)},consentId:consent.consentId,termsVersion:consent.termsVersion};
  assert.equal((await call(submit,request('/api/submit',payload(data)),env)).status,403);
  env.DB.db.exec('DELETE FROM rate_limits');
  const rejected=await call(submit,request('/api/submit',payload({...data,files:{...input.files,'app.js':'alert(1)'}},credentials(consent))),env);assert.equal(rejected.status,400);
  env.DB.db.exec('DELETE FROM rate_limits');
  const valid=await call(submit,request('/api/submit',payload(data,credentials(consent))),env);assert.equal(valid.status,503);assert.equal((await valid.json()).code,'GITHUB_NOT_CONFIGURED');
});
test('GitHub bridge submission creates exactly one JSON blob with signed head metadata',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const env={GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_APP_PRIVATE_KEY:privateKey,GITHUB_REPOSITORY:'owner/repo',SUBMISSION_METADATA_SECRET:'test-only'};
  const original=globalThis.fetch,calls=[];const replies=[{token:'fake-installation-token'},{object:{sha:'base'}},{tree:{sha:'base-tree'}},{tree:[],truncated:false},{sha:'next-tree'},{sha:'head-sha'},{},{number:1,html_url:'https://github.com/owner/repo/pull/1'}];
  globalThis.fetch=async(url,options)=>{calls.push({url,...options,body:options.body?JSON.parse(options.body):null});return new Response(JSON.stringify(replies.shift()));};
  try{await openBridgeSubmission(env,{...input,termsVersion:'test',consentId:'public-id'});assert.equal(calls[4].body.tree.length,1);assert.equal(calls[4].body.tree[0].path,`bridge/sites/${site.siteId}.json`);const envelope=JSON.parse(calls[7].body.body.match(/<!-- pickle-submission\s*([\s\S]*?)\s*-->/)[1]);assert.equal(envelope.metadata.artifactType,'bridge');assert.equal(envelope.metadata.headSha,'head-sha');assert.equal(envelope.signature,createHmac('sha256',env.SUBMISSION_METADATA_SECRET).update(JSON.stringify(envelope.metadata)).digest('hex'));}finally{globalThis.fetch=original;}
});
test('Build publishes only reviewed bridge hashes and generates hosts and restricted CSP',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pickle-bridge-'));
  try{
    for(const name of ['index.html','app.js','style.css','terms.html','terms.json','site.config.json','guide.md','llms.txt','LICENSE','favicon.svg','social-card.png','template','bridge'])await cp(name,path.join(root,name),{recursive:true});
    await mkdir(path.join(root,'.github'));await writeFile(path.join(root,'.github/release-state.json'),JSON.stringify({items:{},bridges:{},processedPrs:[]}));await build(root);
    assert.equal(JSON.parse(await readFile(path.join(root,'dist/bridge/index.json'),'utf8')).items.length,0);
    await assert.rejects(readFile(path.join(root,`dist/bridge/sites/${site.siteId}.json`)));
    const bridges=Object.fromEntries(sites.map(s=>[s.siteId,{version:'1.0',hash:bridgeHash(s)}]));await writeFile(path.join(root,'.github/release-state.json'),JSON.stringify({items:{},bridges,processedPrs:[]}));await build(root);
    assert.equal(JSON.parse(await readFile(path.join(root,'dist/bridge/index.json'),'utf8')).items.length,sites.length);
    const hosts=JSON.parse(await readFile(path.join(root,'dist/hosts.json'),'utf8'));assert.equal(hosts['smartthings-pat.login.pickle-recipes.com'],site.siteId);assert.equal(hosts['pickle-loginbridge--smartthings-pat.pages.dev'],site.siteId);
    const headers=await readFile(path.join(root,'dist/_headers'),'utf8');assert.match(headers,/! Content-Security-Policy/);assert.match(headers,/connect-src 'self' https:\/\/api.homeknocktown.co.kr/);
    await writeFile(path.join(root,`bridge/sites/${site.siteId}.json`),JSON.stringify({...site,name:'Unreviewed'}));await build(root);assert.equal(JSON.parse(await readFile(path.join(root,'dist/bridge/index.json'),'utf8')).items.length,sites.length-1);
  }finally{await rm(root,{recursive:true,force:true});}
});
