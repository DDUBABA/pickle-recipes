import {fail,textField} from './http.js';
import {sensitiveFindings} from './validation.js';

export const FEEDBACK_CATEGORIES=['bug','suggestion','question','other'];
export const FEEDBACK_MAX_BYTES=24*1024;

export function validateFeedback(data){
  if(Object.keys(data).some(key=>!['category','title','content','submittedBy'].includes(key)))
    fail(400,'INVALID_FIELD','category, title, content, submittedBy만 보낼 수 있습니다.');
  if(!FEEDBACK_CATEGORIES.includes(data.category))
    fail(400,'INVALID_CATEGORY','category는 bug, suggestion, question, other 중 하나입니다.');
  const title=textField(data.title,'title',120);
  if(typeof data.content!=='string'||!data.content.trim()||data.content.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(data.content))
    fail(400,'INVALID_FIELD','content는 1~5000자 텍스트여야 합니다.');
  const submittedBy=textField(data.submittedBy,'submittedBy',60,true);
  const fields=[title,data.content,submittedBy||''];
  // Scan the decoded JSON strings, including compatibility characters. Never
  // return or log the matched value. This is pattern filtering, not a guarantee.
  for(const value of fields){
    const normalized=value.normalize('NFKC');
    if(/[\p{Cf}\p{Cs}]/u.test(value)||sensitiveFindings(normalized).length||
      /\bBearer\s+\S{8,}|(?:api[_-]?key|token|password|secret|authorization)\s*["']?\s*[:=]\s*["']?[^\s"']{8,}|\b(?:xox[baprs]-[\w-]{10,}|AIza[\w-]{30,})|\b[a-f0-9]{32,}\b|\b(?=[A-Za-z0-9_-]{40,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}\b/iu.test(normalized))
      fail(400,'SENSITIVE_DATA','개인정보·인증 정보로 보이는 내용이 있습니다. 이메일, 전화번호, 주소, 토큰 등을 제거해 주세요.');
  }
  if(submittedBy&&!/^[a-zA-Z0-9가-힣_-]{1,60}$/u.test(submittedBy))
    fail(400,'INVALID_HANDLE','submittedBy에는 연락처 대신 영문·한글·숫자·밑줄·하이픈으로 된 임의 별칭을 사용해 주세요.');
  return {category:data.category,title,content:data.content.trim(),submittedBy};
}
