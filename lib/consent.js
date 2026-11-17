import {terms} from '../functions/_generated/catalog.js';
import {fail, bearer, constantEqual, sha256} from './http.js';
export {terms};
export async function authenticateConsent(context, input = {}) {
  const {request, env} = context;
  if (!env.DB) fail(503,'DB_UNAVAILABLE','동의 저장소가 연결되지 않았습니다.');
  const consentId = input.consentId ?? request.headers.get('X-Consent-Id');
  if (typeof consentId !== 'string' || !/^[a-f0-9-]{36}$/i.test(consentId) || !bearer(request)) fail(403,'CONSENT_REQUIRED','이용약관·면책 동의가 필요합니다.', {requiresConsent:true, termsVersion:terms.termsVersion});
  const row = await env.DB.prepare('SELECT * FROM consents WHERE consent_id = ?').bind(consentId).first();
  if (!row || !constantEqual(row.consent_token_hash, await sha256(bearer(request)))) fail(403,'CONSENT_INVALID','동의 정보가 유효하지 않습니다.', {requiresConsent:true});
  return row;
}
export async function verifyConsent(context,input={}) {
  const row=await authenticateConsent(context,input);
  const termsVersion=input.termsVersion??context.request.headers.get('X-Terms-Version');
  if(row.revoked_at)fail(403,'CONSENT_REVOKED','이용 동의가 철회되었습니다.',{requiresConsent:true});
  if(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now())fail(403,'TOKEN_EXPIRED','접근 토큰이 만료되었습니다. 이용 동의를 다시 확인해 주세요.',{requiresConsent:true});
  if (row.terms_version !== terms.termsVersion || termsVersion !== terms.termsVersion) fail(403,'TERMS_CHANGED','약관이 변경되었습니다. 이용을 중단하고 다시 동의해 주세요.', {requiresConsent:true, requiresReconsent:true, termsVersion:terms.termsVersion});
  return row;
}
