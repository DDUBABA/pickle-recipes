import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest} from '../functions/api/_middleware.js';
export class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));}
  prepare(sql){const statement=this.db.prepare(sql);const wrapper={values:[],bind(...values){this.values=values;return this;},async first(){return statement.get(...this.values)||null;},async all(){return {results:statement.all(...this.values)};},async run(){return statement.run(...this.values);}};return wrapper;}
  async batch(statements){this.db.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
export function request(path,options={}){return new Request(`https://test.local${path}`,options);}
export async function call(handler,request,env,params={}){const context={request,env,params};return onRequest({...context,next:()=>handler(context)});}
export const payload=(value,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
export function credentials(consent){return {Authorization:`Bearer ${consent.consentToken}`,'X-Consent-Id':consent.consentId,'X-Terms-Version':consent.termsVersion};}
export const meta={id:'sample-service',name:'예시 조회',description:'예시 서비스 현황을 조회합니다.',kind:'connector',status:'active',version:'1.0',parentId:null,relationType:null,requires:[],category:'생활',authType:'none',keywords:['일정 확인','할 일'],author:'test-alias',tags:['업무'],service:'Sample',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',releases:[{version:'1.0',baseVersion:null,date:'2026-11-01T00:00:00Z',type:'new',summary:'첫 배포',submittedBy:'test-alias',prNumber:1}]};
export const files={'README.md':'# 예시\n\n## 개요\n작업 조회\n## 필요한 커넥터\n없음\n## 설정\n로컬 프로필\n## 실행\n--json\n## 개인정보 보호\n비밀 없음\n## 변경 이력\n자동 기록\n','scripts/service.py':'import json\nprint(json.dumps({"ok": True}))\n'};
