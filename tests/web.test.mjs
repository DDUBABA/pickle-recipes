import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const terms=JSON.parse(readFileSync(new URL('../terms.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const item={id:'example',name:'예시',description:'예시 설명',kind:'connector',status:'active',version:'1.0',category:'생활',authType:'none',tags:[],requires:[],releases:[],readme:'# 실행 안내',totalDownloads:12};
const consent={consentId:'example-consent',consentToken:'secret',termsVersion:terms.termsVersion,expiresAt:null};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the actual browser script with a small DOM/event harness. Network and
// download side effects are observable; no production requests or real tokens.
function browser({stored=null,verifyStatus=200,downloadStatus=200,storageBlocked=false,feedbackStatus=201}={}){
  const calls=[],downloads=[],nodes=new Map(),timers=new Map();let timer=0;
  class Element {
    children=[];listeners={};value='';hidden=false;open=false;disabled=false;dataset={};
    classList={toggle(){}};
    constructor(tag){this.tagName=tag;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,fn){this.listeners[name]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.close?.();}
    click(){if(this.download)downloads.push(this.download);return this.onclick?.();}
    remove(){}
    reset(){for(const id of ['#feedback-title','#feedback-content','#feedback-alias'])get(id).value='';}
  }
  for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+match[1],new Element('div'));
  const get=selector=>nodes.get(selector);
  get('#sort').value='downloads';get('#user-identifier').value='web-test';
  const storage=new Map(stored?[['pickle-recipes-consent',JSON.stringify(stored)]]:[]);
  class BrowserURL extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}}
  const context=vm.createContext({
    document:{querySelector:get,querySelectorAll:()=>[],createElement:tag=>new Element(tag),body:new Element('body')},
    localStorage:{getItem(key){if(storageBlocked)throw new Error('Storage disabled');return storage.get(key)??null;},setItem(key,value){if(storageBlocked)throw new Error('Storage disabled');storage.set(key,value);},removeItem(key){if(storageBlocked)throw new Error('Storage disabled');storage.delete(key);}},
    window:{addEventListener(){}},navigator:{},location:{origin:'https://test.local'},URL:BrowserURL,URLSearchParams,Blob,
    setTimeout(fn,delay){timers.set(++timer,{fn,delay});return timer;},clearTimeout:id=>timers.delete(id),
    async fetch(path,options={}){
      calls.push({path,options});let data,status=200;
      if(path==='/recipes/index.json')data={items:[item]};
      else if(path==='/terms.json')data=terms;
      else if(path.startsWith('/api/search'))data={items:[item],total:1};
      else if(path.startsWith('/api/items/'))data={item};
      else if(path==='/api/consent/verify'){status=verifyStatus;data=status===200?{ok:true}:{requiresConsent:status===403,message:'다시 동의해 주세요.'};}
      else if(path==='/api/consent/revoke')data={ok:true,revoked:true};
      else if(path==='/api/consent')data={ok:true,...consent};
      else if(path==='/api/download'){status=downloadStatus;data=status===200?{ok:true,version:'1.0',files:{}}:{message:'일시적인 오류'};}
      else if(path==='/api/feedback'){status=feedbackStatus;data=status===201?{ok:true,feedbackId:'receipt-example'}:{message:'입력 확인',retryAfter:60};}
      else throw new Error('Unexpected request '+path);
      return {ok:status<400,status,json:async()=>data};
    }
  });
  vm.runInContext(source,context);
  return {get,calls,downloads,storage,run:code=>vm.runInContext(code,context),typeSearch:async()=>{get('#search').value='예시';get('#search').listeners.input();for(const [id,{fn,delay}] of timers)if(delay===300){timers.delete(id);fn();}await flush();}};
}

test('Web entry, live keyword search and README detail never prompt for consent, including stale saved tokens',async()=>{
  for(const stored of [null,{...consent,termsVersion:'older'}]){
    const b=browser({stored});await flush();assert.ok(b.calls.some(c=>c.path.startsWith('/api/search')));
    await b.typeSearch();assert.ok(b.calls.some(c=>c.path.includes('q=%EC%98%88%EC%8B%9C')));
    await b.run("showDetail('example')");assert.equal(b.get('#detail-dialog').open,true);assert.equal(b.get('#consent-dialog').open,false);
    assert.ok(b.get('#detail-content').children.some(n=>n.tagName==='details'));
    assert.ok(!b.calls.some(c=>c.path.includes('/consent')||c.path==='/terms.json'));
    assert.ok(b.calls.every(c=>!c.options.headers?.Authorization));
  }
  const blocked=browser({storageBlocked:true});await flush();await blocked.typeSearch();
  assert.equal(blocked.get('#consent-dialog').open,false);assert.ok(blocked.get('#catalog').children.length);
});

test('Feedback submits without saved consent credentials, shows a receipt and clears fields only on success',async()=>{
  const b=browser({stored:consent});await flush();
  b.get('#feedback-category').value='suggestion';b.get('#feedback-title').value='개선';b.get('#feedback-content').value='필터 초기화';
  const send=b.get('#feedback-form').listeners.submit;
  const pending=send({preventDefault(){}});await send({preventDefault(){}});await pending;
  const calls=b.calls.filter(c=>c.path==='/api/feedback');assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].options.body),{category:'suggestion',title:'개선',content:'필터 초기화'});
  assert.ok(!calls[0].options.headers.Authorization);assert.ok(!calls[0].options.headers['X-Consent-Id']);assert.ok(!calls[0].options.headers['X-Terms-Version']);
  assert.match(b.get('#feedback-status').textContent,/receipt-example/);assert.equal(b.get('#feedback-content').value,'');assert.equal(b.get('#feedback-submit').disabled,false);
  assert.equal(b.get('#consent-dialog').open,false);
});

test('Feedback failures preserve the draft; 429 prevents early retry and uncertain responses are not repeated',async()=>{
  for(const feedbackStatus of [400,429,503]){
    const b=browser({feedbackStatus});await flush();b.get('#feedback-content').value='보존할 내용';
    await b.get('#feedback-form').listeners.submit({preventDefault(){}});
    if(feedbackStatus===429){await b.get('#feedback-form').listeners.submit({preventDefault(){}});assert.match(b.get('#feedback-status').textContent,/초 후/);}
    if(feedbackStatus===503)assert.match(b.get('#feedback-status').textContent,/자동 재전송하지 않습니다/);
    assert.equal(b.calls.filter(c=>c.path==='/api/feedback').length,1);assert.equal(b.get('#feedback-content').value,'보존할 내용');assert.equal(b.get('#feedback-submit').disabled,false);
  }
});

test('Download prompts at execution, cancellation preserves browsing, and acceptance resumes the same download once',async()=>{
  const b=browser();await flush();await b.run("showDetail('example')");
  let action=b.run('downloadItem({id:"example"})');await flush();
  assert.equal(b.get('#consent-dialog').open,true);assert.equal(b.downloads.length,0);
  b.get('#consent-dialog').close();await action;assert.equal(b.get('#detail-dialog').open,true);
  await b.typeSearch();assert.equal(b.get('#consent-dialog').open,false);
  action=b.run('downloadItem({id:"example"})');await flush();
  await b.get('#consent-form').listeners.submit({preventDefault(){}});await action;
  assert.equal(b.get('#consent-dialog').open,false);assert.deepEqual(b.downloads,['example-v1.0.json']);
  assert.equal(b.calls.filter(c=>c.path==='/api/download').length,1);
  assert.equal(b.calls.find(c=>c.path==='/api/download').options.headers.Authorization,'Bearer secret');
  await b.get('#disconnect').onclick();assert.equal(b.storage.size,0);
  assert.equal(b.get('#detail-dialog').open,true);assert.equal(b.get('#consent-dialog').open,false);
  await b.typeSearch();assert.ok(b.get('#catalog').children.length);
});

test('Revoked credentials prompt only on download; verification/network failures never download or auto-retry',async()=>{
  const b=browser({stored:consent,verifyStatus:403});await flush();assert.equal(b.get('#consent-dialog').open,false);
  const action=b.run('downloadItem({id:"example"})');await flush();assert.equal(b.get('#consent-dialog').open,true);
  b.get('#consent-dialog').close();await action;assert.equal(b.downloads.length,0);
  const unavailable=browser({stored:consent,verifyStatus:503});await flush();await unavailable.run('downloadItem({id:"example"})');
  assert.equal(unavailable.get('#consent-dialog').open,false);assert.equal(unavailable.calls.filter(c=>c.path==='/api/download').length,0);
  const uncertain=browser({stored:consent,downloadStatus:503});await flush();await uncertain.run('downloadItem({id:"example"})');
  assert.equal(uncertain.calls.filter(c=>c.path==='/api/download').length,1);assert.equal(uncertain.downloads.length,0);
});
