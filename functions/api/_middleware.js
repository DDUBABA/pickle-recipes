import {ApiError, json} from '../../lib/http.js';
import {enforceHost,rateLimit,secureResponse} from '../../lib/security.js';
export async function onRequest(context) {
  let response;
  try {
    enforceHost(context);
    const origin = context.request.headers.get('Origin');
    if (origin && origin !== new URL(context.request.url).origin) throw new ApiError(403,'ORIGIN_DENIED','다른 웹사이트의 요청은 허용하지 않습니다.');
    if (context.request.method === 'OPTIONS') response=new Response(null, {status:204,headers:{Allow:'GET, POST, OPTIONS'}});
    else {
      await rateLimit(context);
      response=await context.next();
      if(response.status===405||response.status===404)response=json({ok:false,code:'NOT_FOUND_OR_METHOD',message:'API 경로와 HTTP 메서드를 확인해 주세요.'},response.status);
    }
  } catch(error) {
    if (error instanceof ApiError) {
      response=json({ok:false,code:error.code,message:error.message,...error.extra},error.status);
      if(error.status===429)response.headers.set('Retry-After',String(error.extra.retryAfter));
    } else {
      // Even exception names can contain upstream/user data. Log no raw exception fields.
      console.error('API failure', 'SERVICE_UNAVAILABLE');
      response=json({ok:false,code:'SERVICE_UNAVAILABLE',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);
    }
  }
  return secureResponse(response);
}
