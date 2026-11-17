# 로그인 브릿지 운영

현재 데이터 게시·CSP 갱신·Actions 배포 정책은 [D1 카탈로그 운영](catalog-d1.md)을 따른다. 아래의 정적 빌드 설명은 최초 정적 폴백 생성에도 사용되지만, 설정 JSON 변경은 D1 동기화만으로 반영하며 Pages 전체 빌드를 요구하지 않는다.

`DDUBABA/pickle-loginbridge`의 `a199b70ff5801c329bbcaf8a8eb6d3778514b021`에서 공통 엔진과 3개 공통 사이트 JSON을 가져왔다. 이 저장소의 `bridge/`가 이후 기준이다. `/bridge/sites/_schema.json`과 서버·CI 의미 검증을 함께 사용한다. 실제 인증 정보는 이 저장소에 저장하지 않는다.

## 배포 구조

- Pages `pickle-recipes`: 기존 `production` 브랜치의 검증된 정적 브릿지·설정·API를 배포한다.
- `Release and build index`: 서명된 `submissions/*` PR의 단일 JSON 경로, 정확한 head, 최신 기준 버전을 검증하고 브릿지 릴리즈 해시를 기록한다. 저장소 소유자의 통합 PR은 운영 코드 검토를 거친다.
- 빌드는 검토된 해시와 일치하는 JSON만 공개하며 `recipes/index.json`, `bridge/index.json`, 루트와 브릿지의 `hosts.json`을 생성한다. API CSP 출처도 공개된 설정에서만 생성한다.
- Worker `pickle-recipes-bridge-router`: `*.pickle-recipes.com/*` 중 `loginbridge--<siteId>.pickle-recipes.com`만 허용하고 이 Pages의 공개 브릿지 파일만 전달한다. 정확한 호스트 형식과 공개 인덱스의 사이트 ID를 모두 확인한다. 다른 서브도메인·중첩 호스트·미등록 사이트·API 경로는 거부한다. 입력값·쿠키·Authorization·쿼리·POST 본문을 전달하지 않으며 로그인 API를 프록시하지 않는다.
- 기존 4개 `pickle-loginbridge*.pages.dev` 프로젝트에는 동일한 얇은 프록시를 배포한다. 이후 설정·엔진 변경은 `pickle-recipes` Pages 배포 즉시 반영된다. 이전 저장소의 Git 자동 배포가 프록시를 덮어쓰지 않도록 해당 프로젝트의 자동 배포를 비활성화한다.

프록시 엔진 자체가 바뀔 때만 아래를 배포한다. 새 사이트 JSON이 병합될 때마다 Worker나 Pages 프로젝트를 만들 필요는 없다.

동일 계정의 Pages로 공개 fetch를 보내기 위해 모든 프록시에 `global_fetch_strictly_public` 호환성 플래그를 적용한다. 일반 공개 요청과 동일하게 대상 보안 정책을 통과하며, 서비스 바인딩이나 사용자 요청 헤더 전달은 사용하지 않는다.

```powershell
node scripts/deploy-bridge-proxies.mjs
node node_modules/wrangler/bin/wrangler.js deploy -c wrangler.bridge.jsonc
```

## 도메인 연결

운영 주소는 `https://pickle-recipes.com`과 `https://loginbridge--<siteId>.pickle-recipes.com/`이다. 브릿지는 한 단계 서브도메인이므로 무료 Universal SSL의 `*.pickle-recipes.com` 인증서를 사용한다. 유료 Advanced Certificate Manager 구독은 사용하지 않는다. 도메인 자동 갱신은 꺼진 상태, WHOIS 개인정보 가림은 켜진 상태로 유지한다.

`pickle-recipes.com` 소유권과 Cloudflare zone이 활성화된 뒤 Pages의 커스텀 도메인으로 apex를 연결한다. Pages가 요구하는 DNS 레코드·인증서가 활성화되어야 한다. 이 시점까지 기존 `pickle-recipes.pages.dev`는 유지한다. API는 두 origin만 허용하고 브릿지 호스트에서 커뮤니티 API를 호출하지 않는다.

DNS는 proxied CNAME `*` → `pickle-recipes.pages.dev`, Worker route는 `*.pickle-recipes.com/*` → `pickle-recipes-bridge-router`이며 요청 제한 실패 모드는 차단이다. apex CNAME 및 Pages 커스텀 도메인은 유지한다. `*.` route는 apex를 포함하지 않으므로 메인 API를 가로채지 않는다. DNS와 route의 부분 와일드카드 `loginbridge--*`는 사용하지 않는다. Worker의 정확한 접두사·siteId 검사가 와일드카드의 나머지 호스트를 차단한다.

새 JSON이 검증·병합·릴리즈되어 인덱스에 포함되면 DNS나 Worker를 추가 생성하지 않고 자동으로 연결된다. 앞으로 다른 서비스에 서브도메인을 할당할 때는 더 구체적인 DNS 및 route를 별도로 검토한다. 기존 중첩 로그인 호스트용 DNS와 route는 제거한다.

```powershell
node node_modules/wrangler/bin/wrangler.js deploy -c wrangler.bridge-domain.jsonc
```

각 `bridge/sites/*.json`의 `bridgeUrl`은 `https://loginbridge--<siteId>.pickle-recipes.com/`이며 모든 사이트에 `?download=1`을 포함한다. 변경은 PR 검증·릴리즈를 거쳐 배포한다. 기존 `pickle-loginbridge--<siteId>.pages.dev` 호스트와 `/bridge/?site=<siteId>`는 계속 지원한다. 메인 API 허용 origin과 브릿지 CSP의 외부 API 목록은 이 주소 전환으로 확장하지 않는다. 추가 환경변수·비밀값은 필요하지 않다.

Wrangler 인증에 zone route 권한이 없으면 대시보드에서 route를 관리하고, 코드만 `wrangler versions upload -c wrangler.bridge.jsonc` 후 `wrangler versions deploy <version-id>@100% -c wrangler.bridge.jsonc --yes`로 배포한다. 새 버전 업로드만으로 트래픽이나 route는 변경되지 않는다.

웹 목록·상세 링크는 `download` 파라미터를 제거한 `displayUrl`을 사용한다. 빌드가 모든 브릿지에 `download=1`을 붙인 `downloadUrl`도 생성하며 피클 AI는 이 값을 사용한다. 이 필드들은 공통 엔진에서 파생하므로 제출 JSON에 별도 입력하지 않는다. 모든 사이트 JSON은 `requireDownloadParam:true` 및 단일 `download=1`이 포함된 `bridgeUrl`을 요구한다. 일반 주소에는 입력 폼·파일 받기·허용 링크가 없으며, AI 실행 주소에서만 입력·파일 생성이 가능하다. 이 파라미터는 공개된 흐름 구분값이며 AI 신원을 인증하지 않는다. URL 표시와 실행 안내를 바꾸는 데 DNS나 Worker 설정 변경은 필요하지 않다.

## 검증과 한계

`node --test`는 스키마·PII·코드 차단, URL 우회, 제출 단일 파일 범위, 서명, 릴리즈 해시, 검색, 전용 호스트 우선순위와 브라우저 비밀 정리를 검사한다. 실서비스 로그인에는 사용자의 인증이 필요하며 테스트에 실제 계정·토큰을 쓰지 않는다. API 목적지의 CORS와 공인 DNS는 운영자가 검토해야 한다. DNS 이름의 장래 변경이나 모든 민감정보를 정적 검사로 보장할 수 없으며 실패를 서버 프록시로 우회하지 않는다.

브릿지에 분석·광고·Zaraz·Rocket Loader 같은 스크립트를 삽입하지 않는다. Worker observability는 비활성화되어 있으며 요청 쿼리에 인증 정보를 넣지 않는다. 다운로드 파일은 비밀을 포함하므로 사용자 기기에서 관리한다.

참고: [Pages 헤더](https://developers.cloudflare.com/pages/configuration/headers/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), [와일드카드 DNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/), [Universal SSL 범위](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
