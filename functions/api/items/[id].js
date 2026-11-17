import {loadItem} from '../../../lib/catalog.js';
import {json} from '../../../lib/http.js';
export async function onRequestGet(context) {
  const {item,files} = await loadItem(context.env.DB,context.params.id,new URL(context.request.url).searchParams.get('type'));
  if(item.kind==='bridge')return json({ok:true,item:{...item,totalDownloads:0,config:JSON.parse(files[`sites/${item.id}.json`])}});
  const stats = await context.env.DB.prepare('SELECT total_downloads FROM item_stats WHERE item_id = ?').bind(item.id).first();
  return json({ok:true,item:{...item,totalDownloads:stats?.total_downloads || 0,readme:files['README.md']}});
}
