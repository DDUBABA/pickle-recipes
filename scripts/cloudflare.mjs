// Credentials are supplied by the caller; never log API request headers.
export function cloudflareClient({token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID,fetcher=fetch}={}) {
  if(!token||!account)throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  return async (route,{method='GET',body}={})=>{
    const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)
    });
    const result=await response.json();
    if(!response.ok||!result.success)throw new Error(`Cloudflare ${response.status}: ${(result.errors||[]).map(e=>e.code).join(',')}`);
    return result.result;
  };
}
export function d1Client(api,database) {
  if(!database)throw new Error('CLOUDFLARE_D1_DATABASE_ID is required');
  return async batch=>{
    const results=await api(`/d1/database/${database}/query`,{method:'POST',body:{batch}});
    if(!Array.isArray(results)||results.length!==batch.length||results.some(r=>!r.success))throw new Error('D1 batch failed');
    return results;
  };
}
