import {loadCatalog,statsMap,searchItems} from '../../lib/catalog.js';
import {json} from '../../lib/http.js';
export async function onRequestGet(context) {
  const catalog=await loadCatalog(context.env.DB);
  return json({ok:true,...searchItems(catalog.items,new URL(context.request.url).searchParams,await statsMap(context.env.DB)),termsVersion:catalog.termsVersion});
}
