# 피클 레시피 · Pickle Recipes

**피클 제작사와 무관한 비공식 서드파티 커뮤니티입니다.** 제작사의 공식 서비스·제휴 서비스가 아니며, 게시물은 제작사의 검토·보증을 의미하지 않습니다. 운영자는 [jkc1832](https://github.com/jkc1832)입니다.

사용자가 만든 피클 커넥터와 레시피를 GitHub 계정 없이 검색·다운로드·공유하는 자료 허브입니다. 가이드·약관·API·템플릿·저장 경로는 이 커뮤니티 자체 규칙이며 제작사의 공식 규격이나 SDK가 아닙니다. 각 기능의 사용 가능 여부는 이용하는 AI 환경에 따라 달라집니다. **Cloudflare Pages + Pages Functions + D1**으로 동작하며, 피클 로그인 브릿지와 별개의 프로젝트입니다.

## 구현 범위

- 반응형 한국어 검색 UI: 종류·카테고리·인증 필터, 관련도 + 인기/최신/최근 패치 정렬, 다운로드 수, 상세·릴리즈 타임라인.
- 두 버튼으로 약관 동의, D1 기록, 최신 버전 재검증, 이용 동의에 포함된 자동 업로드. 웹·피클 공용 다운로드 JSON 번들.
- GitHub App 브랜치·PR 접수, 개인정보/위험 코드 검사, 기준 버전 충돌 확인, PR 번호 접수증.
- PR 검사 및 결과 코멘트, 병합 후 자동 버전 확정·카탈로그·사이트맵 생성·선택적 자동 배포.
- AI 진입점 `/guide.md`, `/template/`, `/terms.json`, `/recipes/index.json`, `/llms.txt`.

초기 카탈로그는 비어 있습니다. 실제 등록되지 않은 기능이나 다운로드 수를 예시 데이터로 표시하지 않습니다. `template/`는 미구현 빈 양식이며 카탈로그에 노출하지 않습니다.

## 로컬 실행

Node.js 22.13 이상, Python 3.12 이상, pnpm 11.25.0이 필요합니다. 외부 서비스 인증 없이 로컬 D1로 화면과 API를 실행할 수 있습니다.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm run db:local
pnpm run dev
```

`http://localhost:8788`에서 확인합니다. `node scripts/build.mjs`가 정적 공개 파일을 `dist/`에 복사하고 다운로드 번들은 `functions/_generated/catalog.js`에 서버 전용으로 생성합니다. **프로젝트 루트 전체를 정적 배포하지 마세요.** `dist/`에 Functions 소스, D1, 비밀 환경변수, 실행 번들은 포함되지 않습니다. 요청에 따라 `_routes.json`은 `/api/*`만 Functions로 보냅니다.

```sh
node scripts/validate.mjs
python scripts/check_python.py
node scripts/build.mjs
node --test tests/*.test.mjs
```

테스트는 실제 SQLite 스키마로 미동의/위조/구약관 차단, 다운로드 트랜잭션 롤백, 통계 접근 제한, 검색, 경로 탈출·민감정보·위험 코드, 템플릿, 버전 충돌·멱등성을 검증합니다. 제출 Python은 검사 과정에서 실행하지 않습니다.

## Cloudflare D1와 Pages 배포

1. Cloudflare 계정에서 로그인하고 D1을 생성합니다.

   ```sh
   pnpm exec wrangler login
   pnpm exec wrangler d1 create pickle-recipes
   ```

2. 다른 계정에 배포할 때는 반환된 `database_id`로 `wrangler.jsonc`의 기존 UUID를 교체합니다. 현재 UUID는 이 프로젝트용으로 생성한 D1을 가리킵니다. 바인딩 이름은 반드시 `DB`입니다. `migrations/0001_init.sql`에 요청한 3개 테이블이 있습니다. `consents`에는 비밀 동의 토큰 해시와 자동 업로드 허용 여부 필드 2개를 추가했습니다.

3. 원격 마이그레이션과 Pages 프로젝트 생성을 진행합니다.

   ```sh
   pnpm run db:remote
   pnpm exec wrangler pages project create pickle-recipes --production-branch main
   ```

4. 실제 Pages 도메인이 `pickle-recipes.pages.dev`와 다르면 `site.config.json`의 `siteUrl`을 수정합니다. `index.html`의 원본 canonical/OG/JSON-LD URL도 함께 수정하거나 빌드의 `SITE_URL` 환경변수를 지정합니다. 사이트 URL은 임의의 존재하지 않는 주소로 확정하지 마세요.

5. 아래 런타임 비밀값을 Pages 프로젝트 **production** 환경에 등록합니다. 대시보드 Settings → Variables and Secrets 또는 `pnpm exec wrangler pages secret put NAME --project-name pickle-recipes`를 사용합니다. 개인키는 PEM 전체이며 실제 줄바꿈과 `\n` 모두 지원합니다.

   | 이름 | 용도 |
   | --- | --- |
   | `GITHUB_APP_ID` | 접수용 GitHub App ID |
   | `GITHUB_APP_PRIVATE_KEY` | GitHub에서 발급한 RSA PEM 개인키 (PKCS#1/PKCS#8) |
   | `GITHUB_INSTALLATION_ID` | 해당 저장소에 설치한 App installation ID |
   | `SUBMISSION_METADATA_SECRET` | PR 메타 위변조 검증용 충분히 긴 임의 비밀값. GitHub Actions secret에도 동일한 값 |
   | `ADMIN_STATS_TOKEN` | 선택 관리자 통계 접근 토큰. 미설정이어도 사용자/일별/버전별 통계는 비공개 |

   일반 변수 `GITHUB_REPOSITORY=jkc1832/pickle-recipes`, `GITHUB_DEFAULT_BRANCH=main`은 Wrangler에 선언되어 있습니다. 비밀값은 `.dev.vars.example`을 복사한 **미추적** `.dev.vars`에만 로컬 설정하고, 터미널 기록·Git·채팅에 넣지 마세요.

6. 배포합니다.

   ```sh
   pnpm run deploy
   ```

7. 실서비스에서 `/terms.json`, `/guide.md`, `/api/consent/verify` 미동의 403, 동의 후 검색·다운로드, D1 카운트를 확인합니다. D1 production과 preview는 다른 DB를 사용하고 **PR preview에 운영 GitHub App 키나 관리자 토큰을 주입하지 마세요.** Pages의 Functions 한도 초과 정책은 fail closed로 설정하세요.

Cloudflare Pages **Git integration**을 사용하면 저장소를 연결하고 production branch를 `production`으로 지정하세요. Build command는 `node scripts/build.mjs`, output directory는 `dist`, 환경변수는 `NODE_VERSION=22`, `SKIP_DEPENDENCY_INSTALL=1`입니다. 빌드 스크립트는 외부 npm 패키지가 필요하지 않고 Cloudflare가 Functions를 컴파일합니다. Preview branch 배포는 비활성화하세요. Actions가 릴리즈와 검사를 완료한 커밋만 `production` 브랜치에 fast-forward로 올리므로 미확정 main 머지를 자동 배포하지 않습니다.

**Direct Upload**는 대안입니다. 이 경우 위 CLI 명령을 사용하고, Actions에 Cloudflare API 토큰과 계정 ID가 있으면 원격 마이그레이션 및 직접 배포도 수행합니다. API 토큰이 없으면 직접 배포만 건너뛰고 검증된 `production` 브랜치는 항상 발행합니다.

## GitHub App 봇 설정

1. GitHub Settings → Developer settings → GitHub Apps에서 전용 App을 만듭니다. 사용자 인증/OAuth 앱이 아닙니다. 홈페이지 URL은 실제 사이트 주소를 사용하고 webhook은 사용하지 않으면 비활성화합니다.
2. Repository permissions: **Contents: Read & write**, **Pull requests: Read & write**, Metadata: Read. 저장소는 `pickle-recipes` 하나만 설치 대상으로 선택합니다. 사용자 사이트 이용자에게 GitHub 로그인을 요구하지 않습니다.
3. App ID, installation ID, Generate a private key로 받은 PEM을 위 Cloudflare 비밀값에 등록합니다. App은 짧은 수명의 installation token을 요청할 때 해당 저장소로 범위를 제한합니다.
4. 저장소 Actions secrets에 `SUBMISSION_METADATA_SECRET`을 Cloudflare와 동일하게 등록합니다. 자동 배포를 사용하면 `CLOUDFLARE_API_TOKEN`(해당 계정 Pages 편집 및 D1 편집), `CLOUDFLARE_ACCOUNT_ID`도 등록합니다. 서버 코드에는 관리자 개인 GitHub 토큰을 넣지 않습니다.
5. 일반 `GITHUB_TOKEN`은 읽기 권한으로 제한하고, 버전 확정·배포에는 전용 GitHub App의 단기 토큰을 사용합니다. main 보호 규칙은 PR, 필수 검사 `validate`·`application-check`, 최신 main 반영과 검토 대화 해결을 요구합니다. 일반 필수 승인 인원은 0명으로 두되 **코드 소유자 승인은 필수로 유지**합니다. `.github/CODEOWNERS`에서 `recipes/`를 운영자에게 지정하고 자동 생성 파일 `recipes/index.json`만 제외합니다. 전역 마지막 푸시·추가 승인 의무는 해제해 운영자가 사이트·GitHub 운영 코드 PR을 추가 승인 없이 직접 병합할 수 있게 합니다. 새 커밋이 올라오면 기존 승인을 취소하는 설정은 유지합니다. 버전 자동화 봇의 직접 쓰기 예외는 별도로 제한합니다.

## 접수와 버전 자동화

운영 배포 워크플로는 이 저장소만 대상으로 하는 GitHub App 단기 토큰을 발급합니다. Actions 변수 `RELEASE_APP_ID`, 암호화 Secret `RELEASE_APP_PRIVATE_KEY`를 설정하고 일반 `GITHUB_TOKEN`은 읽기 권한으로 제한합니다. `main`의 PR·필수 검사(`validate`, `application-check`)·최신 main 반영·검토 대화 해결은 모든 변경에 적용하며, 승인 리뷰는 변경 경로에 따라 구분합니다.

- **사이트·GitHub 운영 변경**: 운영자가 자신의 PR을 검사 통과 후 추가 승인 리뷰 없이 병합합니다. 자동 생성 카탈로그 `recipes/index.json`도 여기에 포함됩니다.
- **신규 레시피·커넥터와 기존 항목 수정**: `recipes/`의 공통 코드 변경은 `.github/CODEOWNERS`에 지정된 운영자 `jkc1832`의 승인 리뷰가 필요합니다. 새 커밋이 추가되면 재승인해야 합니다. 사이트 접수 API는 운영자 개인 토큰 대신 전용 GitHub App으로 PR을 작성하므로 운영자가 작성자와 별개로 승인할 수 있습니다. API는 PR 생성까지만 수행하며 자동 승인·병합하지 않습니다. 운영자 자신이 만든 항목도 사이트 접수 API를 이용합니다.

버전 확정 봇만 직접 쓰기 예외를 두고, `production`은 같은 봇만 업데이트할 수 있도록 별도 규칙을 적용합니다. 강제 푸시와 브랜치 삭제도 제한합니다. 봇 키를 교체하거나 접근을 철회할 때 Cloudflare와 Actions 두 저장 위치를 함께 관리하세요. 코드 소유자 지정은 병합 대상 브랜치의 파일을 기준으로 하므로, 새 보호 설정을 적용하기 전에 이 `CODEOWNERS`를 먼저 main에 반영해야 합니다.

Cloudflare의 프리뷰 접근 제한(Access)을 켜서 이전 배포의 해시 주소도 보호해야 합니다. 자동 프리뷰 생성 중지만으로는 기존 배포 주소가 차단되지 않습니다. API 코드도 현재 운영 origin만 허용합니다. `LOCAL_DEVELOPMENT=1`은 로컬 `.dev.vars`에서만 사용하며 운영 환경에는 등록하지 않습니다.

`POST /api/submit` 형식과 전체 동의 절차는 [guide.md](guide.md)를 따릅니다. API는 새 버전 입력을 거부하며 `baseVersion`, 공개용 `submittedBy`, `summary`, `type`, `meta`, `files`를 받습니다. 새 항목의 PR에는 임시 메타 `version:"1.0"`, `releases:[]`가 들어가지만, 릴리즈 전에는 사이트 카탈로그/번들에 노출되지 않습니다.

약관 `2026-11-17.4`의 동의 카드는 ‘동의하지 않음’과 ‘동의하고 이용’ 두 버튼만 제공합니다. ‘동의하고 이용’에는 규격·개인정보 제거 검증을 거친 공통 코드의 자동 업로드 허용이 포함됩니다. `POST /api/consent`는 `autoUploadAllowed`를 생략하면 `true`, 명시적으로 `false`를 보내면 `false`로 저장하고 반환합니다. 기존 동의 기록은 변경하지 않으며 이전 약관 이용자는 재동의해야 합니다. AI는 사용자의 자동 업로드 중지 요청을 로컬에 보존하고 재개 요청 전까지 제출하지 않아야 합니다. 실행 전 대상·권한·비용과 실행 후 실제 처리 결과를 확인할 최종 책임은 사용자에게 있습니다.

- 새 항목: 1.0. 패치: 현재 확정 버전 1.2 → 1.3; 1.9 → 2.0.
- 리믹스/이식: 새 ID로 1.0, 부모 기준 버전을 릴리즈 이력에 남깁니다.
- PR 메타 블록: `baseVersion · submittedBy · termsVersion · consentId · summary`와 항목·종류·검증한 head SHA, HMAC 서명. `consentToken`은 절대로 공개하지 않습니다.
- `.github/release-state.json`이 확정 버전·누적 이력·공통 코드 해시를 보존합니다. 중복 Actions 실행은 동일 PR을 다시 올리지 않습니다. 대기 job이 교체되어도 모든 미처리 merged PR을 순서대로 재검토합니다.
- 병합된 코드와 서명·head·기준 버전이 맞지 않으면 자동 배포를 중단합니다. 충돌 PR은 병합 전에 닫고 최신 확정 버전으로 다시 제출하세요. 이미 잘못 병합했다면 되돌리기만으로 배포가 재개되지 않습니다. 미처리 병합 이력을 재검사하므로 운영자가 마지막 정상 릴리즈와 병합 이력을 대조하는 복구 작업이 필요합니다. 자동 충돌 복구는 제공하지 않으며, 서명 검사를 끄거나 근거 없이 릴리즈 원장을 수정하지 마세요.
- 제출 후 파일 또는 메타 블록을 편집하면 head 서명이 달라져 거부됩니다. 수정 사항은 최신 기준으로 API에 다시 제출합니다.
- main에 항목 파일을 직접 추가하면 공개되지 않습니다. 항목 변경은 검증된 접수 PR을 사용하세요. 앱 코드·문서 등 인프라 PR은 항목 버전을 변경하지 않습니다.
- GitHub API 장애로 PR 생성의 응답을 받지 못했으면 반복 제출 전에 브랜치/PR 상태를 확인합니다. 생성 중 실패한 `submissions/` 브랜치는 운영자가 확인해 정리할 수 있습니다.

`pr-check.yml`은 신뢰하는 main의 검사기를 사용해 PR 파일을 데이터로 읽으며 제출 Python을 실행하지 않습니다. HMAC 비밀은 PR 검사에 전달하지 않고 병합된 main 릴리즈 단계에서만 사용합니다. `pr-report.yml`은 검증 로그·아티팩트를 실행하지 않고 결과 링크만 코멘트합니다.

## API 요약

| API | 설명 |
| --- | --- |
| `POST /api/consent` | 최신 버전·agreed true·userIdentifier 검사 후 기록, 비밀 consentToken 1회 반환 |
| `GET /api/consent/verify` | 동의 토큰·ID·최신 약관 버전·90일 만료·철회 여부 검증 |
| `POST /api/consent/revoke` | 토큰 소유 확인 후 동의 철회. 기존 동의·철회 증빙 보존 |
| `GET /api/health` | DB 보안 스키마·현재 런타임 약관 상태 확인 |
| `GET /api/search` | q, kind, category, authType, sort, limit; blocked 제외 |
| `GET /api/items/:id` | 상세, README, requires, 릴리즈, 다운로드 수 |
| `POST /api/download` | 동의 검증, D1 batch 로그+집계, JSON 번들 |
| `POST /api/submit` | 규격·PII·위험 코드·중복 검사 후 GitHub PR 접수 |
| `GET /api/stats` | group=items/daily/versions/users, format=json/csv, limit/offset |

동의 후 API 헤더는 `Authorization: Bearer <consentToken>`, `X-Consent-Id`, `X-Terms-Version`입니다. POST download/submit은 ID·버전을 본문에도 포함합니다. 관리자 통계 토큰은 Authorization에 단독 사용합니다. 타 출처 웹페이지 CORS는 허용하지 않으며 피클 서버/CLI의 직접 HTTP 요청은 지원합니다.

## 운영 경계

- 공개 GitHub 소스와 정적 전체 카탈로그는 직접 열람할 수 있습니다. **MIT 원본 접근까지 동의로 통제한다고 주장하지 않습니다.** 사이트 API는 동의를 강제하고 피클의 정적 검색·로컬 실행·예약 실행은 가이드 준수가 필요합니다. 로컬 실행 자체를 사이트 서버가 원격으로 차단할 수는 없습니다.
- `userIdentifier`는 자기 신고 식별자이며 실명·피클 계정 소유 증명이 아닙니다. 통계는 다운로드 요청 수이며 설치 완료·실사용·고유 인원 통계가 아닙니다. 개인 식별자를 임의로 쓰면 여러 사용자가 같은 집계에 나타날 수 있습니다.
- 개인정보/위험 코드 검사는 정규식과 AST 기반의 보조 검사로 완전한 검출을 보장하지 않습니다. 보수적으로 동적 실행·셸·역직렬화·난독화를 반려합니다. 운영자 코드 검토가 필수입니다. 서버와 CI는 커넥터 코드를 실행하지 않습니다.
- `lib/security.js`의 D1 원자적 카운터로 IP·토큰·전체 호출 제한을 적용합니다. 기본 120회/분/IP, 동의 5회/시간/IP, 제출 3회/시간/IP·토큰, 다운로드 30회/분/IP·토큰. 전체 API 600회/분, 동의 100회/시간, 제출 20회/시간입니다. 429 및 Retry-After를 반환합니다. IPv6는 /64로 묶고 카운터 키의 IP는 일별 HMAC으로 저장합니다. 이는 앱 수준의 남용 제한이며 대규모 네트워크 공격에 대한 별도 방어를 대체하지 않습니다.
- 약관·기록 정책을 바꾸면 `terms.json`과 `terms.html`의 버전을 함께 올려 배포합니다. 실제 운영자 연락 경로, 보유 기간, 국외 처리 고지 등은 실제 운영 방식에 맞춰 확정해야 합니다. 현재 문서는 구현된 동작을 설명하는 초기 운영 문안입니다.
- 동의 ID·약관 버전·동의 시각·사용자 식별자·동의 및 철회 이력은 서비스 운영과 동의 증빙 목적이 유지되는 동안 보존하며 180일 자동 정리에서 제외합니다. 동의 기록의 IP·User-Agent와 개별 다운로드 상세 기록은 기록 시점에서 180일이 지난 뒤 정기 작업으로 제거합니다. 항목별 누적 다운로드 수는 유지합니다. 백업의 이전 사본은 D1 복구 보관 기간 내에 남을 수 있으며 공개 PR 이력은 GitHub에 남습니다.
- `.github/workflows/operations.yml`은 30분마다 상태·비공개 통계 차단을 확인하고 서명된 정리 요청을 보냅니다. GitHub 스케줄은 지연될 수 있습니다. 인증은 기존 서명 Secret으로 목적을 구분한 HMAC을 사용하며 5분 유효 시간·일회성 nonce로 재실행을 막습니다. 정리 API는 임의 SQL이나 임의 보관 기간을 받지 않습니다.

## 기술 참고 문서

- [Cloudflare Pages D1 바인딩](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub Actions 토큰 권한](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [MIT 라이선스](https://opensource.org/license/mit)
