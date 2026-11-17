import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1,request,call,payload,credentials,meta,files} from './helpers.mjs';
import {runRetention,CLEANUP_INTERVAL_MS} from '../lib/retention.js';
import worker from '../workers/retention-cron/index.js';
import {onRequestPost as grant} from '../functions/api/consent.js';
import {onRequestPost as download} from '../functions/api/download.js';
import {onRequestPost as submit} from '../functions/api/submit.js';
import {onRequestGet as verify} from '../functions/api/consent/verify.js';
import {onRequestGet as search} from '../functions/api/search.js';
import {onRequestGet as detail} from '../functions/api/items/[id].js';
import {onRequestGet as stats} from '../functions/api/stats.js';
import {onRequestGet as health} from '../functions/api/health.js';
import {terms} from '../lib/consent.js';
import {catalog,bundles} from '../lib/catalog.js';
const now=Date.parse('2026-11-17T19:00:00.000Z');
const ago=days=>new Date(now-days*86400000).toISOString();
function seed(db,id,{used=ago(1),revoked=null,agreed=ago(300)}={}){
  db.db.prepare(`INSERT INTO consents(consent_id,terms_version,agreed_at,user_identifier,client_type,created_at,consent_token_hash,last_used_at,revoked_at,ip_address,user_agent)
    VALUES(?,?,?,?,'web',?,'hash',?,?,?,?)`).run(id,terms.termsVersion,agreed,id,agreed,used,revoked,'192.0.2.1','browser');
  db.db.prepare("INSERT INTO consent_events VALUES(?,?,'granted',?)").run('event-'+id,id,agreed);
}
function log(db,id,consentId,time){db.db.prepare("INSERT INTO download_logs(log_id,item_id,item_kind,version,consent_id,user_identifier,client_type,downloaded_at) VALUES(?,'item','connector','1.0',?,?,'web',?)").run(id,consentId,consentId,time);}
const ids=(db,table,key)=>db.db.prepare(`SELECT ${key} FROM ${table} ORDER BY ${key}`).all().map(r=>r[key]);

test('180-day cleanup respects active/revoked boundaries, deletes personal child records and retains totals',async()=>{
  const db=new D1();
  seed(db,'active');seed(db,'inactive',{used:ago(180)});
  seed(db,'just-active',{used:new Date(Date.parse(ago(180))+1).toISOString()});
  seed(db,'revoked-old',{revoked:ago(180)});
  seed(db,'revoked-recent',{used:ago(300),revoked:ago(1)});
  seed(db,'legacy-inactive',{used:null});
  for(const id of ['active','inactive','just-active','revoked-old','revoked-recent','legacy-inactive'])log(db,id,id,ago(1));
  log(db,'old-telemetry','active',ago(180));
  db.db.exec("INSERT INTO item_stats VALUES('item','connector',77,NULL); INSERT INTO rate_limits VALUES('old-ip-hash',1,0);");
  assert.equal((await runRetention(db,{now})).ran,true);
  assert.deepEqual(ids(db,'consents','consent_id'),['active','just-active','revoked-recent']);
  assert.deepEqual(ids(db,'consent_events','consent_id'),['active','just-active','revoked-recent']);
  assert.deepEqual(ids(db,'download_logs','log_id'),['active','just-active','revoked-recent']);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM consents WHERE ip_address IS NOT NULL OR user_agent IS NOT NULL').get().n,0);
  assert.equal(db.db.prepare('SELECT total_downloads FROM item_stats').get().total_downloads,77);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM rate_limits').get().n,0);
  assert.deepEqual(db.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('Cron and concurrent lazy requests share one atomic claim, respect 24 hours and retry rolled-back failures',async()=>{
  const db=new D1();seed(db,'old',{used:ago(200)});
  db.db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON consents BEGIN SELECT RAISE(ABORT,'cleanup failed'); END;");
  await assert.rejects(runRetention(db,{now}));
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM retention_state').get().n,0);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM consent_events').get().n,1);
  db.db.exec('DROP TRIGGER fail_cleanup');
  const outcomes=await Promise.all(Array.from({length:8},()=>runRetention(db,{now})));
  assert.equal(outcomes.filter(x=>x.ran).length,1);
  seed(db,'next',{used:ago(200)});
  assert.equal((await runRetention(db,{now:now+CLEANUP_INTERVAL_MS-1})).ran,false);
  assert.deepEqual(ids(db,'consents','consent_id'),['next']);
  assert.equal((await runRetention(db,{now:now+CLEANUP_INTERVAL_MS})).ran,true);
  assert.deepEqual(ids(db,'consents','consent_id'),[]);
  const cronDb=new D1();seed(cronDb,'cron-old',{used:'2000-01-01T00:00:00.000Z'});
  await worker.scheduled({}, {DB:cronDb});assert.deepEqual(ids(cronDb,'consents','consent_id'),[]);
  await assert.rejects(worker.scheduled({}, {DB:{prepare(){throw new Error('D1 unavailable');}}}));
});

test('Migration preserves latest known activity and revocation, removes historical expiry, supports legacy inserts',()=>{
  const db=new DatabaseSync(':memory:');
  for(const name of ['0001_init.sql','0002_security.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const insert=db.prepare("INSERT INTO consents(consent_id,terms_version,agreed_at,user_identifier,client_type,created_at,consent_token_hash,expires_at,revoked_at) VALUES(?,'older',?,'alias','web',?,'hash',?,?)");
  insert.run('downloaded',ago(300),ago(300),ago(210),null);
  insert.run('never-used',ago(10),ago(10),ago(-80),ago(1));
  log({db},'latest','downloaded',ago(5));
  db.exec(readFileSync(new URL('../migrations/0003_consent_retention.sql',import.meta.url),'utf8'));
  const rows=db.prepare('SELECT * FROM consents ORDER BY consent_id').all();
  assert.equal(rows[0].last_used_at,ago(5));assert.equal(rows[1].last_used_at,ago(10));
  assert.ok(rows.every(r=>r.expires_at===null&&r.terms_version==='older'));
  assert.equal(rows[1].revoked_at,ago(1));
  // Requests from the previous Pages release during rollout can still insert.
  insert.run('rollout',ago(0),ago(0),ago(-90),null);
  assert.equal(db.prepare("SELECT last_used_at FROM consents WHERE consent_id='rollout'").get().last_used_at,null);
  db.close();
});

async function setup(){
  const env={DB:new D1()};
  const response=await call(grant,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'active-user'})),env);
  assert.equal(response.status,201);const consent=await response.json();return {env,consent,headers:credentials(consent)};
}
catalog.items.push(meta);bundles[meta.id]={'meta.json':JSON.stringify(meta),...files};

test('Consent has no fixed expiry, verifies old timestamps and updates activity only for valid authentication',async()=>{
  const {env,consent,headers}=await setup();assert.equal(consent.expiresAt,null);assert.equal(consent.lastUsedAt,consent.agreedAt);
  env.DB.db.exec("UPDATE consents SET expires_at='2000-01-01T00:00:00.000Z',last_used_at='2000-01-01T00:00:00.000Z'");
  const response=await call(verify,request('/api/consent/verify',{headers}),env);
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.expiresAt,null);assert.ok(Date.parse(data.lastUsedAt)>Date.now()-10000);
  for(const altered of [{...headers,Authorization:'Bearer forged'},{...headers,'X-Terms-Version':'older'}]){
    const before=env.DB.db.prepare('SELECT last_used_at FROM consents').get();
    assert.equal((await call(verify,request('/api/consent/verify',{headers:altered}),env)).status,403);
    assert.deepEqual(env.DB.db.prepare('SELECT last_used_at FROM consents').get(),before);
  }
});

test('Public browsing works with no/invalid/revoked credentials without touching consent activity; mutations stay protected',async()=>{
  const {env,consent,headers}=await setup();env.ADMIN_STATS_TOKEN='admin';
  env.DB.db.exec("UPDATE consents SET last_used_at='2000-01-01T00:00:00.000Z',revoked_at='2026-11-17T00:00:00.000Z'");
  for(const auth of [{},headers,{Authorization:'Bearer forged'}]){
    for(const [handler,path,params] of [[search,'/api/search?q=할%20일',{}],[detail,'/api/items/sample-service',{id:meta.id}],[stats,'/api/stats?group=items',{}]]){
      const response=await call(handler,request(path,{headers:auth}),env,params);assert.equal(response.status,200);
      if(handler===detail){const {item}=await response.json();assert.equal(item.readme,files['README.md']);assert.equal(item.releases.length,1);assert.equal(item.totalDownloads,0);}
    }
    for(const group of ['daily','versions','users'])assert.equal((await call(stats,request('/api/stats?group='+group,{headers:auth}),env)).status,403);
  }
  assert.equal(env.DB.db.prepare('SELECT last_used_at FROM consents').get().last_used_at,'2000-01-01T00:00:00.000Z');
  for(const [handler,path] of [[download,'/api/download'],[submit,'/api/submit']]){
    for(const auth of [{},headers,{Authorization:'Bearer forged'}])assert.equal((await call(handler,request(path,payload({...consent,itemId:meta.id},auth)),env)).status,403);
  }
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM download_logs').get().n,0);
});

test('Lazy cleanup runs on grants/downloads, refreshes the caller first, and failures do not break successful writes',async()=>{
  const {env,consent,headers}=await setup();
  assert.ok(env.DB.db.prepare('SELECT last_run_at FROM retention_state').get());
  seed(env.DB,'unused',{used:'2000-01-01T00:00:00.000Z'});
  env.DB.db.exec("UPDATE consents SET last_used_at='2000-01-01T00:00:00.000Z'; DELETE FROM retention_state");
  const downloaded=await call(download,request('/api/download',payload({...consent,itemId:meta.id,clientType:'web'},headers)),env);
  assert.equal(downloaded.status,200);assert.deepEqual(ids(env.DB,'consents','consent_id'),[consent.consentId]);
  seed(env.DB,'retry',{used:'2000-01-01T00:00:00.000Z'});
  env.DB.db.exec("DELETE FROM retention_state; CREATE TRIGGER fail_lazy BEFORE DELETE ON consents BEGIN SELECT RAISE(ABORT,'fail'); END;");
  assert.equal((await call(download,request('/api/download',payload({...consent,itemId:meta.id},headers)),env)).status,200);
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM retention_state').get().n,0);
  env.DB.db.exec('DROP TRIGGER fail_lazy');
  assert.equal((await call(download,request('/api/download',payload({...consent,itemId:meta.id},headers)),env)).status,200);
  assert.deepEqual(ids(env.DB,'consents','consent_id'),[consent.consentId]);
  const status=await(await call(health,request('/api/health'),env)).json();assert.ok(status.retentionLastRunAt);
});
