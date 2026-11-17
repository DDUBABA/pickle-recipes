import {createPrivateKey,sign} from 'node:crypto';
import {fail} from './http.js';
export async function githubRequest(path,token,method='GET',data) {
  const response=await fetch(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'pickle-recipes','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  if(!response.ok) fail(502,'GITHUB_ERROR','GitHub 요청을 완료하지 못했습니다.',{upstreamStatus:response.status});
  return response.status===204 ? null : response.json();
}
export async function installationToken(env) {
  if(!env.GITHUB_APP_ID||!env.GITHUB_APP_PRIVATE_KEY||!env.GITHUB_INSTALLATION_ID||!env.GITHUB_REPOSITORY||!env.SUBMISSION_METADATA_SECRET) fail(503,'GITHUB_NOT_CONFIGURED','관리자의 GitHub App 연결이 필요합니다.');
  const now=Math.floor(Date.now()/1000);
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iat:now-60,exp:now+540,iss:env.GITHUB_APP_ID})}`;
  const key=createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replaceAll('\\n','\n'));
  const jwt=`${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')}`;
  const result=await githubRequest(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,jwt,'POST',{repositories:[env.GITHUB_REPOSITORY.split('/')[1]],permissions:{contents:'write',pull_requests:'write'}});
  return result.token;
}
export async function signMetadata(metadata, secret) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(metadata))))].map(x=>x.toString(16).padStart(2,'0')).join('');
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
