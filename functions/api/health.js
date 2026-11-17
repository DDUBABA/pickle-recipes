import {json,fail} from '../../lib/http.js';
import {healthInfo} from '../../lib/security.js';
export async function onRequestGet({env}){
  const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE type=? AND name IN (?,?,?,?)').bind('table','consent_events','rate_limits','maintenance_runs','retention_state').first();
  const activity=await env.DB.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('consents') WHERE name='last_used_at'").first();
  if(row?.n!==4||activity?.n!==1)fail(503,'SCHEMA_NOT_READY','운영 준비 상태를 확인해 주세요.');
  const retention=await env.DB.prepare("SELECT last_run_at FROM retention_state WHERE name='retention'").first();
  return json({ok:true,...healthInfo(),retentionLastRunAt:retention?.last_run_at??null});
}
