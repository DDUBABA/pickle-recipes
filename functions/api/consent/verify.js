import {verifyConsent,terms} from '../../../lib/consent.js';
import {json} from '../../../lib/http.js';
export async function onRequestGet(context) {
  const params = new URL(context.request.url).searchParams;
  const row = await verifyConsent(context,{consentId:params.get('consentId') ?? undefined,termsVersion:params.get('termsVersion') ?? undefined});
  return json({ok:true,valid:true,requiresReconsent:false,termsVersion:terms.termsVersion,agreedAt:row.agreed_at,expiresAt:row.expires_at,autoUploadAllowed:!!row.auto_upload_allowed});
}
