import {createPrivateKey,sign} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {fail} from './http.js';

function appPrivateKey(value) {
  try {
    // Dashboard secrets can contain literal escape sequences or copied outer quotes.
    let pem=value.trim();
    if((pem.startsWith('"')&&pem.endsWith('"'))||(pem.startsWith("'")&&pem.endsWith("'"))) pem=pem.slice(1,-1).trim();
    pem=pem.replaceAll('\\r\\n','\n').replaceAll('\\n','\n').replace(/\r\n?/g,'\n').trim();
    if(!/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+[A-Za-z0-9+/=\s]+\s+-----END \1-----$/.test(pem)) throw new Error();
    // node:crypto accepts both GitHub's PKCS#1 PEM and unencrypted PKCS#8 PEM.
    const key=createPrivateKey({key:pem,format:'pem'});
    if(key.asymmetricKeyType!=='rsa') throw new Error();
    return key;
  } catch {
    fail(503,'GITHUB_KEY_INVALID','GitHub App 개인키 형식을 확인해 주세요.',{stage:'key_parse'});
  }
}

export async function githubRequest(path,token,method='GET',data) {
  let response;
  try {
    response=await fetch(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'pickle-recipes','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000),redirect:'manual'});
  } catch(error) {
    if(error?.name==='TimeoutError'||error?.name==='AbortError') fail(504,'GITHUB_TIMEOUT','GitHub 응답 시간이 초과되었습니다.',{stage:'github_api'});
    fail(502,'GITHUB_NETWORK_ERROR','GitHub에 연결하지 못했습니다.',{stage:'github_api'});
  }
  if(!response.ok) fail(502,'GITHUB_ERROR','GitHub 요청을 완료하지 못했습니다.',{stage:'github_api',upstreamStatus:response.status});
  if(response.status===204) return null;
  try {
    return await response.json();
  } catch {
    fail(502,'GITHUB_RESPONSE_INVALID','GitHub 응답을 확인하지 못했습니다.',{stage:'github_api',upstreamStatus:response.status});
  }
}
export async function installationToken(env) {
  const required=['GITHUB_APP_ID','GITHUB_APP_PRIVATE_KEY','GITHUB_INSTALLATION_ID','GITHUB_REPOSITORY','SUBMISSION_METADATA_SECRET'];
  if(required.some(name=>env[name]==null||env[name]===''||(typeof env[name]==='string'&&!env[name].trim()))) fail(503,'GITHUB_NOT_CONFIGURED','관리자의 GitHub App 연결이 필요합니다.',{stage:'configuration'});
  // GitHub accepts either an App ID or a Client ID as the JWT issuer.
  const validIssuer=typeof env.GITHUB_APP_ID==='string'&&/^\S+$/.test(env.GITHUB_APP_ID);
  const validInstallation=typeof env.GITHUB_INSTALLATION_ID==='string'&&/^[1-9]\d*$/.test(env.GITHUB_INSTALLATION_ID);
  const validRepository=typeof env.GITHUB_REPOSITORY==='string'&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY);
  if(!validIssuer||!validInstallation||!validRepository||typeof env.SUBMISSION_METADATA_SECRET!=='string') fail(503,'GITHUB_CONFIG_INVALID','GitHub App 연결 설정을 확인해 주세요.',{stage:'configuration'});
  const key=appPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  let jwt;
  try {
    const now=Math.floor(Date.now()/1000);
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iat:now-60,exp:now+540,iss:env.GITHUB_APP_ID})}`;
    jwt=`${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')}`;
  } catch {
    fail(503,'GITHUB_JWT_SIGNING_FAILED','GitHub App 인증 서명에 실패했습니다.',{stage:'jwt_sign'});
  }
  const result=await githubRequest(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,jwt,'POST',{repositories:[env.GITHUB_REPOSITORY.split('/')[1]],permissions:{contents:'write',pull_requests:'write'}});
  if(typeof result?.token!=='string'||!result.token.trim()) fail(502,'GITHUB_RESPONSE_INVALID','GitHub 인증 응답을 확인하지 못했습니다.',{stage:'github_api'});
  return result.token;
}
export async function signMetadata(metadata, secret) {
  try {
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(metadata))))].map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch {
    fail(503,'SUBMISSION_METADATA_SIGNING_FAILED','접수 메타데이터 서명에 실패했습니다.',{stage:'metadata_sign'});
  }
}
export async function openSubmission(env, data) {
  const token=await installationToken(env);
  const repo=`/repos/${env.GITHUB_REPOSITORY}`;
  const branch=env.GITHUB_DEFAULT_BRANCH || 'main';
  const head=await githubRequest(`${repo}/git/ref/heads/${encodeURIComponent(branch)}`,token);
  const base=await githubRequest(`${repo}/git/commits/${head.object.sha}`,token);
  const tree=await githubRequest(`${repo}/git/trees/${base.tree.sha}?recursive=1`,token);
  if(tree.truncated) fail(503,'REPOSITORY_TOO_LARGE','저장소 목록이 너무 큽니다. 관리자 검토가 필요합니다.');
  const root=`recipes/${data.meta.id}/`;
  const existing=tree.tree.find(entry=>entry.path===root+'meta.json');
  let current=null;
  if(existing) {
    const blob=await githubRequest(`${repo}/git/blobs/${existing.sha}`,token);
    current=JSON.parse(Buffer.from(blob.content,'base64').toString('utf8'));
  }
  if(data.type==='patch') {
    if(!current || current.version!==data.baseVersion || current.status==='blocked') fail(409,'VERSION_CONFLICT','기준 버전이 변경되었거나 항목이 차단되었습니다. 최신 항목을 다시 조회해 주세요.');
    if(data.meta.kind!==current.kind) fail(400,'KIND_CHANGED','패치에서 종류를 변경할 수 없습니다.');
  } else if(existing) fail(409,'DUPLICATE_ITEM','같은 ID가 이미 존재합니다.');
  const publicMeta={...data.meta,version:current?.version || '1.0',releases:current?.releases || [],createdAt:current?.createdAt || new Date().toISOString(),updatedAt:current?.updatedAt || new Date().toISOString()};
  const files={...data.files,'meta.json':JSON.stringify(publicMeta,null,2)+'\n'};
  const changes=Object.entries(files).map(([path,content])=>({path:root+path,mode:'100644',type:'blob',content}));
  // A submission is a complete common-code bundle. Remove obsolete scripts in the same item only.
  for(const entry of tree.tree) if(entry.type==='blob'&&entry.path.startsWith(root+'scripts/')&&entry.path.endsWith('.py')&&!(entry.path.slice(root.length) in files)) changes.push({path:entry.path,mode:'100644',type:'blob',sha:null});
  const newTree=await githubRequest(`${repo}/git/trees`,token,'POST',{base_tree:base.tree.sha,tree:changes});
  const commit=await githubRequest(`${repo}/git/commits`,token,'POST',{message:`${data.type}: ${data.meta.id}`,tree:newTree.sha,parents:[head.object.sha]});
  const submissionBranch=`submissions/${data.meta.id}-${crypto.randomUUID()}`;
  await githubRequest(`${repo}/git/refs`,token,'POST',{ref:`refs/heads/${submissionBranch}`,sha:commit.sha});
  const metadata={itemId:data.meta.id,type:data.type,baseVersion:data.baseVersion,submittedBy:data.submittedBy,termsVersion:data.termsVersion,consentId:data.consentId,summary:data.summary,headSha:commit.sha};
  const envelope={metadata,signature:await signMetadata(metadata,env.SUBMISSION_METADATA_SECRET)};
  const pr=await githubRequest(`${repo}/pulls`,token,'POST',{title:`[${data.type}] ${data.meta.name}`,head:submissionBranch,base:branch,body:`${data.summary}\n\n공통 코드만 포함합니다. 병합 전 보안 검토와 필수 검사를 완료해 주세요. 버전은 병합 자동화가 확정합니다.\n\n<!-- pickle-submission\n${JSON.stringify(envelope,null,2)}\n-->`});
  return {prNumber:pr.number,receiptNumber:pr.number,url:pr.html_url};
}
