import {createHmac,randomUUID} from 'node:crypto';
const origin='https://pickle-recipes.pages.dev';
async function request(path,options={}){
  const response=await fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(`${path}: HTTP ${response.status}, ${data.code||'unhealthy'}`);
  return data;
}
export async function check(){
  const health=await request('/api/health');const terms=await(await fetch(origin+'/terms.json',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})).json();
  if(health.termsVersion!==terms.termsVersion)throw new Error('Runtime/static terms mismatch');
  const denied=await fetch(origin+'/api/stats?group=users',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(denied.status!==403)throw new Error('Unauthenticated private statistics access check failed');
  console.log('Health, current terms, D1 schema and private-statistics access checks passed.');
}
export async function maintenance(){
  const secret=process.env.SUBMISSION_METADATA_SECRET;if(!secret)throw new Error('Operations signing key is required');
  const time=String(Date.now()),nonce=randomUUID();
  const signature=createHmac('sha256',secret).update(`pickle-maintenance-v1\n${time}\n${nonce}\nPOST\n/api/admin/maintenance\nretention`).digest('hex');
  const data=await request('/api/admin/maintenance',{method:'POST',headers:{'Content-Type':'application/json','X-Operations-Time':time,'X-Operations-Nonce':nonce,'X-Operations-Signature':signature},body:JSON.stringify({action:'retention'})});
  console.log(`Retention maintenance ${data.ran?'completed':'skipped (24-hour interval)'}; ${data.retentionDays} days. Active consents and lifetime item counters retained.`);
}
await check();
if(process.argv.includes('--maintenance'))await maintenance();
