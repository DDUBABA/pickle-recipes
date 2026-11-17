export const RETENTION_DAYS=180;
export const CLEANUP_INTERVAL_MS=24*60*60*1000;
const DAY_MS=86400000;

// The claim and every deletion share a D1 transaction. Competing Cron/Pages
// requests can pass the cheap read, but only the winning run_id may delete rows.
// A failed batch rolls back the claim too, so the next request can retry.
export async function runRetention(db,{now=Date.now()}={}){
  const completedAt=new Date(now).toISOString();
  const dueBefore=new Date(now-CLEANUP_INTERVAL_MS).toISOString();
  const previous=await db.prepare("SELECT last_run_at FROM retention_state WHERE name='retention'").first();
  if(previous?.last_run_at>dueBefore)return {ran:false,lastRunAt:previous.last_run_at,retentionDays:RETENTION_DAYS};
  const cutoff=new Date(now-RETENTION_DAYS*DAY_MS).toISOString();
  const runId=crypto.randomUUID();
  const guard="EXISTS (SELECT 1 FROM retention_state WHERE name='retention' AND run_id=?)";
  // Revoked records get 180 days from withdrawal, regardless of previous activity.
  const expired=`SELECT consent_id FROM consents WHERE
    (revoked_at IS NOT NULL AND revoked_at<=?) OR
    (revoked_at IS NULL AND COALESCE(last_used_at,agreed_at)<=?)`;
  const results=await db.batch([
    db.prepare(`INSERT INTO retention_state(name,last_run_at,run_id) VALUES('retention',?,?)
      ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at,run_id=excluded.run_id
      WHERE retention_state.last_run_at<=?`).bind(completedAt,runId,dueBefore),
    db.prepare(`DELETE FROM download_logs WHERE ${guard} AND downloaded_at<=?`).bind(runId,cutoff),
    db.prepare(`DELETE FROM download_logs WHERE ${guard} AND consent_id IN (${expired})`).bind(runId,cutoff,cutoff),
    db.prepare(`DELETE FROM consent_events WHERE ${guard} AND consent_id IN (${expired})`).bind(runId,cutoff,cutoff),
    db.prepare(`DELETE FROM consents WHERE ${guard} AND consent_id IN (${expired})`).bind(runId,cutoff,cutoff),
    db.prepare(`UPDATE consents SET ip_address=NULL,user_agent=NULL WHERE ${guard} AND agreed_at<=?
      AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)`).bind(runId,cutoff),
    db.prepare(`DELETE FROM rate_limits WHERE ${guard} AND reset_at<=?`).bind(runId,Math.floor(now/1000)),
    db.prepare(`DELETE FROM maintenance_runs WHERE ${guard} AND executed_at<=?`).bind(runId,new Date(now-7*DAY_MS).toISOString())
  ]);
  return {ran:results[0].meta.changes===1,completedAt,retentionDays:RETENTION_DAYS};
}

export async function lazyCleanup(db){
  try{await runRetention(db);}
  catch{console.error('Retention cleanup failed','RETENTION_FAILED');}
}
