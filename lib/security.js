import {isIP} from 'node:net';
import {fail,bearer,constantEqual} from './http.js';
import {terms} from './consent.js';
export const CANONICAL_ORIGIN='https://pickle-recipes.pages.dev';
export const LIMITS={general:{limit:120,seconds:60},consent:{limit:5,seconds:3600},submit:{limit:3,seconds:3600},download:{limit:30,seconds:60},revoke:{limit:10,seconds:3600}};
export async function hmac(secret,message){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function secureResponse(response){
  const secured=new Response(response.body,response);
  for(const [name,value] of Object.entries({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()','Strict-Transport-Security':'max-age=31536000'}))secured.headers.set(name,value);
  return secured;
}
const localRequest=({request,env})=>env.LOCAL_DEVELOPMENT==='1'&&['localhost','127.0.0.1','[::1]','test.local'].includes(new URL(request.url).hostname);
export function enforceHost(context){
  const url=new URL(context.request.url);
  const local=localRequest(context);
  if(!local&&url.origin!==CANONICAL_ORIGIN)fail(403,'HOST_DENIED','현재 사이트 주소에서 이 커뮤니티 API를 이용해 주세요.',{siteUrl:CANONICAL_ORIGIN});
}
export function ipGroup(ip){
  const family=isIP(ip);
  if(family===4)return ip;
  if(family!==6)fail(403,'CLIENT_ADDRESS_REQUIRED','접속 주소를 확인할 수 없습니다.');
  // Group IPv6 addresses by /64, so rotating interface IDs cannot reset a quota.
  let value=ip.toLowerCase();
  if(value.includes('.')){const tail=value.slice(value.lastIndexOf(':')+1).split('.').map(Number);value=value.slice(0,value.lastIndexOf(':')+1)+((tail[0]<<8)|tail[1]).toString(16)+':'+((tail[2]<<8)|tail[3]).toString(16);}
  const [left,right]=value.split('::');const start=left?left.split(':'):[];const end=right?right.split(':'):[];
  const parts=value.includes('::')?[...start,...Array(8-start.length-end.length).fill('0'),...end]:start;
  if(parts.slice(0,5).every(v=>parseInt(v,16)===0)&&parseInt(parts[5],16)===65535){const a=parseInt(parts[6],16),b=parseInt(parts[7],16);return [a>>8,a&255,b>>8,b&255].join('.');}
  return parts.slice(0,4).map(v=>parseInt(v,16).toString(16)).join(':')+'::/64';
}
export async function consume(db,key,{limit,seconds},now=Date.now()){
  const stamp=Math.floor(now/1000),end=(Math.floor(stamp/seconds)+1)*seconds;
  const row=await db.prepare(`INSERT INTO rate_limits(bucket_key,hits,reset_at) VALUES(?,1,?)
    ON CONFLICT(bucket_key) DO UPDATE SET hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,
    reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
    WHERE reset_at<=? OR hits<? RETURNING hits,reset_at`).bind(key,end,stamp,stamp,stamp,limit).first();
  if(!row)fail(429,'RATE_LIMITED','요청이 많습니다. 잠시 후 다시 시도해 주세요.',{retryAfter:Math.max(1,end-stamp)});
}
export async function rateLimit(context){
  const {env,request}=context;const path=new URL(request.url).pathname;
  if(!env.DB||!env.SUBMISSION_METADATA_SECRET)fail(503,'SECURITY_UNAVAILABLE','보안 설정을 확인하는 동안 요청을 처리할 수 없습니다.');
  const ip=ipGroup(request.headers.get('CF-Connecting-IP')||(localRequest(context)?'127.0.0.1':''));
  const digest=await hmac(env.SUBMISSION_METADATA_SECRET,'pickle-rate-v1:'+new Date().toISOString().slice(0,10)+':'+ip);
  // Global caps also bound distributed consent and PR spam. No raw address is kept in quota rows.
  await consume(env.DB,'global-api',{limit:600,seconds:60});
  await consume(env.DB,'ip:'+digest,LIMITS.general);
  const type=path==='/api/consent'?'consent':path==='/api/submit'?'submit':path==='/api/download'?'download':path==='/api/consent/revoke'?'revoke':null;
  if(!type||request.method!=='POST')return;
  if(type==='consent')await consume(env.DB,'global-consent',{limit:100,seconds:3600});
  if(type==='submit')await consume(env.DB,'global-submit',{limit:20,seconds:3600});
  await consume(env.DB,type+':ip:'+digest,LIMITS[type]);
  const token=bearer(request);
  if(token)await consume(env.DB,type+':token:'+await hmac(env.SUBMISSION_METADATA_SECRET,'pickle-rate-token-v1:'+token),LIMITS[type]);
}
export async function verifyMaintenance(request,env,data){
  if(!env.SUBMISSION_METADATA_SECRET||!env.DB)fail(503,'SECURITY_UNAVAILABLE','운영 설정이 필요합니다.');
  const time=request.headers.get('X-Operations-Time')||'';const nonce=request.headers.get('X-Operations-Nonce')||'';
  if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>300000||! /^[a-f0-9-]{36}$/i.test(nonce)||data.action!=='retention'||Object.keys(data).length!==1)fail(403,'OPERATIONS_DENIED','운영 요청 인증에 실패했습니다.');
  const expected=await hmac(env.SUBMISSION_METADATA_SECRET,`pickle-maintenance-v1\n${time}\n${nonce}\nPOST\n/api/admin/maintenance\nretention`);
  if(!constantEqual(expected,request.headers.get('X-Operations-Signature')||''))fail(403,'OPERATIONS_DENIED','운영 요청 인증에 실패했습니다.');
  return nonce;
}
export const healthInfo=()=>({service:'pickle-recipes',termsVersion:terms.termsVersion});
