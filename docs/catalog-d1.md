# D1 카탈로그 운영

레시피·커넥터(`recipes/<id>/`)와 로그인 브릿지(`bridge/sites/<siteId>.json`)는 검증된 릴리스 후 D1에 게시한다. 사이트 코드 배포와 데이터 게시를 분리한다.

## 저장과 조회

`0005_catalog.sql`은 기존 DB에 다음 테이블을 추가한다. 기존 동의·다운로드·통계 테이블은 변경하지 않는다.

- `catalog_items`: 항목 ID, 종류, 전체 인덱스 메타데이터, SHA-256.
- `catalog_files`: README, meta.json, Python 스크립트, 브릿지 JSON, 인덱스, hosts.json 및 브릿지 CSP 출처 목록. 레시피 파일은 `/api/download`의 동의 검증 후 제공하며 정적 URL로 공개하지 않는다.
- `catalog_state`: 현재 게시 revision, Git SHA, 게시 시각. 처음 게시가 완료되기 전에는 행이 없다.
- `catalog_sync_guard`: 동시 게시 충돌을 감지해 전체 트랜잭션을 취소한다.

`scripts/build.mjs --index-only`와 동기화 스크립트는 같은 릴리스 해시 검증을 사용한다. 릴리스 장부와 일치하지 않는 파일은 게시하지 않는다. `scripts/sync-catalog.mjs`는 원격 해시를 조회하고 변경된 행만 upsert하며 없어진 파일·항목은 삭제한다. 파일·메타데이터·인덱스·상태 변경을 하나의 D1 REST batch로 커밋한다. 실패하면 이전 게시를 유지하고, 재실행 시 동일 revision은 쓰지 않는다. 충돌 실패를 오래된 스냅샷으로 자동 재시도하지 않는다.

서버는 매 요청 D1의 primary에서 읽는다. `/recipes/index.json`, `/bridge/index.json`, 두 `hosts.json`, `/bridge/sites/*.json`, 검색·상세·다운로드·제출 기준 버전 검사에 반영한다. `/bridge/`의 CSP HTTP 헤더는 현재 검증된 API 출처로 생성하고 오래된 HTML meta CSP는 제거한다. 브릿지 프록시는 기존처럼 이 동적 인덱스와 설정을 읽으므로 JSON을 추가할 때 Worker/DNS 재배포가 필요 없다. 운영 호스트는 기존 `loginbridge--<siteId>.pickle-recipes.com`이며 폐기된 `*.login.*` 호스트는 다시 허용하지 않는다.

DB 바인딩·스키마가 없거나 첫 동기화 전이면 기존 빌드의 정적 데이터로 폴백한다. 첫 동기화 후 없는 항목은 404, 차단 항목은 403이다. D1 장애는 503으로 처리하여 삭제·차단 이전의 정적 항목이 다시 공개되지 않게 한다. 응답은 `Cache-Control: no-store`를 사용한다. 동의의 약관 버전은 배포된 서버 약관을 따른다.

## Actions와 Pages

기존 `build-index.yml`을 `Release and sync catalog`로 개편했다. 별도 경쟁 워크플로를 추가하지 않았다. 기존 Release App·서명·PR 검증·브랜치 보호를 유지한다.

1. `release-main` 직렬 실행 잠금을 잡은 뒤 최신 `main`을 checkout한다.
2. 마지막 배포 브랜치 `production`과 코드 경로를 비교한다. 레시피·브릿지 설정·인덱스·장부만 바뀌면 사이트 빌드/의존성 설치/Pages 배포를 생략한다.
3. 머지된 PR을 검증하고 버전·인덱스를 생성한 뒤 `main`에 기록한다. 생성 커밋은 릴리스 작업을 재귀 실행하지 않는다.
4. 변경된 데이터와 인덱스를 D1에 원자적으로 동기화한다.
5. 사이트 코드가 바뀐 경우에만 전체 테스트·빌드·마이그레이션을 실행하고 Pages에 직접 업로드한다. 성공 후에만 `production`을 전진시킨다. 배포 실패 시 다음 실행에서도 코드 차이가 남아 다시 배포한다.

Pages Git 자동 production/preview 배포를 모두 끄고 Actions만 배포한다. 경로 필터만으로는 0회가 보장되지 않는다. Cloudflare는 빈 푸시 또는 3,000개 이상 파일/20개 이상 커밋 푸시에서 필터를 우회하기 때문이다. 직접 업로드용 기존 Git 연결 프로젝트와 `production` 브랜치는 유지한다. 데이터 전용 푸시는 Pages 빌드·배포 0회이며 PR preview도 자동 생성하지 않는다.

`scripts/deployment-scope.mjs`가 코드 경로의 기준이다. `functions/`, `lib/`, `public/`, `template/`, `scripts/`, `migrations/`, `workers/`, 브릿지 엔진·스키마, 루트 앱 파일·빌드 설정 등을 포함한다. 테스트·문서만 수정한 경우 사이트를 배포하지 않는다.

## 최초 전환과 인증

GitHub Actions 저장소 Secrets:

- `CLOUDFLARE_ACCOUNT_ID`: `5399377ab06edf8b2e7b22aeab1ed2de`
- `CLOUDFLARE_API_TOKEN`: 해당 계정 범위의 **Account / D1 / Edit**, **Account / Cloudflare Pages / Edit** 권한을 가진 API 토큰.
- 기존 `RELEASE_APP_PRIVATE_KEY`, `SUBMISSION_METADATA_SECRET`과 Variables의 `RELEASE_APP_ID`는 유지한다.

DB ID는 `wrangler.jsonc`의 `a86265e8-3489-46a5-996a-1f84f48ec7e5`를 사용한다. 별도 `CLOUDFLARE_D1_DATABASE_ID` 환경변수로 명시적으로 덮어쓸 수 있다. OAuth 로그인은 로컬 Wrangler에 사용하며 Actions용 장기 API 토큰으로 복사하지 않는다. 토큰을 채팅·소스·로그에 넣지 않는다.

토큰 발급: <https://dash.cloudflare.com/profile/api-tokens>

Secrets 등록: <https://github.com/DDUBABA/pickle-recipes/settings/secrets/actions>

최초 전환 순서:

1. 새 코드의 테스트·Functions 컴파일을 확인하고 위 Secrets를 준비한다.
2. `node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote`
3. 새 워크플로를 `main`에 반영하고 실행한다. 첫 실행은 코드 차이를 감지하여 Pages Git 자동 배포를 끄고, D1 동기화와 사이트 코드 직접 배포를 수행한다. 병합 자체로 발생하는 기존 방식의 일회성 빌드는 전환 이후 데이터 빌드와 구분한다.
4. 수동 복구 시 같은 토큰·계정 환경에서 `node scripts/configure-pages.mjs`, `node scripts/sync-catalog.mjs`를 실행할 수 있다. 워크플로 실패 시 원인을 수정하고 `workflow_dispatch`로 최신 main을 재처리한다. 오래된 checkout으로 동기화하지 않는다.

설정 스크립트는 Pages 프로젝트의 repository/production branch 설정을 보존하며 `production_deployments_enabled=false`, `preview_deployment_setting=none`, `deployments_enabled=false`를 PATCH 후 재조회한다. 이 설정을 완료하기 전에는 데이터 푸시의 빌드 0회를 보장할 수 없다. Secrets가 없으면 워크플로가 명확하게 실패하며 정적 배포로 조용히 대체하지 않는다.

## 성능과 검증

평상시 원격 해시 읽기 1회 + 변경분 batch 쓰기 1회로 구성하며 로그의 `durationMs`가 D1 동기화 구간이다. 1~2초를 목표로 하지만 네트워크·Cloudflare 응답시간과 데이터 크기에 따라 달라진다. GitHub Actions 대기·checkout·서명 및 Python 검증 시간은 별도이며 머지부터 1~2초라는 SLA는 보장하지 않는다.

```sh
node scripts/build.mjs
node --test tests/*.test.mjs
node scripts/validate.mjs
python scripts/check_python.py
node node_modules/wrangler/bin/wrangler.js pages functions build functions --outdir .local/catalog-functions-check --compatibility-flags=nodejs_compat
```

단위 테스트는 실제 SQLite 마이그레이션으로 동적 조회, 폴백, 삭제·차단, 동의·로그 유지, 변경분/무변경 게시, 트랜잭션 롤백·경합, 브릿지 CSP와 새 전용 호스트, REST 오류, 배포 분기를 검사한다.

참고: [D1 batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 REST query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [Pages 경로 필터 예외](https://developers.cloudflare.com/pages/configuration/build-watch-paths/), [Pages 프로젝트 설정 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/).
