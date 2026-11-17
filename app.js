const $ = selector => document.querySelector(selector);
const state = {kind:'',consent:null,terms:null,catalog:null,limit:30,request:0};
const STORE='pickle-recipes-consent';
try { state.consent=JSON.parse(localStorage.getItem(STORE)); } catch { localStorage.removeItem(STORE); }
const el=(tag,text,className)=>{const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node;};
let toastTimer, searchTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function headers(){return state.consent?{'Authorization':`Bearer ${state.consent.consentToken}`,'X-Consent-Id':state.consent.consentId,'X-Terms-Version':state.consent.termsVersion}:{};}
function clearConnection(){state.consent=null;state.request++;localStorage.removeItem(STORE);$('#disconnect').hidden=true;$('#connect-top').textContent='피클과 시작하기 ↗';if($('#detail-dialog').open)$('#detail-dialog').close();renderEmpty('연결이 필요해요.','약관과 기록 수집 안내를 확인한 후 시작하세요.',true);}
async function api(path,options={}){
  const response=await fetch(path,{cache:'no-store',...options,headers:{...headers(),...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  let result;try{result=await response.json();}catch{throw new Error('서버 응답을 읽지 못했습니다. 연결 상태를 확인해 주세요.');}
  if(!response.ok){if(result.requiresConsent||result.requiresReconsent){clearConnection();await openConsent(result.message);}throw new Error(result.message||'요청을 완료하지 못했습니다.');}
  return result;
}
async function latestTerms(){const response=await fetch('/terms.json',{cache:'no-store'});if(!response.ok)throw new Error('최신 약관을 불러오지 못했습니다.');state.terms=await response.json();return state.terms;}
async function ensureConsent(){
  await latestTerms();
  if(!state.consent){await openConsent();return false;}
  if(state.consent.termsVersion!==state.terms.termsVersion){clearConnection();await openConsent('약관이 변경되었습니다. 내용을 확인하고 다시 동의해 주세요.');return false;}
  await api('/api/consent/verify');return true;
}
async function openConsent(reason){
  try{await latestTerms();$('#consent-error').textContent='';$('#terms-version').textContent=`약관 버전 ${state.terms.termsVersion}`;$('#consent-reason').textContent=reason||'별도 계정 없이 연결합니다. 동의와 다운로드 기록은 서버에 저장됩니다.';$('#agree').checked=false;$('#auto-upload').checked=false;if(!$('#consent-dialog').open)$('#consent-dialog').showModal();}
  catch(error){toast(error.message);}
}
function renderEmpty(title,description,connect=false){
  const box=el('div',undefined,'empty-state');box.append(el('div','↗','empty-icon'),el('h3',title),el('p',description));
  if(connect){const button=el('button','안내 확인하고 시작하기','primary');button.onclick=()=>openConsent();box.append(button);}else{const link=el('a','피클 표준 가이드 보기 ↗','outline');link.href='/guide.md';box.append(link);}
  $('#catalog').replaceChildren(box);$('#more').hidden=true;
}
function renderCards(items){
  $('#catalog').replaceChildren(...items.map(item=>{
    const card=el('article',undefined,'card');const top=el('div',undefined,'card-top');
    top.append(el('span',item.kind==='connector'?'↗ 커넥터':'≋ 레시피',`badge ${item.kind}`),el('span',`v${item.version}`,'version'));
    const tags=el('div',undefined,'tags');tags.append(...item.tags.slice(0,4).map(tag=>el('span',`#${tag}`)));
    const bottom=el('div',undefined,'card-bottom');const detail=el('button','자세히 보기 ↗');detail.onclick=()=>showDetail(item.id);
    bottom.append(el('span',`⬇ 총 다운로드 ${item.totalDownloads.toLocaleString('ko-KR')}`),detail);
    card.append(top,el('h3',item.name),el('p',item.description),tags);
    if(item.status==='deprecated')card.append(el('span','지원 종료 예정 · 대체 항목을 확인하세요','badge'));
    card.append(bottom);return card;
  }));
}
async function search({verify=true}={}){
  try{
    if(verify && !await ensureConsent())return;
    const revision=++state.request;$('#catalog').setAttribute('aria-busy','true');
    const params=new URLSearchParams({q:$('#search').value,kind:state.kind,category:$('#category').value,authType:$('#auth').value,sort:$('#sort').value,limit:state.limit});
    const result=await api(`/api/search?${params}`);if(revision!==state.request)return;
    $('#result-count').textContent=`${result.total.toLocaleString('ko-KR')}개의 자동화 · ${result.items.length}개 표시`;
    if(!result.items.length)renderEmpty(result.total===0&&!$('#search').value&&!state.kind&&!$('#category').value&&!$('#auth').value?'첫 번째 자동화를 기다리고 있어요.':'검색 결과가 없어요.','다른 검색어나 필터를 사용해 보세요. 새 자동화는 피클을 통해 공유할 수 있어요.');
    else renderCards(result.items);
    $('#more').hidden=result.items.length>=result.total||state.limit>=100;
  }catch(error){toast(error.message);if(state.consent)renderEmpty('지금은 목록을 불러올 수 없어요.',error.message);}
  finally{$('#catalog').setAttribute('aria-busy','false');}
}
async function showDetail(id){
  try{
    if(!await ensureConsent())return;
    const {item}=await api(`/api/items/${encodeURIComponent(id)}`);const content=$('#detail-content');content.replaceChildren();
    const title=el('h2',item.name);title.id='detail-name';
    content.append(el('p',item.kind==='connector'?'CONNECTOR':'RECIPE','eyebrow'),title,el('p',item.description,'detail-description'),el('p',`v${item.version} · ${item.category} · ${item.authType} · ⬇ ${item.totalDownloads.toLocaleString('ko-KR')}`,'detail-meta'));
    if(item.status==='deprecated')content.append(el('p','지원 종료 예정인 항목입니다. 대체 항목을 우선 확인하세요.','form-error'));
    if(item.requires.length){content.append(el('h3','필요한 커넥터'));const list=el('div',undefined,'tags');for(const dependency of item.requires){const button=el('button',dependency,'outline');button.onclick=()=>showDetail(dependency);list.append(button);}content.append(list);}
    content.append(el('h3','버전별 릴리즈 노트'));const timeline=el('div',undefined,'timeline');
    if(!item.releases.length)timeline.append(el('p','아직 공개된 릴리즈 이력이 없습니다.','muted'));
    for(const release of item.releases){const row=el('article',undefined,'release');row.append(el('strong',`v${release.version}${release.baseVersion?` ← v${release.baseVersion}`:''} · ${release.submittedBy}`));if(release.prNumber){const link=el('a',` · PR #${release.prNumber}`);link.href=`https://github.com/jkc1832/pickle-recipes/pull/${release.prNumber}`;link.target='_blank';link.rel='noopener';row.append(link);}row.append(el('p',`${new Date(release.date).toLocaleDateString('ko-KR')} · ${release.summary}`));timeline.append(row);}
    content.append(timeline);const readme=el('details');readme.append(el('summary','실행 안내와 설정 보기'),el('pre',item.readme,'readme'));content.append(readme);
    const download=el('button','동의 확인 후 JSON 번들 다운로드 ↓','primary detail-download');download.onclick=async()=>{download.disabled=true;try{await downloadItem(item);}finally{download.disabled=false;}};content.append(download);
    if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
  }catch(error){toast(error.message);}
}
async function downloadItem(item){
  try{
    if(!await ensureConsent())return;
    const bundle=await api('/api/download',{method:'POST',body:JSON.stringify({itemId:item.id,consentId:state.consent.consentId,termsVersion:state.consent.termsVersion,clientType:'web'})});
    const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const link=el('a');link.href=url;link.download=`${item.id}-v${bundle.version}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('번들을 내려받았습니다. 피클에게 설치를 요청하세요.');await search({verify:false});
  }catch(error){toast(error.message);}
}
$('#consent-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#consent-submit');button.disabled=true;$('#consent-error').textContent='';
  const shownVersion=state.terms?.termsVersion;
  try{
    await latestTerms();if(shownVersion!==state.terms.termsVersion){await openConsent('확인하는 동안 약관이 변경되었습니다. 다시 읽고 동의해 주세요.');return;}
    const result=await api('/api/consent',{method:'POST',headers:{},body:JSON.stringify({termsVersion:shownVersion,agreed:$('#agree').checked,userIdentifier:$('#user-identifier').value.trim(),displayName:$('#display-name').value.trim(),clientType:'web',autoUploadAllowed:$('#auto-upload').checked})});
    state.consent={consentId:result.consentId,consentToken:result.consentToken,termsVersion:result.termsVersion,agreedAt:result.agreedAt,autoUploadAllowed:result.autoUploadAllowed};
    try{localStorage.setItem(STORE,JSON.stringify(state.consent));}catch{toast('브라우저 저장이 제한되어 이번 방문에서만 동의가 유지됩니다.');}
    $('#consent-dialog').close();$('#disconnect').hidden=false;$('#connect-top').textContent='연결 안내 ↗';await search({verify:false});
  }catch(error){$('#consent-error').textContent=error.message;}finally{button.disabled=false;}
});
$('#connect-top').onclick=()=>openConsent();$('#start-search').onclick=()=>openConsent();
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());
$('#disconnect').onclick=()=>{clearConnection();toast('로컬 연결 정보를 지웠습니다. 기존 서버 기록은 보존됩니다.');};
$('#search-form').onsubmit=event=>{event.preventDefault();clearTimeout(searchTimer);state.limit=30;search();};
$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);if(state.consent)searchTimer=setTimeout(()=>{state.limit=30;search();},300);});
document.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{state.kind=button.dataset.kind;state.limit=30;document.querySelectorAll('[data-kind]').forEach(tab=>{tab.classList.toggle('selected',tab===button);tab.setAttribute('aria-pressed',String(tab===button));});search();});
for(const selector of ['#category','#auth','#sort'])$(selector).onchange=()=>{state.limit=30;search();};
$('#more').onclick=()=>{state.limit=Math.min(100,state.limit+30);search();};
$('#copy-address').onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/`);toast('주소를 복사했습니다. 피클에게 붙여넣어 주세요.');}catch{toast(`피클에게 이 주소를 알려주세요: ${location.origin}/`);}};
async function checkVersion(){if(!state.consent)return;try{await ensureConsent();}catch(error){clearConnection();toast(error.message);}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkVersion();});
setInterval(()=>{if(!document.hidden)checkVersion();},60000);
window.addEventListener('storage',event=>{if(event.key===STORE){try{state.consent=JSON.parse(event.newValue);}catch{state.consent=null;}if(state.consent)search();else clearConnection();}});
async function init(){
  try{
    const response=await fetch('/recipes/index.json',{cache:'no-store'});if(!response.ok)throw new Error('카탈로그 정보를 불러오지 못했습니다.');state.catalog=await response.json();
    for(const [selector,key]of [['#category','category'],['#auth','authType']])for(const value of [...new Set(state.catalog.items.filter(item=>item.status!=='blocked').map(item=>item[key]))].sort()){const option=el('option',value==='none'?'인증 불필요':value);option.value=value;$(selector).append(option);}
    if(state.consent){$('#disconnect').hidden=false;$('#connect-top').textContent='연결 안내 ↗';await search();}
  }catch(error){toast(error.message);}
}
init();
