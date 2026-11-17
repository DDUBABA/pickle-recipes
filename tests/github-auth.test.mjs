import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto, {generateKeyPairSync,verify} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {installationToken,githubRequest,signMetadata} from '../lib/github.js';
import {ApiError} from '../lib/http.js';
import {onRequestPost as submit} from '../functions/api/submit.js';
import {onRequestPost as consentPost} from '../functions/api/consent.js';
import {terms} from '../lib/consent.js';
import {D1,request,call,payload,credentials,meta,files} from './helpers.mjs';

// Ephemeral fixtures only: no deployment keys, tokens or network access.
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs1',format:'pem'});
const env={GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_APP_PRIVATE_KEY:pem,GITHUB_REPOSITORY:'owner/repo',SUBMISSION_METADATA_SECRET:'test-metadata-secret'};
const {version,releases,createdAt,updatedAt,...submissionMeta}=meta;
async function submitResponse(overrides={}) {
  const bindings={...env,...overrides,DB:new D1()};
  const response=await call(consentPost,request('/api/consent',payload({termsVersion:terms.termsVersion,agreed:true,userIdentifier:'test-alias',autoUploadAllowed:true})),bindings);
  assert.equal(response.status,201);
  const consent=await response.json();
  const input={consentId:consent.consentId,termsVersion:consent.termsVersion,type:'new',baseVersion:null,submittedBy:'test-alias',summary:'새 기능',meta:{...submissionMeta,id:'github-auth-check',name:'인증 검사'},files};
  return call(submit,request('/api/submit',payload(input,credentials(consent))),bindings);
}
function checkError(error,code,stage,status=503) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code,code);
  assert.equal(error.status,status);
  assert.equal(error.extra.stage,stage);
  assert.equal(error.cause,undefined);
  return true;
}

test('PKCS#1 and PKCS#8 normalize dashboard PEMs and sign verifiable RS256 JWTs',async t=>{
  const nativeSign=t.mock.method(nodeCrypto,'sign',()=>{throw new Error('Native signing is unavailable');});
  syncBuiltinESMExports();
  t.after(()=>{nativeSign.mock.restore();syncBuiltinESMExports();});
  const styles={
    LF:value=>value,
    CRLF:value=>value.replaceAll('\n','\r\n'),
    escapedLF:value=>value.replaceAll('\n','\\n'),
    escapedCRLF:value=>value.replaceAll('\n','\\r\\n'),
    mixed:value=>value.replace('\n','\\n'),
    quoted:value=>'"'+value.replaceAll('\n','\\n')+'"',
    singleQuoted:value=>"'"+value+"'",
    BOM:value=>'\uFEFF \n'+value+' \n'
  };
  for(const type of ['pkcs1','pkcs8']) for(const [style,normalize] of Object.entries(styles)) await t.test(`${type}: ${style}`,async t=>{
    const fetch=t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.equal(url,'https://api.github.com/app/installations/456/access_tokens');
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'manual');
      assert.deepEqual(JSON.parse(options.body),{repositories:['repo'],permissions:{contents:'write',pull_requests:'write'}});
      const [header,claims,signature]=options.headers.Authorization.slice('Bearer '.length).split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{alg:'RS256',typ:'JWT'});
      const jwt=JSON.parse(Buffer.from(claims,'base64url'));
      const now=Math.floor(Date.now()/1000);
      assert.equal(jwt.iss,'123');assert.ok(jwt.iat<=now&&jwt.iat>=now-65);
      assert.equal(jwt.exp-jwt.iat,600);assert.ok(jwt.exp<=now+540);
      assert.equal(verify('RSA-SHA256',Buffer.from(`${header}.${claims}`),publicKey,Buffer.from(signature,'base64url')),true);
      return Response.json({token:'test-installation-token'});
    });
    assert.equal(await installationToken({...env,GITHUB_APP_PRIVATE_KEY:normalize(privateKey.export({type,format:'pem'}))}),'test-installation-token');
    assert.equal(fetch.mock.callCount(),1);
  });
  assert.equal(nativeSign.mock.callCount(),0);
});

test('WebCrypto imports only the exported DER view, including pooled Buffer byte offsets',async t=>{
  for(const type of ['Buffer','Uint8Array']) await t.test(type,async t=>{
    const der=privateKey.export({format:'der',type:'pkcs8'});
    const padded=Buffer.alloc(der.length+32,0xa5);padded.set(der,13);
    const view=type==='Buffer'?padded.subarray(13,13+der.length):new Uint8Array(padded.buffer,padded.byteOffset+13,der.length);
    assert.ok(view.byteOffset>0&&view.byteLength<view.buffer.byteLength);
    const parse=nodeCrypto.createPrivateKey;
    const importKey=crypto.subtle.importKey.bind(crypto.subtle);
    const exportCalls=[];
    t.mock.method(nodeCrypto,'createPrivateKey',(...args)=>{
      const parsed=parse(...args);
      return {asymmetricKeyType:parsed.asymmetricKeyType,export(options){exportCalls.push(options);return view;}};
    });
    syncBuiltinESMExports();
    const imports=t.mock.method(crypto.subtle,'importKey',async(format,keyData,algorithm,extractable,usages)=>{
      assert.equal(format,'pkcs8');assert.ok(Buffer.from(keyData).equals(der));
      assert.deepEqual(algorithm,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'});
      assert.equal(extractable,false);assert.deepEqual(usages,['sign']);
      return importKey(format,keyData,algorithm,extractable,usages);
    });
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      const [header,claims,signature]=options.headers.Authorization.slice(7).split('.');
      assert.equal(verify('RSA-SHA256',Buffer.from(`${header}.${claims}`),publicKey,Buffer.from(signature,'base64url')),true);
      assert.match(signature,/^[A-Za-z0-9_-]+$/);
      return Response.json({token:'test-token'});
    });
    try {
      assert.equal(await installationToken(env),'test-token');
      assert.equal(imports.mock.callCount(),1);
      assert.deepEqual(exportCalls,[{format:'der',type:'pkcs8'}]);
    } finally {t.mock.restoreAll();syncBuiltinESMExports();}
  });
});

test('Missing configuration fails before signing or GitHub access',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
  for(const name of Object.keys(env)) for(const value of [undefined,'',' \r\n ']) {
    await assert.rejects(installationToken({...env,[name]:value}),error=>checkError(error,'GITHUB_NOT_CONFIGURED','configuration'));
  }
  for(const overrides of [{GITHUB_APP_ID:123},{GITHUB_INSTALLATION_ID:'https://github.com/settings/installations/456'},{GITHUB_REPOSITORY:'owner/repo/extra'},{SUBMISSION_METADATA_SECRET:{}}]) {
    await assert.rejects(installationToken({...env,...overrides}),error=>checkError(error,'GITHUB_CONFIG_INVALID','configuration'));
  }
  assert.equal(fetch.mock.callCount(),0);
});

test('GitHub Client IDs remain supported as JWT issuers',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const claims=JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1],'base64url'));
    assert.equal(claims.iss,'Iv1.testClientId');
    return Response.json({token:'test-token'});
  });
  assert.equal(await installationToken({...env,GITHUB_APP_ID:'Iv1.testClientId'}),'test-token');
});

test('Malformed, encrypted and non-RSA keys produce a safe key_parse error',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
  const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey;
  const keys=[42,{},'not-a-key',pem.replace('END RSA PRIVATE KEY','END PRIVATE KEY'),pem.replace(/[A-Za-z0-9+/]+\n/,'!\n'),
    '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
    pem.slice(0,100),pem+pem,
    publicKey.export({type:'spki',format:'pem'}),ec.export({type:'pkcs8',format:'pem'}),
    ...['pkcs1','pkcs8'].map(type=>privateKey.export({type,format:'pem',cipher:'aes-256-cbc',passphrase:'test-passphrase'}))];
  for(const key of keys) await assert.rejects(installationToken({...env,GITHUB_APP_PRIVATE_KEY:key}),error=>checkError(error,'GITHUB_KEY_INVALID','key_parse'));
  assert.equal(fetch.mock.callCount(),0);
});

test('POST /api/submit preserves configuration and key parsing error codes through middleware',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
  for(const [overrides,code,stage] of [[{GITHUB_APP_ID:''},'GITHUB_NOT_CONFIGURED','configuration'],[{GITHUB_APP_ID:123},'GITHUB_CONFIG_INVALID','configuration'],[{GITHUB_APP_PRIVATE_KEY:'test-private-key-marker'},'GITHUB_KEY_INVALID','key_parse']]) {
    const response=await submitResponse(overrides);
    assert.equal(response.status,503);
    const data=await response.json();assert.equal(data.code,code);assert.equal(data.stage,stage);
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Frame-Options'),'DENY');
    assert.ok(!JSON.stringify(data).includes('test-private-key-marker'));
  }
  assert.equal(fetch.mock.callCount(),0);
});

test('POST /api/submit returns a receipt after JWT, repository writes and metadata signing',async t=>{
  const replies=[{token:'test-token'},{object:{sha:'base-sha'}},{tree:{sha:'base-tree'}},{tree:[],truncated:false},{sha:'new-tree'},{sha:'new-commit'},{ref:'refs/heads/submissions/new'},{number:42,html_url:'https://github.com/owner/repo/pull/42'}];
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(replies.shift()));
  const response=await submitResponse({GITHUB_APP_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).replaceAll('\n','\\r\\n')});
  assert.equal(response.status,201);
  const data=await response.json();assert.equal(data.ok,true);assert.equal(data.receiptNumber,42);
  assert.equal(fetch.mock.callCount(),8);
  assert.ok(!JSON.stringify(data).includes('test-token'));
});

test('Native parser exceptions retain key_parse classification and expose no exception fields',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
  const logs=t.mock.method(console,'error',()=>{});
  t.mock.method(nodeCrypto,'createPrivateKey',()=>{throw Object.assign(new Error(pem+' test-jwt-marker'),{name:'test-secret-name'});});
  syncBuiltinESMExports();
  try {
    const response=await submitResponse();assert.equal(response.status,503);
    const data=await response.json();assert.equal(data.code,'GITHUB_KEY_INVALID');assert.equal(data.stage,'key_parse');
    assert.equal(data.errorName,undefined);assert.equal(data.errorCode,undefined);
    for(const marker of ['PRIVATE KEY','test-jwt-marker','test-secret-name']) assert.ok(!JSON.stringify(data).includes(marker));
    assert.equal(logs.mock.callCount(),0);assert.equal(fetch.mock.callCount(),0);
  } finally {t.mock.restoreAll();syncBuiltinESMExports();}
});

test('DER export, WebCrypto import and sign failures return safe jwt_sign diagnostics',async t=>{
  for(const operation of ['export','importKey','sign']) await t.test(operation,async t=>{
    const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
    const logs=t.mock.method(console,'error',()=>{});
    const error=operation==='export'?Object.assign(new Error(pem+' test-jwt-marker'),{code:'ERR_METHOD_NOT_IMPLEMENTED'}):new DOMException(pem+' test-jwt-marker',operation==='importKey'?'DataError':'OperationError');
    if(operation==='export') {
      const parse=nodeCrypto.createPrivateKey;
      t.mock.method(nodeCrypto,'createPrivateKey',(...args)=>{
        const parsed=parse(...args);
        return {asymmetricKeyType:parsed.asymmetricKeyType,export(){throw error;}};
      });
      syncBuiltinESMExports();
    } else {
      const original=crypto.subtle[operation].bind(crypto.subtle);
      t.mock.method(crypto.subtle,operation,async(...args)=>{
        if(args[0]==='pkcs8'||args[0]==='RSASSA-PKCS1-v1_5') throw error;
        return original(...args); // Preserve consent/rate-limit HMAC operations.
      });
    }
    try {
      const response=await submitResponse();assert.equal(response.status,503);
      const data=await response.json();assert.equal(data.code,'GITHUB_JWT_SIGNING_FAILED');assert.equal(data.stage,'jwt_sign');
      assert.equal(data.errorName,error.name);assert.equal(data.errorCode,error.code);
      assert.deepEqual(Object.keys(data).sort(),['code','errorCode','errorName','message','ok','stage']);
      for(const marker of ['PRIVATE KEY','test-jwt-marker']) assert.ok(!JSON.stringify(data).includes(marker));
      assert.equal(logs.mock.callCount(),0);assert.equal(fetch.mock.callCount(),0);
    } finally {t.mock.restoreAll();syncBuiltinESMExports();}
  });
});

test('JWT diagnostics reject arbitrary names/codes and tolerate hostile exception accessors',async t=>{
  const cases=[
    {label:'secret strings',error:Object.assign(new Error('test-secret-message'),{name:'test-secret-name',code:'ERR_SECRET_TOKEN_ABC'}),name:'UnknownError'},
    {label:'secret number',error:Object.assign(new Error('test-secret-message'),{code:123456789}),name:'Error'},
    {label:'objects',error:{name:{toString(){throw new Error('Must not stringify');}},code:{secret:pem}},name:'UnknownError'},
    {label:'throwing getter',error:{get name(){throw new Error('test-secret-message');}},name:'UnknownError'},
    {label:'null',error:null,name:'UnknownError'}
  ];
  for(const item of cases) await t.test(item.label,async t=>{
    const original=crypto.subtle.sign.bind(crypto.subtle);
    t.mock.method(crypto.subtle,'sign',async(...args)=>{
      if(args[0]==='RSASSA-PKCS1-v1_5') throw item.error;
      return original(...args);
    });
    const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not call GitHub');});
    const logs=t.mock.method(console,'error',()=>{});
    const response=await submitResponse();assert.equal(response.status,503);
    const data=await response.json();assert.equal(data.code,'GITHUB_JWT_SIGNING_FAILED');assert.equal(data.stage,'jwt_sign');
    assert.equal(data.errorName,item.name);assert.equal(data.errorCode,undefined);
    for(const marker of ['PRIVATE KEY','test-secret','ERR_SECRET_TOKEN_ABC','123456789']) assert.ok(!JSON.stringify(data).includes(marker));
    assert.equal(logs.mock.callCount(),0);assert.equal(fetch.mock.callCount(),0);
  });
});

test('POST /api/submit distinguishes GitHub HTTP, network, timeout and invalid response failures',async t=>{
  const cases=[
    ...[401,403,404,422,500].map(status=>({label:`HTTP ${status}`,reply:()=>new Response('test-upstream-token-marker',{status}),code:'GITHUB_ERROR',status:502,upstreamStatus:status})),
    {label:'network',reply:()=>{throw new TypeError('test-upstream-token-marker');},code:'GITHUB_NETWORK_ERROR',status:502},
    ...['TimeoutError','AbortError'].map(name=>({label:name,reply:()=>{throw new DOMException('test-upstream-token-marker',name);},code:'GITHUB_TIMEOUT',status:504})),
    {label:'non-JSON',reply:()=>new Response('test-upstream-token-marker'),code:'GITHUB_RESPONSE_INVALID',status:502,upstreamStatus:200},
    ...[{},null,{token:42},{token:' '}].map((data,i)=>({label:`invalid token ${i}`,reply:()=>Response.json(data),code:'GITHUB_RESPONSE_INVALID',status:502}))
  ];
  for(const item of cases) await t.test(item.label,async t=>{
    const fetch=t.mock.method(globalThis,'fetch',item.reply);
    const logs=t.mock.method(console,'error',()=>{});
    const response=await submitResponse();assert.equal(response.status,item.status);
    const data=await response.json();assert.equal(data.code,item.code);assert.equal(data.stage,'github_api');assert.equal(data.upstreamStatus,item.upstreamStatus);
    for(const marker of ['PRIVATE KEY','test-upstream-token-marker','test-metadata-secret']) assert.ok(!JSON.stringify(data).includes(marker));
    assert.equal(fetch.mock.callCount(),1);assert.equal(logs.mock.callCount(),0);
  });
});

test('GitHub response body read failures are classified and 204 remains supported',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:async()=>{throw new Error('test-body-secret');}}));
  await assert.rejects(githubRequest('/test','test-token'),error=>checkError(error,'GITHUB_RESPONSE_INVALID','github_api',502));
  fetch.mock.mockImplementation(async()=>new Response(null,{status:204}));
  assert.equal(await githubRequest('/test','test-token','DELETE'),null);
});

test('WebCrypto metadata import and sign failures expose only the metadata_sign stage',async t=>{
  for(const method of ['importKey','sign']) await t.test(method,async t=>{
    t.mock.method(crypto.subtle,method,async()=>{throw new Error('test-metadata-secret');});
    await assert.rejects(signMetadata({itemId:'test'},'test-metadata-secret'),error=>{
      assert.ok(!error.message.includes('test-metadata-secret'));
      return checkError(error,'SUBMISSION_METADATA_SIGNING_FAILED','metadata_sign');
    });
  });
});

test('Middleware keeps unrelated failures generic and never logs arbitrary exception fields',async t=>{
  const logs=t.mock.method(console,'error',()=>{});
  const response=await call(()=>{throw Object.assign(new Error('test-secret-message'),{name:'test-secret-name'});},request('/api/submit'),{DB:new D1()});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'SERVICE_UNAVAILABLE');
  assert.deepEqual(logs.mock.calls.map(call=>call.arguments),[['API failure','SERVICE_UNAVAILABLE']]);
  const missing=await call(submit,request('/api/submit'),{DB:new D1(),SUBMISSION_METADATA_SECRET:''});
  assert.equal(missing.status,503);assert.equal((await missing.json()).code,'SECURITY_UNAVAILABLE');
});
