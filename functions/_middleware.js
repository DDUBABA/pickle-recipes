import {storedFile} from '../lib/catalog-store.js';

const documents=new Set(['recipes/index.json','bridge/index.json','bridge/hosts.json','hosts.json']);
const configPath=/^bridge\/sites\/[a-z0-9]+(?:-[a-z0-9]+)+\.json$/;
function response(body,status=200,contentType='application/json; charset=utf-8') {
  return new Response(body,{status,headers:{'Content-Type':contentType,'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
}
export async function onRequest(context) {
  const path=new URL(context.request.url).pathname.slice(1);
  const html=['bridge/','bridge/index.html'].includes(path);
  if(!html&&!documents.has(path)&&!configPath.test(path))return context.next();
  if(!['GET','HEAD'].includes(context.request.method)){
    const result=response(null,405);result.headers.set('Allow','GET, HEAD');return result;
  }
  const head=context.request.method==='HEAD';
  try {
    const stored=await storedFile(context.env.DB,html?'bridge/policy.json':path);
    if(!stored.ready){
      const upstream=await context.next();
      const fallback=new Response(head?null:upstream.body,upstream);
      fallback.headers.set('Cache-Control','no-store');
      return fallback;
    }
    if(stored.content==null)return response(head?null:'{"error":"NOT_FOUND"}',404);
    if(!html)return response(head?null:stored.content,200,stored.contentType);
    const origins=JSON.parse(stored.content).origins;
    // Policy is generated only from reviewed, schema-validated bridge JSON.
    if(!Array.isArray(origins)||origins.some(origin=>new URL(origin).origin!==origin||!origin.startsWith('https://')))throw new Error('Invalid policy');
    const policy=`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'${origins.length?' '+origins.join(' '):''}; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'`;
    const upstream=await context.next();
    if(!upstream.ok)return upstream;
    const headers=new Headers(upstream.headers);
    for(const name of ['ETag','Content-Length','Content-Encoding','Last-Modified'])headers.delete(name);
    headers.set('Content-Security-Policy',policy);headers.set('Cache-Control','no-store');
    // A static meta CSP would intersect with the new header and block new APIs.
    const htmlBody=head?null:(await upstream.text()).replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i,'');
    return new Response(htmlBody,{status:upstream.status,headers});
  } catch {
    return response(head?null:'{"error":"CATALOG_UNAVAILABLE"}',503);
  }
}
