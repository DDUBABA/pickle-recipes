import {validateSite,sitePattern,bridgeUrls} from '../bridge/core.js';
import {sensitiveFindings} from './validation.js';
export const BRIDGE_MAX_BYTES=32768;
export function validateBridge(site,expectedId=site?.siteId) {
  const errors=[];
  try{validateSite(site,expectedId);}catch{errors.push('브릿지 JSON 스키마, URL 또는 참조 형식 오류');return errors;}
  const serialized=JSON.stringify(site);
  if(new TextEncoder().encode(serialized).length>BRIDGE_MAX_BYTES)errors.push('브릿지 JSON은 최대 32768바이트입니다.');
  function scan(value,key='') {
    if(typeof value==='string') {
      const text=value.normalize('NFKC');
      if(/[\p{Cf}\p{Cs}\u0000-\u001f]/u.test(text)||/<\/?[a-z!]|\b(?:javascript|data|vbscript):|\b(?:eval|Function)\s*\(|\bon\w+\s*=/iu.test(text))errors.push('코드·HTML 또는 숨은 문자는 허용되지 않습니다.');
      if(sensitiveFindings(text).length||/\bBearer\s+\S{8,}|\b(?:xox[baprs]-[\w-]{10,}|AIza[\w-]{30,})|\b[a-f0-9]{32,}\b/iu.test(text))errors.push('개인정보 또는 인증 정보가 포함되어 있습니다.');
      if(/^(?:password|passwd|token|accessToken|refreshToken|apiKey|secret|authorization)$/i.test(key))errors.push('인증 값은 상수가 아닌 필드·응답 참조여야 합니다.');
    } else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))scan(v,k);
  }
  scan(site);
  const expectedLegacy=`pickle-loginbridge--${site.siteId}.pages.dev`;
  const url=new URL(site.bridgeUrl);
  const canonical=`loginbridge--${site.siteId}.pickle-recipes.com`;
  if(![expectedLegacy,canonical].includes(url.hostname)||url.pathname!=='/'||url.port||[...url.searchParams].some(([k,v])=>k!=='download'||v!=='1')||url.searchParams.getAll('download').length!==1||url.searchParams.get('download')!=='1')errors.push('bridgeUrl은 해당 siteId의 전용 HTTPS 호스트와 단일 download=1 파라미터가 필요합니다.');
  return [...new Set(errors)];
}
export function bridgeSubmission(data) {
  const errors=[];
  const allowed=['type','changeType','siteId','baseVersion','files','summary','submittedBy','consentId','consentToken','termsVersion'];
  if(Object.keys(data).some(k=>!allowed.includes(k)))errors.push('브릿지에는 메타·코드·추가 필드를 보낼 수 없습니다.');
  if(typeof data.siteId!=='string'||!sitePattern.test(data.siteId)||data.siteId.length>43)return {errors:['유효한 siteId가 필요합니다.']};
  const file=`sites/${data.siteId}.json`;
  if(!data.files||Object.keys(data.files).length!==1||typeof data.files[file]!=='string')return {errors:['sites/<siteId>.json 단일 JSON 파일만 허용됩니다.']};
  if(new TextEncoder().encode(data.files[file]).length>BRIDGE_MAX_BYTES)return {errors:['브릿지 파일이 너무 큽니다.']};
  let site;try{site=JSON.parse(data.files[file]);}catch{return {errors:['유효한 JSON 파일이 필요합니다.']};}
  errors.push(...validateBridge(site,data.siteId));
  if(!['new','patch'].includes(data.changeType??'new'))errors.push('브릿지 changeType은 new 또는 patch입니다.');
  return {errors,site};
}
export function bridgeItem(site,record={}) {
  return {id:site.siteId,siteId:site.siteId,name:site.name,description:site.description,kind:'bridge',type:'bridge',status:'active',version:record.version||'1.0',createdAt:record.createdAt||'',updatedAt:record.updatedAt||'',releases:record.releases||[],category:'로그인 브릿지',authType:site.mode,keywords:[site.siteId,site.mode],tags:['bridge'],requires:[],parentId:null,relationType:null,author:'community',bridgeUrl:site.bridgeUrl,...bridgeUrls(site.bridgeUrl),configUrl:`/bridge/sites/${site.siteId}.json`,mode:site.mode};
}
