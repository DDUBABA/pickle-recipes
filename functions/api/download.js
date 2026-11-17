import {body,json,clientType,requestInfo,fail} from '../../lib/http.js';
import {verifyConsent} from '../../lib/consent.js';
import {getItem,bundles} from '../../lib/catalog.js';
export async function onRequestPost(context) {
  const data = await body(context.request,8192);
  const consent = await verifyConsent(context,data);
  const type = clientType(data.clientType); const item = getItem(data.itemId);
  if(item.kind==='bridge')fail(400,'BRIDGE_DIRECT','브릿지 설정은 configUrl, 연결 파일은 전용 브릿지에서 생성해 주세요.',{bridgeUrl:item.bridgeUrl,configUrl:item.configUrl});
  const files = bundles[item.id];
  if(!files) fail(503,'BUNDLE_UNAVAILABLE','번들을 준비하지 못했습니다.');
  const logId = crypto.randomUUID(); const now = new Date().toISOString(); const info = requestInfo(context.request);
  // D1 batch is transactional: the log and its count either both commit or both roll back.
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO download_logs (log_id,item_id,item_kind,version,consent_id,user_identifier,client_type,ip_address,user_agent,downloaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(logId,item.id,item.kind,item.version,consent.consent_id,consent.user_identifier,type,info.ip,info.agent,now),
    context.env.DB.prepare(`INSERT INTO item_stats (item_id,item_kind,total_downloads,last_downloaded_at) VALUES (?,?,1,?) ON CONFLICT(item_id) DO UPDATE SET total_downloads=total_downloads+1,last_downloaded_at=excluded.last_downloaded_at,item_kind=excluded.item_kind`).bind(item.id,item.kind,now)
  ]);
  return json({ok:true,itemId:item.id,kind:item.kind,version:item.version,logId,downloadedAt:now,files});
}
