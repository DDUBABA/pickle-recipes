const origin='https://pickle-recipes.pages.dev';
const idPattern='[a-z0-9]+(?:-[a-z0-9]+)+';
function denied(status=404){return new Response('Login bridge unavailable',{status,headers:{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export async function routeBridge(request,fetcher=fetch) {
  const url=new URL(request.url);
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
  if(url.protocol!=='https:')return denied(400);
  const siteId=new RegExp(`^(${idPattern})\\.login\\.pickle-recipes\\.com$`).exec(url.hostname)?.[1]||new RegExp(`^pickle-loginbridge--(${idPattern})\\.pages\\.dev$`).exec(url.hostname)?.[1];
  const directory=url.hostname==='pickle-loginbridge.pages.dev';
  if(!directory&&(!siteId||siteId.length>43))return denied();
  let file=url.pathname.replace(/^\/bridge(?=\/)/,'');
  if(file==='/')file='/index.html';
  const assetSite=/^\/sites\/([a-z0-9]+(?:-[a-z0-9]+)+)\.json$/.exec(file)?.[1];
  if(!['/index.html','/app.js','/core.js','/style.css','/hosts.json','/index.json',`/sites/${siteId}.json`].includes(file)&&!(directory&&assetSite))return denied();
  // Forward only fixed public asset URLs, never cookies, query strings, credentials or request bodies.
  try{
    const indexResponse=await fetcher(origin+'/bridge/index.json',{redirect:'error',headers:{Accept:'application/json'}});
    if(!indexResponse.ok)return denied(503);
    const index=await indexResponse.json();
    if(!directory&&!index.items?.some(item=>item.id===siteId&&item.kind==='bridge'))return denied();
    if(assetSite&&!index.items?.some(item=>item.id===assetSite&&item.kind==='bridge'))return denied();
    const upstream=await fetcher(origin+'/bridge'+(file==='/index.html'?'/':file),{method:request.method,redirect:'error'});
    if(!upstream.ok)return denied(upstream.status===404?404:503);
    const response=new Response(upstream.body,upstream);
    response.headers.delete('Set-Cookie');response.headers.delete('Access-Control-Allow-Origin');
    response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');response.headers.set('X-Content-Type-Options','nosniff');
    return response;
  }catch{return denied(503);}
}
export default {fetch:request=>routeBridge(request)};
