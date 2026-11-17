# 로그인 브릿지 운영

`DDUBABA/pickle-loginbridge`의 `a199b70ff5801c329bbcaf8a8eb6d3778514b021`에서 공통 엔진과 3개 공통 사이트 JSON을 가져왔다. 이 저장소의 `bridge/`가 이후 기준이다. `/bridge/sites/_schema.json`과 서버·CI 의미 검증을 함께 사용한다. 실제 인증 정보는 이 저장소에 저장하지 않는다.

## 배포 구조

- Pages `pickle-recipes`: 기존 `production` 브랜치의 검증된 정적 브릿지·설정·API를 배포한다.
- `Release and build index`: 서명된 `submissions/*` PR의 단일 JSON 경로, 정확한 head, 최신 기준 버전을 검증하고 브릿지 릴리즈 해시를 기록한다. 저장소 소유자의 통합 PR은 운영 코드 검토를 거친다.
- 빌드는 검토된 해시와 일치하는 JSON만 공개하며 `recipes/index.json`, `bridge/index.json`, 루트와 브릿지의 `hosts.json`을 생성한다. API CSP 출처도 공개된 설정에서만 생성한다.
- Worker `pickle-recipes-bridge-router`: `*.login.pickle-recipes.com/*` 요청의 사이트 ID를 확인하고 이 Pages의 공개 브릿지 파일만 전달한다. 입력값·쿠키·Authorization·쿼리·POST 본문을 전달하지 않는다. 미등록 사이트·API 경로는 거부한다. 로그인 API를 프록시하지 않는다.
- 기존 4개 `pickle-loginbridge*.pages.dev` 프로젝트에는 동일한 얇은 프록시를 배포한다. 이후 설정·엔진 변경은 `pickle-recipes` Pages 배포 즉시 반영된다. 이전 저장소의 Git 자동 배포가 프록시를 덮어쓰지 않도록 해당 프로젝트의 자동 배포를 비활성화한다.

프록시 엔진 자체가 바뀔 때만 아래를 배포한다. 새 사이트 JSON이 병합될 때마다 Worker나 Pages 프로젝트를 만들 필요는 없다.

```powershell
node scripts/deploy-bridge-proxies.mjs
node node_modules/wrangler/bin/wrangler.js deploy -c wrangler.bridge.jsonc
```

## 도메인 연결

`pickle-recipes.com` 소유권과 Cloudflare zone이 활성화된 뒤 Pages의 커스텀 도메인으로 apex를 연결한다. Pages가 요구하는 DNS 레코드·인증서가 활성화되어야 한다. 이 시점까지 기존 `pickle-recipes.pages.dev`는 유지한다. API는 두 origin만 허용하고 브릿지 호스트에서 커뮤니티 API를 호출하지 않는다.

와일드카드는 proxied `*.login` DNS 레코드와 Worker route가 필요하다. DNS 대상은 기존 Pages 호스트로 설정하되 라우트가 요청을 처리하도록 한다. 준비 후:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy -c wrangler.bridge-domain.jsonc
```

Full DNS setup의 Universal SSL은 apex와 첫 단계 서브도메인만 포함한다. 요청한 `*.login.pickle-recipes.com`은 더 깊은 단계이므로 해당 이름을 포함한 인증서가 필요하다. 유료 Advanced Certificate Manager 등 실제 계정에서 제공되는 인증서 옵션과 비용을 확인하고 사용자 결제 승인 후 활성화한다. 인증서가 활성화되기 전에 전용 URL을 새 커스텀 도메인으로 전환하지 않는다.

연결 완료 후 각 `bridge/sites/*.json`의 `bridgeUrl`을 `https://<siteId>.login.pickle-recipes.com/`으로 변경하되 `requireDownloadParam` 사이트의 `?download=1`을 유지한다. 변경은 PR 검증·릴리즈를 거쳐 배포한다. 기존 Pages 호스트와 확인용 `?site=`는 계속 지원한다.

## 검증과 한계

`node --test`는 스키마·PII·코드 차단, URL 우회, 제출 단일 파일 범위, 서명, 릴리즈 해시, 검색, 전용 호스트 우선순위와 브라우저 비밀 정리를 검사한다. 실서비스 로그인에는 사용자의 인증이 필요하며 테스트에 실제 계정·토큰을 쓰지 않는다. API 목적지의 CORS와 공인 DNS는 운영자가 검토해야 한다. DNS 이름의 장래 변경이나 모든 민감정보를 정적 검사로 보장할 수 없으며 실패를 서버 프록시로 우회하지 않는다.

브릿지에 분석·광고·Zaraz·Rocket Loader 같은 스크립트를 삽입하지 않는다. Worker observability는 비활성화되어 있으며 요청 쿼리에 인증 정보를 넣지 않는다. 다운로드 파일은 비밀을 포함하므로 사용자 기기에서 관리한다.

참고: [Pages 헤더](https://developers.cloudflare.com/pages/configuration/headers/), [Pages 제한](https://developers.cloudflare.com/pages/platform/known-issues/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), [고급 인증서](https://developers.cloudflare.com/ssl/edge-certificates/advanced-certificate-manager/).
