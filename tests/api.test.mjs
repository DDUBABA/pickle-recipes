import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as consentPost} from '../functions/api/consent.js';
import {onRequestGet as verify} from '../functions/api/consent/verify.js';
import {onRequestPost as download} from '../functions/api/download.js';
import {onRequestGet as search} from '../functions/api/search.js';
import {onRequestGet as detail} from '../functions/api/items/[id].js';
import {onRequestGet as stats} from '../functions/api/stats.js';
import {onRequestPost as submit} from '../functions/api/submit.js';
import {catalog,bundles} from '../lib/catalog.js';
import {terms} from '../lib/consent.js';
import {D1,request,call,payload,credentials,meta,files} from './helpers.mjs';
// Endpoint tests use a stable fixture even after release publishes real catalog entries.
catalog.items.splice(0,catalog.items.length,meta,{...meta,id:'blocked-service',status:'blocked'});bundles[meta.id]={'meta.json':JSON.stringify(meta),...files};
async function setup(extra={}){const env={DB:new D1(),...extra};const response=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'test-user',clientType:'web',autoUploadAllowed:true})),env);assert.equal(response.status,201);const consent=await response.json();return {env,consent,headers:credentials(consent)};}

test('Upload consent defaults to true, preserves explicit false, and agrees with stored and verified permissions',async()=>{
  for(const option of [{}, {autoUploadAllowed:true}, {autoUploadAllowed:false}]){
    const env={DB:new D1()};
    const expected=option.autoUploadAllowed!==false;
    const response=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'consent-default-test',...option})),env);
    assert.equal(response.status,201);
    const consent=await response.json();const headers=credentials(consent);
    assert.equal(consent.autoUploadAllowed,expected);
    assert.equal(env.DB.db.prepare('SELECT auto_upload_allowed FROM consents WHERE consent_id=?').get(consent.consentId).auto_upload_allowed,Number(expected));
    const verified=await call(verify,request('/api/consent/verify',{headers}),env);
    assert.equal(verified.status,200);assert.equal((await verified.json()).autoUploadAllowed,expected);
    assert.equal((await call(search,request('/api/search',{headers}),env)).status,200);
    if(!expected){
      const denied=await call(submit,request('/api/submit',payload({consentId:consent.consentId,termsVersion:consent.termsVersion},headers)),env);
      assert.equal(denied.status,403);assert.equal((await denied.json()).code,'UPLOAD_CONSENT_REQUIRED');
    }
  }
});

test('Non-boolean upload permission and absent agreement never create consent evidence',async()=>{
  for(const option of [{autoUploadAllowed:null},{autoUploadAllowed:'true'},{autoUploadAllowed:1},{autoUploadAllowed:[]},{autoUploadAllowed:{}}]){
    const env={DB:new D1()};
    const response=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'invalid-option-test',...option})),env);
    assert.equal(response.status,400);assert.equal((await response.json()).code,'INVALID_FIELD');
    assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM consents').get().n,0);
    assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM consent_events').get().n,0);
  }
  const env={DB:new D1()};
  const response=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,userIdentifier:'missing-agreement'})),env);
  assert.equal(response.status,400);assert.equal((await response.json()).code,'AGREEMENT_REQUIRED');
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM consents').get().n,0);
});

test('Previous terms require reconsent without upgrading old upload choices or rewriting evidence',async()=>{
  assert.equal(terms.termsVersion,'2026-11-17.7');
  const {env,consent,headers}=await setup();
  env.DB.db.prepare('UPDATE consents SET terms_version=?,auto_upload_allowed=0 WHERE consent_id=?').run('2026-11-17.4',consent.consentId);
  const oldRecord=env.DB.db.prepare('SELECT * FROM consents').get();
  const denied=await call(verify,request('/api/consent/verify',{headers}),env);
  assert.equal(denied.status,403);assert.equal((await denied.json()).requiresReconsent,true);
  const outdated=await call(consentPost,request('/api/consent',payload({termsVersion:'2026-11-17.4',agreed:true,userIdentifier:'old-version-test'})),env);
  assert.equal(outdated.status,409);const error=await outdated.json();
  assert.equal(error.termsVersion,'2026-11-17.7');assert.equal(error.requiresReconsent,true);
  assert.deepEqual(env.DB.db.prepare('SELECT * FROM consents').get(),oldRecord);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM consent_events').get().n,1);
});
test('Explicit consent and current terms required; token is stored only as a hash',async()=>{const {env,consent}=await setup();const row=env.DB.db.prepare('SELECT * FROM consents').get();assert.notEqual(row.consent_token_hash,consent.consentToken);assert.equal(row.user_identifier,'test-user');for(const agreed of [false,'true',1]){const result=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed,userIdentifier:'x'})),env);assert.equal(result.status,400);}assert.equal((await call(consentPost,request('/api/consent',payload({termsVersion:'old',agreed:true,userIdentifier:'x'})),env)).status,409);});
test('Public consentId alone cannot authorize API access; terms changes stop access',async()=>{const {env,consent,headers}=await setup();assert.equal((await call(verify,request('/api/consent/verify',{headers}),env)).status,200);assert.equal((await call(verify,request(`/api/consent/verify?consentId=${consent.consentId}&termsVersion=${terms.termsVersion}`),env)).status,403);env.DB.db.prepare("UPDATE consents SET terms_version='old'").run();const response=await call(verify,request('/api/consent/verify',{headers}),env);assert.equal(response.status,403);assert.equal((await response.json()).requiresReconsent,true);});
test('Search synonyms, kind filters, blocked exclusion and detail metadata',async()=>{const {env,headers}=await setup();assert.equal((await call(search,request('/api/search'),env)).status,200);let response=await call(search,request('/api/search?q=할%20일&sort=updated',{headers}),env);let data=await response.json();assert.equal(data.total,1);assert.equal(data.items[0].id,meta.id);response=await call(search,request('/api/search?kind=recipe',{headers}),env);assert.equal((await response.json()).total,0);assert.equal((await call(search,request('/api/search?limit=-1',{headers}),env)).status,400);const item=await(await call(detail,request('/api/items/sample-service',{headers}),env,{id:meta.id})).json();assert.equal(item.item.releases[0].prNumber,1);assert.equal((await call(detail,request('/api/items/blocked-service',{headers}),env,{id:'blocked-service'})).status,403);});
test('Downloads atomically record consent identity and update count; failure leaves no partial log',async()=>{const {env,consent,headers}=await setup();const input={itemId:meta.id,consentId:consent.consentId,termsVersion:terms.termsVersion,clientType:'web',userIdentifier:'forged-user'};const response=await call(download,request('/api/download',payload(input,headers)),env);assert.equal(response.status,200);assert.ok((await response.json()).files['scripts/service.py']);assert.equal(env.DB.db.prepare('SELECT user_identifier FROM download_logs').get().user_identifier,'test-user');assert.equal(env.DB.db.prepare('SELECT total_downloads FROM item_stats').get().total_downloads,1);env.DB.db.exec("CREATE TRIGGER fail_count BEFORE UPDATE ON item_stats BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");assert.equal((await call(download,request('/api/download',payload(input,headers)),env)).status,503);assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM download_logs').get().n,1);assert.equal((await call(download,request('/api/download',payload({...input,itemId:'blocked-service'},headers)),env)).status,403);assert.equal((await call(download,request('/api/download',payload({...input,termsVersion:'old'},headers)),env)).status,403);});
test('Private analytics fail closed without admin configuration; admin JSON and CSV work',async()=>{const {env,consent,headers}=await setup();await call(download,request('/api/download',payload({itemId:meta.id,...consent,clientType:'web'},headers)),env);assert.equal((await call(stats,request('/api/stats?group=users',{headers}),env)).status,403);assert.equal((await call(stats,request('/api/stats?group=items',{headers}),env)).status,200);env.ADMIN_STATS_TOKEN='test-admin';assert.equal((await call(stats,request('/api/stats?group=items'),env)).status,200);for(const group of ['items','daily','versions','users']){const response=await call(stats,request(`/api/stats?group=${group}&format=csv`,{headers:{Authorization:'Bearer test-admin'}}),env);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/csv/);assert.match(await response.text(),/sample-service/);}});
test('Submissions reject missing upload consent, PII, code execution, path traversal and duplicate new items',async()=>{const {env,consent,headers}=await setup();const {version,releases,createdAt,updatedAt,...submissionMeta}=meta;const input={...consent,type:'new',baseVersion:null,submittedBy:'public-alias',summary:'새 기능',meta:{...submissionMeta,id:'new-service',name:'새 조회'},files};assert.equal((await call(submit,request('/api/submit',payload({...input,meta:submissionMeta},headers)),env)).status,409);for(const altered of [{files:{...files,'../secret.py':'hello'}},{files:{...files,'scripts/service.py':'eval("1")'}},{summary:'연락 mail@example.com'},{meta:{...input.meta,version:'9.9'}}]){env.DB.db.exec('DELETE FROM rate_limits');assert.equal((await call(submit,request('/api/submit',payload({...input,...altered},headers)),env)).status,400);}env.DB.db.exec('DELETE FROM rate_limits');env.DB.db.prepare('UPDATE consents SET auto_upload_allowed=0').run();assert.equal((await call(submit,request('/api/submit',payload(input,headers)),env)).status,403);});
test('Cross-origin mutations and oversized JSON are rejected',async()=>{const {env}=await setup();assert.equal((await call(consentPost,request('/api/consent',payload({}, {Origin:'https://evil.invalid'})),env)).status,403);assert.equal((await call(consentPost,request('/api/consent',payload({large:'x'.repeat(9000)})),env)).status,413);});
