import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest as feedback} from '../functions/api/feedback.js';
import {runRetention} from '../lib/retention.js';
import {D1,request,call,payload} from './helpers.mjs';
const valid={category:'suggestion',title:'검색 필터 개선',content:'필터 초기화가 있으면 좋겠습니다.\n감사합니다.'};
const send=(env,data=valid,headers={})=>call(feedback,request('/api/feedback',payload(data,headers)),env);
const count=db=>db.db.prepare('SELECT COUNT(*) n FROM feedbacks').get().n;

test('Feedback exposes no read or edit API and advertises only POST and OPTIONS',async()=>{
  const env={DB:new D1()};
  for(const method of ['GET','PUT','PATCH','DELETE','HEAD']){
    const response=await call(feedback,request('/api/feedback',{method}),env);
    assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'POST, OPTIONS');
  }
  assert.equal((await call(feedback,request('/api/feedback',{method:'OPTIONS'}),env)).status,204);
  assert.equal(count(env.DB),0);
});

test('Feedback is anonymous, persisted privately, multiline and parameterized, with a receipt only',async()=>{
  const env={DB:new D1()};
  for(const [i,category] of ['bug','suggestion','question','other'].entries()){
    const data={...valid,category,title:"필터 '); DROP TABLE feedbacks; --",...(i?{submittedBy:'agent-별칭_1'}:{})};
    const response=await send(env,data);assert.equal(response.status,201);
    const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['createdAt','feedbackId','message','ok']);
    assert.match(result.feedbackId,/^[a-f0-9-]{36}$/);assert.ok(Number.isFinite(Date.parse(result.createdAt)));
    const row=env.DB.db.prepare('SELECT * FROM feedbacks WHERE feedback_id=?').get(result.feedbackId);
    assert.equal(row.title,data.title);assert.equal(row.content,data.content);assert.equal(row.submitted_by,data.submittedBy??null);
    assert.deepEqual(Object.keys(row).sort(),['category','content','created_at','feedback_id','submitted_by','title']);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(count(env.DB),4);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM consents').get().n,0);
});

test('Feedback validates fields, types, boundaries, JSON, byte limit and unknown fields before insertion',async()=>{
  const invalid=[{},null,[],{...valid,category:'invalid'},{...valid,category:[]},{...valid,title:''},{...valid,title:123},{...valid,title:'x'.repeat(121)},{...valid,title:'a\nb'},{...valid,content:'  '},{...valid,content:{}},{...valid,content:'x'.repeat(5001)},{...valid,content:'hello\u0000world'},{...valid,submittedBy:'x'.repeat(61)},{...valid,submittedBy:'has space'},{...valid,submittedBy:{}},{...valid,email:'test@example.com'},{...valid,consentToken:'anything'}];
  for(const data of invalid){const env={DB:new D1()};assert.equal((await send(env,data)).status,400,JSON.stringify(data).slice(0,150));assert.equal(count(env.DB),0);}
  const env={DB:new D1()};
  for(const [options,status] of [[{method:'POST',body:'not json'},415],[{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},400],[payload({...valid,content:'가'.repeat(9000)}),413]]){
    assert.equal((await call(feedback,request('/api/feedback',options),env)).status,status);assert.equal(count(env.DB),0);
  }
  assert.equal((await send(env,{...valid,title:'가'.repeat(120),content:'나'.repeat(5000),submittedBy:'z'.repeat(60)})).status,201);
});

test('All user fields reject PII and token patterns without echoing values or creating feedback',async()=>{
  const samples=['person@example.com','010-1234-5678','02-123-4567','900101-1234567','123가4567','101동 1001호','C:\\Users\\private\\profile.json','ghp_abcdefghijklmnopqrstuvwxyz123456','github_pat_abcdefghijklmnopqrstuvwxyz123456','Bearer abcdefghijklmnop','token=abcdefghijklmno','password: abcdefghijklmno','-----BEGIN PRIVATE KEY-----','eyJhbGciOiJIUzI1NiJ9.abcdefghijk.abcdefghijk','sk-proj-abcdefghijklmnopqrstuvw','xoxb-1234567890-abcdefghij','AIza'+'x'.repeat(35),'A1b2'.repeat(11),'Ｐｅｒｓｏｎ＠ｅｘａｍｐｌｅ．ｃｏｍ','ab\u200bcd'];
  for(const field of ['title','content','submittedBy'])for(const value of samples){
    const env={DB:new D1()},response=await send(env,{...valid,[field]:value});
    assert.equal(response.status,400,`${field}: ${value}`);
    const error=await response.json();assert.equal(error.code,'SENSITIVE_DATA');assert.ok(!JSON.stringify(error).includes(value));assert.equal(count(env.DB),0);
  }
});

test('Feedback enforces atomic IP and global quotas with Retry-After and ignores forwarded identity',async()=>{
  const env={DB:new D1()};
  const results=await Promise.all(Array.from({length:12},(_,i)=>send(env,valid,{'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':`198.51.100.${i}`})));
  assert.equal(results.filter(r=>r.status===201).length,5);assert.equal(count(env.DB),5);
  for(const response of results.filter(r=>r.status!==201)){assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal((await response.json()).code,'RATE_LIMITED');}
  assert.ok(env.DB.db.prepare('SELECT bucket_key FROM rate_limits').all().every(r=>!r.bucket_key.includes('192.0.2.1')));
  const distributed={DB:new D1()};
  distributed.DB.db.prepare('INSERT INTO rate_limits VALUES(?,?,?)').run('global-feedback',100,Math.floor(Date.now()/1000)+3600);
  assert.equal((await send(distributed,valid,{'CF-Connecting-IP':'198.51.100.1'})).status,429);assert.equal(count(distributed.DB),0);
  const invalid={DB:new D1()};for(let i=0;i<6;i++)assert.equal((await send(invalid,{})).status,i<5?400:429);
});

test('Pages trailing slash aliases share the same feedback quota',async()=>{
  const env={DB:new D1()};
  for(let i=0;i<7;i++){
    const response=await call(feedback,request(i%2?'/api/feedback/':'/api/feedback',payload(valid)),env);
    assert.equal(response.status,i<5?201:429);
  }
  assert.equal(count(env.DB),5);
});

test('Feedback rejects cross origin, absent security settings and unavailable storage without leaking errors',async t=>{
  const logs=[];t.mock.method(console,'error',(...values)=>logs.push(values.join(' ')));
  const env={DB:new D1()};
  assert.equal((await send(env,valid,{Origin:'https://other.invalid'})).status,403);
  assert.equal((await send({...env,SUBMISSION_METADATA_SECRET:''})).status,503);
  env.DB.db.exec("CREATE TRIGGER reject_feedback BEFORE INSERT ON feedbacks BEGIN SELECT RAISE(ABORT,'private-storage-detail'); END;");
  const response=await send(env),text=await response.text();assert.equal(response.status,503);assert.ok(!text.includes('private-storage-detail'));
  assert.ok(logs.every(line=>!line.includes('private-storage-detail')));assert.equal(count(env.DB),0);
});

test('Retention deletes feedback at the 180 day boundary and keeps newer receipts',async()=>{
  const db=new D1(),now=Date.now(),cutoff=now-180*86400000;
  const insert=db.db.prepare('INSERT INTO feedbacks VALUES(?,?,?,?,?,?)');
  for(const [id,time]of [['old',cutoff-1],['boundary',cutoff],['recent',cutoff+1]])insert.run(id,'question','문의','내용',null,new Date(time).toISOString());
  assert.equal((await runRetention(db,{now})).ran,true);
  assert.deepEqual(db.db.prepare('SELECT feedback_id FROM feedbacks').all().map(r=>r.feedback_id),['recent']);
});
