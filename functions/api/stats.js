import {bearer,constantEqual,fail,json} from '../../lib/http.js';
export function csv(rows) {
  const keys = Object.keys(rows[0] || {item_id:'',total_downloads:0});
  const escape = value => '"'+String(value ?? '').replace(/^[=+@\-\t\r]/u,"'$&").replaceAll('"','""')+'"';
  return '\uFEFF'+[keys,...rows.map(row=>keys.map(key=>row[key]))].map(row=>row.map(escape).join(',')).join('\r\n');
}
export async function onRequestGet(context) {
  const {request,env} = context; const params = new URL(request.url).searchParams;
  const group = params.get('group') || 'items'; const format=params.get('format') || 'json';
  if(!['items','daily','versions','users'].includes(group) || !['json','csv'].includes(format)) fail(400,'INVALID_QUERY','group 또는 format을 확인해 주세요.');
  const admin = !!env.ADMIN_STATS_TOKEN && constantEqual(bearer(request),env.ADMIN_STATS_TOKEN);
  // An unset admin token never exposes person-level analytics.
  if(group!=='items' && !admin) fail(403,'ADMIN_REQUIRED','관리자 토큰이 필요합니다.');
  const limit=Number(params.get('limit') || 100);
  const offset=Number(params.get('offset') || 0);
  if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(offset)||offset<0) fail(400,'INVALID_LIMIT','페이지 범위를 확인해 주세요.');
  const queries = {
    items:'SELECT item_id,item_kind,total_downloads,last_downloaded_at FROM item_stats ORDER BY total_downloads DESC,item_id LIMIT ? OFFSET ?',
    daily:"SELECT substr(downloaded_at,1,10) AS date,item_id,COUNT(*) AS total_downloads FROM download_logs GROUP BY date,item_id ORDER BY date DESC,item_id LIMIT ? OFFSET ?",
    versions:'SELECT item_id,version,COUNT(*) AS total_downloads FROM download_logs GROUP BY item_id,version ORDER BY item_id,version LIMIT ? OFFSET ?',
    users:'SELECT user_identifier,item_id,COUNT(*) AS total_downloads,MAX(downloaded_at) AS last_downloaded_at FROM download_logs GROUP BY user_identifier,item_id ORDER BY total_downloads DESC,user_identifier,item_id LIMIT ? OFFSET ?'
  };
  const {results}=await env.DB.prepare(queries[group]).bind(limit,offset).all();
  if(format==='csv') return new Response(csv(results),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="pickle-${group}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return json({ok:true,group,rows:results,limit,offset,nextOffset:results.length===limit ? offset+limit : null});
}
