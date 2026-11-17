import {json,fail} from '../../lib/http.js';
import {healthInfo} from '../../lib/security.js';
export async function onRequestGet({env}){
  const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=? AND name IN (?,?,?)').bind('table','consent_events','rate_limits','maintenance_runs').first();
  if(row?.n!==3)fail(503,'SCHEMA_NOT_READY','운영 준비 상태를 확인해 주세요.');
  return json({ok:true,...healthInfo()});
}
