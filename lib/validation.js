export const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const VERSION = /^(0|[1-9]\d*)\.[0-9]$/;
export const SECTIONS = ['개요','필요한 커넥터','설정','실행','개인정보 보호','변경 이력'];
const REQUIRED = ['id','name','description','kind','status','version','parentId','relationType','requires','category','authType','keywords','author','tags','releases'];
export function validateMeta(meta, {submission=false} = {}) {
  const errors = [];
  if (!meta || typeof meta!=='object' || Array.isArray(meta)) return ['meta.json 객체가 필요합니다.'];
  for(const key of Object.keys(meta)) if(![...REQUIRED,'service','createdAt','updatedAt'].includes(key)) errors.push(`${key}: 허용되지 않은 메타 필드`);
  if(meta.service!==undefined && (typeof meta.service!=='string'||meta.service.length>100)) errors.push('service 형식 오류');
  for(const key of REQUIRED.filter(key=>!submission || !['version','releases'].includes(key))) if(!(key in meta)) errors.push(`${key}: 필수 필드`);
  if(!ID.test(meta.id || '') || meta.id.length>64) errors.push('id: 소문자 영문·숫자·하이픈, 최대 64자');
  for(const [key,max] of [['name',100],['description',500],['category',60],['authType',60],['author',100]]) if(typeof meta[key]!=='string'||!meta[key].trim()||meta[key].length>max||/[\u0000-\u001f]/u.test(meta[key])) errors.push(`${key}: 문자열 형식 오류`);
  if(!['connector','recipe'].includes(meta.kind)) errors.push('kind: connector 또는 recipe');
  if(!['active','deprecated','blocked'].includes(meta.status)) errors.push('status: active, deprecated, blocked');
  if(!submission && !VERSION.test(meta.version || '')) errors.push('version: major.minor (minor 한 자리)');
  if(submission && ('version' in meta || 'releases' in meta || 'createdAt' in meta || 'updatedAt' in meta)) errors.push('version/releases/createdAt/updatedAt는 서버가 결정합니다.');
  if(![null,'patch','remix','adapt'].includes(meta.relationType)) errors.push('relationType 형식 오류');
  if(meta.parentId !== null && (typeof meta.parentId!=='string'||!ID.test(meta.parentId)||meta.parentId.length>64)) errors.push('parentId 형식 오류');
  if((meta.parentId === null)!==(meta.relationType === null)) errors.push('parentId와 relationType을 함께 지정해야 합니다.');
  for(const key of ['requires','keywords','tags']) {
    if(!Array.isArray(meta[key])||meta[key].length>30||meta[key].some(v=>typeof v!=='string'||!v.trim()||v.length>100)||new Set(meta[key]).size!==meta[key].length) errors.push(`${key}: 중복 없는 문자열 배열, 최대 30개`);
  }
  if(Array.isArray(meta.requires) && meta.requires.some(id=>!ID.test(id)||id===meta.id)) errors.push('requires: 유효한 다른 커넥터 ID 필요');
  if(meta.kind==='connector' && meta.requires?.length) errors.push('connector의 requires는 빈 배열이어야 합니다.');
  if(meta.kind==='recipe' && !meta.requires?.length) errors.push('recipe는 최소 1개 커넥터가 필요합니다.');
  if(!submission) {
    if(!Array.isArray(meta.releases)) errors.push('releases: 배열 필요');
    else for(const release of meta.releases) {
      if(!release || !VERSION.test(release.version||'') || !(release.baseVersion===null||VERSION.test(release.baseVersion||'')) || !/^\d{4}-\d{2}-\d{2}T/.test(release.date||'') || !Number.isFinite(Date.parse(release.date)) || !['new','patch','remix','adapt'].includes(release.type) || typeof release.summary!=='string' || !release.summary || typeof release.submittedBy!=='string' || !release.submittedBy || !(release.prNumber===null || Number.isSafeInteger(release.prNumber)&&release.prNumber>0)) errors.push('releases: 이력 형식 오류');
    }
  }
  return errors;
}
export function sensitiveFindings(text) {
  const rules = [
    ['이메일',/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u],
    ['전화번호',/(?:\+82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}|\b0(?:2|[3-6]\d)[- .]\d{3,4}[- .]\d{4}\b/u],
    ['주민등록번호',/\b\d{6}[- ]?[1-8]\d{6}\b/u],
    ['차량번호',/(?:\d{2,3}[가-힣]\s?\d{4})/u],
    ['동호수',/\d{1,4}\s*동\s*\d{1,4}\s*호|\d{2,4}\s*호(?:실)?/u],
    ['접근 토큰',/(?:gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u],
    ['하드코딩 비밀값',/(?:api[_-]?key|token|password|secret|authorization)\s*["']?\s*[:=]\s*["'][^"'\s]{8,}["']/iu],
    ['개인 경로',/(?:C:\\Users\\(?!PUBLIC\b)[^\\\s]+|\/Users\/[A-Za-z0-9_-]+|\/home\/[A-Za-z0-9_-]+)/u]
  ];
  return rules.filter(([,regex])=>regex.test(text)).map(([label])=>label);
}
export function dangerousFindings(code) {
  const rules = [
    ['동적 실행',/\b(?:eval|exec|compile|__import__)\b/u],
    ['셸·프로세스 실행',/\b(?:subprocess|system|popen|spawn|fork|pty|ctypes|multiprocessing)\b|shell\s*=\s*True/u],
    ['동적 속성·역직렬화',/\b(?:getattr|setattr|globals|locals|vars)\b|\b(?:from|import)\s+(?:importlib|pickle|marshal|base64|codecs)\b|__builtins__|__subclasses__|__globals__/u],
    ['난독화',/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\bchr\s*\(/u],
    ['셸 인젝션 표현',/\$\(|`[^`]+`|\bcurl\b.+\|\s*(?:sh|bash)|\brm\s+-rf/u]
  ];
  return rules.filter(([,regex])=>regex.test(code)).map(([label])=>label);
}
export function validateFiles(files) {
  const errors=[];
  if(!files||typeof files!=='object'||Array.isArray(files)) return ['files 객체가 필요합니다.'];
  const paths=Object.keys(files);
  if(paths.length>22 || !paths.includes('README.md') || !paths.some(path=>/^scripts\/[a-z][a-z0-9_]*\.py$/.test(path))) errors.push('README.md와 scripts/*.py가 필요하며 최대 22개 파일입니다.');
  for(const [path,content] of Object.entries(files)) {
    if(path!=='README.md' && !/^scripts\/[a-z][a-z0-9_]*\.py$/.test(path)) errors.push(`${path}: 허용되지 않은 파일 경로`);
    if(typeof content!=='string'||!content||new TextEncoder().encode(content).length>65536) { errors.push(`${path}: 1~65536바이트 텍스트 필요`); continue; }
    for(const finding of sensitiveFindings(content)) errors.push(`${path}: ${finding} 의심`);
    if(path.endsWith('.py')) for(const finding of dangerousFindings(content)) errors.push(`${path}: ${finding} 금지`);
  }
  if(typeof files['README.md']==='string') for(const section of SECTIONS) if(!new RegExp(`^## ${section}\\s*$`,'m').test(files['README.md'])) errors.push(`README.md: ## ${section} 섹션 필요`);
  return errors;
}
export function validateDependencies(meta, items) {
  return (meta.requires || []).filter(id=>!items.some(item=>item.id===id&&item.kind==='connector'&&item.status!=='blocked')).map(id=>`requires: 이용 가능한 커넥터가 아닙니다 (${id})`);
}
export function nextVersion(version) {
  if(!VERSION.test(version)) throw new Error('Invalid version');
  const [major,minor]=version.split('.').map(Number);
  return `${major+(minor===9?1:0)}.${(minor+1)%10}`;
}
