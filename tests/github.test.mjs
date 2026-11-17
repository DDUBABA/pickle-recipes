import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHmac} from 'node:crypto';
import {openSubmission} from '../lib/github.js';
import {meta,files} from './helpers.mjs';
test('GitHub App creates one scoped tree commit and PR; metadata binds exact head and receipt',async()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const env={GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_APP_PRIVATE_KEY:privateKey,GITHUB_REPOSITORY:'owner/repo',SUBMISSION_METADATA_SECRET:'local-test-only'};
  const original=globalThis.fetch;const calls=[];
  const replies=[{token:'installation-token'},{object:{sha:'base-sha'}},{tree:{sha:'base-tree'}},{tree:[],truncated:false},{sha:'new-tree'},{sha:'new-commit'},{ref:'refs/heads/submissions/new'},{number:42,html_url:'https://github.com/owner/repo/pull/42'}];
  globalThis.fetch=async(url,options)=>{calls.push({url,...options,body:options.body?JSON.parse(options.body):null});return new Response(JSON.stringify(replies.shift()),{headers:{'Content-Type':'application/json'}});};
  try{
    const {version,releases,createdAt,updatedAt,...inputMeta}=meta;
    const result=await openSubmission(env,{type:'new',meta:inputMeta,files,baseVersion:null,submittedBy:'alias',termsVersion:'test',consentId:'public-id',summary:'첫 버전'});
    assert.equal(result.receiptNumber,42);assert.equal(calls.length,8);assert.deepEqual(calls[0].body.repositories,['repo']);
    assert.equal(calls[4].body.tree.length,3);assert.ok(calls[4].body.tree.every(entry=>entry.path.startsWith(`recipes/${meta.id}/`)));
    const envelope=JSON.parse(calls[7].body.body.match(/<!-- pickle-submission\s*([\s\S]*?)\s*-->/)[1]);
    assert.equal(envelope.metadata.headSha,'new-commit');assert.equal(envelope.metadata.consentId,'public-id');assert.equal(envelope.signature,createHmac('sha256',env.SUBMISSION_METADATA_SECRET).update(JSON.stringify(envelope.metadata)).digest('hex'));
    assert.ok(!calls[7].body.body.includes('installation-token'));
  }finally{globalThis.fetch=original;}
});
