import {body,json,fail} from '../../../lib/http.js';
import {verifyMaintenance} from '../../../lib/security.js';
import {runRetention} from '../../../lib/retention.js';
export async function onRequestPost({request,env}){
  const data=await body(request,1024);const nonce=await verifyMaintenance(request,env,data);
  if(await env.DB.prepare('SELECT request_id FROM maintenance_runs WHERE request_id=?').bind(nonce).first())fail(409,'OPERATION_REPLAY','이미 처리한 운영 요청입니다.');
  const claimed=await env.DB.prepare('INSERT OR IGNORE INTO maintenance_runs(request_id,executed_at) VALUES(?,?) RETURNING request_id').bind(nonce,new Date().toISOString()).first();
  if(!claimed)fail(409,'OPERATION_REPLAY','이미 처리한 운영 요청입니다.');
  return json({ok:true,...await runRetention(env.DB)});
}
