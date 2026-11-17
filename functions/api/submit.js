import {body,fail,json,textField} from '../../lib/http.js';
import {verifyConsent} from '../../lib/consent.js';
import {catalog,normalize} from '../../lib/catalog.js';
import {validateMeta,validateFiles,validateDependencies,sensitiveFindings,VERSION} from '../../lib/validation.js';
import {openSubmission} from '../../lib/github.js';
export async function onRequestPost(context) {
  const data=await body(context.request);
  const consent=await verifyConsent(context,data);
  if(!consent.auto_upload_allowed) fail(403,'UPLOAD_CONSENT_REQUIRED','개인정보 제거 후 공개 자동 업로드에 대한 사전 동의가 필요합니다.');
  const submittedBy=textField(data.submittedBy,'submittedBy');
  if(!/^[a-zA-Z0-9가-힣_-]{1,60}$/u.test(submittedBy)) fail(400,'INVALID_HANDLE','submittedBy에는 연락처 대신 공개용 별칭을 사용해 주세요.');
  const summary=textField(data.summary,'summary',1000);
  if(!['new','patch','remix','adapt'].includes(data.type)) fail(400,'INVALID_TYPE','type은 new, patch, remix, adapt입니다.');
  if(data.type==='new' ? data.baseVersion!==null : !VERSION.test(data.baseVersion || '')) fail(400,'INVALID_BASE_VERSION','신규는 baseVersion:null, 나머지는 기준 버전이 필요합니다.');
  if('version' in data) fail(400,'SERVER_MANAGED_VERSION','새 버전은 서버가 결정합니다.');
  const errors=[...validateMeta(data.meta,{submission:true}),...validateFiles(data.files),...sensitiveFindings(JSON.stringify(data.meta||{})).map(x=>`meta: ${x} 의심`),...sensitiveFindings(summary).map(x=>`summary: ${x} 의심`)];
  if(errors.length) fail(400,'VALIDATION_FAILED','규격 또는 보안 검사를 통과하지 못했습니다.',{errors});
  errors.push(...validateDependencies(data.meta,catalog.items));
  const current=catalog.items.find(item=>item.id===data.meta.id);
  if(data.meta.status==='blocked') errors.push('제출자는 항목을 blocked 상태로 생성할 수 없습니다.');
  if(data.type==='new') {
    if(data.meta.parentId!==null||data.meta.relationType!==null) errors.push('신규 항목에는 parentId/relationType이 없어야 합니다.');
    if(current||catalog.items.some(item=>normalize(item.name)===normalize(data.meta.name))) fail(409,'DUPLICATE_ITEM','동일한 항목이 있습니다. 재사용하거나 패치해 주세요.');
  } else {
    const parent=data.type==='patch'?current:catalog.items.find(item=>item.id===data.meta.parentId);
    if(!parent||parent.status==='blocked'||parent.version!==data.baseVersion) fail(409,'VERSION_CONFLICT','기준 항목의 최신 버전을 다시 조회해 주세요.');
    if(data.type==='patch') {
      if(data.meta.parentId!==current.parentId||data.meta.relationType!==current.relationType) errors.push('패치는 기존 계보를 보존해야 합니다.');
    } else if(current||data.meta.id===data.meta.parentId||data.meta.relationType!==data.type) errors.push('이식·리믹스는 새로운 ID와 일치하는 parentId/relationType이 필요합니다.');
  }
  if(errors.length) fail(400,'VALIDATION_FAILED','항목 관계를 확인해 주세요.',{errors});
  const result=await openSubmission(context.env,{...data,submittedBy,summary});
  return json({ok:true,...result,message:'PR이 접수되었습니다. 병합 후 버전이 확정됩니다.'},201);
}
