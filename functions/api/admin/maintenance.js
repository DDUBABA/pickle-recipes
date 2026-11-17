import {body,json,fail} from '../../../lib/http.js';
import {verifyMaintenance,RETENTION_DAYS} from '../../../lib/security.js';
export async function onRequestPost({request,env}){
  const data=await body(request,1024);const nonce=await verifyMaintenance(request,env,data);
  const now=new Date().toISOString(),cutoff=new Date(Date.now()-RETENTION_DAYS*86400000).toISOString();
  if(await env.DB.prepare('SELECT request_id FROM maintenance_runs WHERE request_id=?').bind(nonce).first())fail(409,'OPERATION_REPLAY','이미 처리한 운영 요청입니다.');
  // The unique nonce and all retention work share one transaction. A concurrent replay rolls back.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO maintenance_runs(request_id,executed_at) VALUES(?,?)').bind(nonce,now),
    env.DB.prepare('DELETE FROM download_logs WHERE downloaded_at<?').bind(cutoff),
    env.DB.prepare('UPDATE consents SET ip_address=NULL,user_agent=NULL WHERE agreed_at<? AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)').bind(cutoff),
    env.DB.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(Math.floor(Date.now()/1000)),
    env.DB.prepare('DELETE FROM maintenance_runs WHERE executed_at<?').bind(new Date(Date.now()-7*86400000).toISOString())
  ]);
  return json({ok:true,completedAt:now,retentionDays:RETENTION_DAYS,consentEvidenceRetained:true});
}
