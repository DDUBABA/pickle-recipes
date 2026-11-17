import {body, json, fail, textField, clientType, requestInfo, sha256} from '../../lib/http.js';
import {terms} from '../../lib/consent.js';
export async function onRequestPost({request,env}) {
  const data = await body(request,8192);
  if (data.agreed !== true) fail(400,'AGREEMENT_REQUIRED','명시적인 사용자 동의가 필요합니다.');
  if (data.termsVersion !== terms.termsVersion) fail(409,'TERMS_CHANGED','최신 약관을 확인하고 다시 동의해 주세요.', {termsVersion:terms.termsVersion,requiresReconsent:true});
  const user = textField(data.userIdentifier,'userIdentifier');
  const name = textField(data.displayName,'displayName',100,true);
  const type = clientType(data.clientType);
  if (data.autoUploadAllowed !== undefined && typeof data.autoUploadAllowed !== 'boolean') fail(400,'INVALID_FIELD','autoUploadAllowed는 boolean이어야 합니다.');
  if (!env.DB) fail(503,'DB_UNAVAILABLE','동의 저장소가 연결되지 않았습니다.');
  const consentId = crypto.randomUUID();
  const consentToken = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date().toISOString(); const info = requestInfo(request);
  await env.DB.prepare(`INSERT INTO consents (consent_id,terms_version,agreed_at,user_identifier,display_name,client_type,ip_address,user_agent,created_at,consent_token_hash,auto_upload_allowed) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(consentId,terms.termsVersion,now,user,name,type,info.ip,info.agent,now,await sha256(consentToken),data.autoUploadAllowed === true ? 1 : 0).run();
  return json({ok:true,consentId,consentToken,termsVersion:terms.termsVersion,agreedAt:now,autoUploadAllowed:data.autoUploadAllowed === true},201);
}
