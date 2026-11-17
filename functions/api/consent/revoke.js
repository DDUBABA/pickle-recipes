import {authenticateConsent} from '../../../lib/consent.js';
import {body,json} from '../../../lib/http.js';
export async function onRequestPost(context){
  const data=await body(context.request,8192);const row=await authenticateConsent(context,data);
  const now=row.revoked_at||new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare('UPDATE consents SET revoked_at=COALESCE(revoked_at,?) WHERE consent_id=?').bind(now,row.consent_id),
    context.env.DB.prepare('INSERT OR IGNORE INTO consent_events(event_id,consent_id,event_type,occurred_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),row.consent_id,'revoked',now)
  ]);
  const saved=await context.env.DB.prepare('SELECT revoked_at FROM consents WHERE consent_id=?').bind(row.consent_id).first();
  return json({ok:true,revoked:true,revokedAt:saved.revoked_at,evidenceRetained:true});
}
