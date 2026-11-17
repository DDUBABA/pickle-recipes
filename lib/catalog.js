import {catalog, bundles} from '../functions/_generated/catalog.js';
import {fail} from './http.js';
export {catalog, bundles};
export function getItem(id,type) {
  if(type&&!['connector','recipe','bridge'].includes(type))fail(400,'INVALID_KIND','종류를 확인해 주세요.');
  const item = catalog.items.find(item=>item.id === id&&(!type||item.kind===type));
  if (!item) fail(404,'ITEM_NOT_FOUND','항목을 찾을 수 없습니다.');
  if (item.status === 'blocked') fail(403,'ITEM_BLOCKED','이 항목은 이용이 차단되었습니다.');
  return item;
}
export async function statsMap(DB) {
  const {results} = await DB.prepare('SELECT item_id,total_downloads,last_downloaded_at FROM item_stats').all();
  return new Map(results.map(row=>[row.item_id,row]));
}
export const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
export function searchItems(items, params, stats = new Map()) {
  const q = normalize(params.get('q') || '');
  if(q.length>200) fail(400,'INVALID_QUERY','검색어는 200자 이내로 입력해 주세요.');
  const kind = params.get('type')||params.get('kind'); const sort = params.get('sort') || 'downloads';
  if(params.get('type')&&params.get('kind')&&params.get('type')!==params.get('kind'))fail(400,'INVALID_KIND','type과 kind가 일치해야 합니다.');
  if(kind && !['connector','recipe','bridge'].includes(kind)) fail(400,'INVALID_KIND','종류를 확인해 주세요.');
  if(!['downloads','latest','updated'].includes(sort)) fail(400,'INVALID_SORT','정렬 기준을 확인해 주세요.');
  const limit = Number(params.get('limit') || 30);
  if(!Number.isInteger(limit) || limit<1 || limit>100) fail(400,'INVALID_LIMIT','limit은 1~100입니다.');
  const ranked = items.filter(item=>item.status !== 'blocked' && (!kind || kind===item.kind) && (!params.get('category') || params.get('category') === item.category) && (!params.get('authType') || params.get('authType')===item.authType)).map(item=>{
    const fields = [[item.name,8],[item.service || '',7],[item.keywords.join(' '),6],[item.tags.join(' '),4],[item.description,2],[item.id,3]];
    const tokens = q.split(' ').filter(Boolean);
    const scores = tokens.map(token=>fields.reduce((n,[field,weight])=>n+(normalize(field).includes(token)?weight:0),0));
    const score = scores.every(n=>n>0) ? scores.reduce((a,b)=>a+b,0) : -1;
    return {...item,totalDownloads:stats.get(item.id)?.total_downloads || 0,score};
  }).filter(item=>!q || item.score>0);
  ranked.sort((a,b)=> (q ? b.score-a.score : 0) || (sort==='downloads' ? b.totalDownloads-a.totalDownloads : String(sort==='latest'?b.createdAt:b.updatedAt).localeCompare(String(sort==='latest'?a.createdAt:a.updatedAt))) || a.id.localeCompare(b.id));
  return {items:ranked.slice(0,limit),total:ranked.length,limit,sort};
}
