# 피클 레시피 · Pickle Recipes

피클 커넥터와 레시피를 GitHub 계정 없이 검색·다운로드·공유하는 공개 허브입니다. **Cloudflare Pages + Pages Functions + D1**으로 동작하며, 피클 로그인 브릿지와 별개의 프로젝트입니다.

## 구현 범위

- 반응형 한국어 검색 UI: 종류·카테고리·인증 필터, 관련도 + 인기/최신/최근 패치 정렬, 다운로드 수, 상세·릴리즈 타임라인.
- 약관 버튼 동의, D1 기록, 최신 버전 재검증, 선택적 자동 업로드 동의. 웹·피클 공용 다운로드 JSON 번들.
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

2. 반환된 `database_id`를 `wrangler.jsonc`의 자리표시자 UUID 대신 입력합니다. 바인딩 이름은 반드시 `DB`입니다. `migrations/0001_init.sql`에 요청한 3개 테이블이 있습니다. `consents`에는 비밀 동의 토큰 해시와 선택 자동 업로드 동의 필드 2개를 추가했습니다.

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

Cloudflare Pages **Git integration**을 사용하면 저장소를 연결하고 production branch를 **`production`**으로 지정하세요. Build command는 `node scripts/build.mjs`, output directory는 `dist`, 환경변수는 `NODE_VERSION=22`, `SKIP_DEPENDENCY_INSTALL=1`입니다. 빌드 스크립트는 외부 npm 패키지가 필요하지 않고 Cloudflare가 Functions를 컴파일합니다. Preview branch 배포는 비활성화하세요. Actions가 릴리즈와 검사를 완료한 커밋만 `production` 브랜치에 fast-forward로 올리므로 미확정 main 머지를 자동 배포하지 않습니다.

**Direct Upload**는 대안입니다. 이 경우 위 CLI 명령을 사용하고, Actions에 Cloudflare API 토큰과 계정 ID가 있으면 원격 마이그레이션 및 직접 배포도 수행합니다. API 토큰이 없으면 직접 배포만 건너뛰고 검증된 `production` 브랜치는 항상 발행합니다.

## GitHub App 봇 설정

1. GitHub Settings → Developer settings → GitHub Apps에서 전용 App을 만듭니다. 사용자 인증/OAuth 앱이 아닙니다. 홈페이지 URL은 실제 사이트 주소를 사용하고 webhook은 사용하지 않으면 비활성화합니다.
2. Repository permissions: **Contents: Read & write**, **Pull requests: Read & write**, Metadata: Read. 저장소는 `pickle-recipes` 하나만 설치 대상으로 선택합니다. 사용자 사이트 이용자에게 GitHub 로그인을 요구하지 않습니다.
3. App ID, installation ID, Generate a private key로 받은 PEM을 위 Cloudflare 비밀값에 등록합니다. App은 짧은 수명의 installation token을 요청할 때 해당 저장소로 범위를 제한합니다.
4. 저장소 Actions secrets에 `SUBMISSION_METADATA_SECRET`을 Cloudflare와 동일하게 등록합니다. 자동 배포를 사용하면 `CLOUDFLARE_API_TOKEN`(해당 계정 Pages 편집 및 D1 편집), `CLOUDFLARE_ACCOUNT_ID`도 등록합니다. 서버 코드에는 관리자 개인 GitHub 토큰을 넣지 않습니다.
5. Settings → Actions → General에서 워크플로의 필요한 쓰기 권한을 허용합니다. main 보호 규칙에서 PR 검사 `validate`, 코드 소유자 검토, 최신 main 반영을 요구하세요. 버전 자동화 커밋이 main에 쓸 수 있도록 전용 자동화 예외를 계정 정책에 맞게 설정합니다. 기본 GITHUB_TOKEN 커밋은 다시 push 워크플로를 유발하지 않으므로 같은 job 안에서 최종 빌드 배포를 수행합니다.

## 접수와 버전 자동화

`POST /api/submit` 형식과 전체 동의 절차는 [guide.md](guide.md)를 따릅니다. API는 새 버전 입력을 거부하며 `baseVersion`, 공개용 `submittedBy`, `summary`, `type`, `meta`, `files`를 받습니다. 새 항목의 PR에는 임시 메타 `version:"1.0"`, `releases:[]`가 들어가지만, 릴리즈 전에는 사이트 카탈로그/번들에 노출되지 않습니다.

- 새 항목: 1.0. 패치: 현재 확정 버전 1.2 → 1.3; 1.9 → 2.0.
- 리믹스/이식: 새 ID로 1.0, 부모 기준 버전을 릴리즈 이력에 남깁니다.
- PR 메타 블록: `baseVersion · submittedBy · termsVersion · consentId · summary`와 항목·종류·검증한 head SHA, HMAC 서명. `consentToken`은 절대로 공개하지 않습니다.
- `.github/release-state.json`이 확정 버전·누적 이력·공통 코드 해시를 보존합니다. 중복 Actions 실행은 동일 PR을 다시 올리지 않습니다. 대기 job이 교체되어도 모든 미처리 merged PR을 순서대로 재검토합니다.
- 병합된 코드와 서명·head·기준 버전이 맞지 않으면 자동 배포를 중단합니다. 충돌 시 운영자는 되돌리기 또는 최신 확정 버전에 재적용한 새 PR로 해결합니다. 서명 검사를 끄거나 릴리즈 원장을 임의로 조작해서 해결하지 마세요.
- 제출 후 파일 또는 메타 블록을 편집하면 head 서명이 달라져 거부됩니다. 수정 사항은 최신 기준으로 API에 다시 제출합니다.
- main에 항목 파일을 직접 추가하면 공개되지 않습니다. 항목 변경은 검증된 접수 PR을 사용하세요. 앱 코드·문서 등 인프라 PR은 항목 버전을 변경하지 않습니다.
- GitHub API 장애로 PR 생성의 응답을 받지 못했으면 반복 제출 전에 브랜치/PR 상태를 확인합니다. 생성 중 실패한 `submissions/` 브랜치는 운영자가 확인해 정리할 수 있습니다.

`pr-check.yml`은 신뢰하는 main의 검사기를 사용해 PR 파일을 데이터로 읽으며 제출 Python을 실행하지 않습니다. HMAC 비밀은 PR 검사에 전달하지 않고 병합된 main 릴리즈 단계에서만 사용합니다. `pr-report.yml`은 검증 로그·아티팩트를 실행하지 않고 결과 링크만 코멘트합니다.

## API 요약

| API | 설명 |
| --- | --- |
| `POST /api/consent` | 최신 버전·agreed true·userIdentifier 검사 후 기록, 비밀 consentToken 1회 반환 |
| `GET /api/consent/verify` | 동의 토큰·ID·최신 약관 버전 검증 |
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
- 공개 접수에는 Cloudflare의 API rate limiting을 적용하세요. 계정별 정책과 한도가 달라 앱에 임의의 요금제 의존 규칙을 만들지 않았습니다. 초기 동의 API는 누구나 사용할 수 있으므로 동의 토큰을 봇 방어로 간주하면 안 됩니다.
- 약관·기록 정책을 바꾸면 `terms.json`과 `terms.html`의 버전을 함께 올려 배포합니다. 실제 운영자 연락 경로, 보유 기간, 국외 처리 고지 등은 실제 운영 방식에 맞춰 확정해야 합니다. 현재 문서는 구현된 동작을 설명하는 초기 운영 문안입니다.
- 기록 삭제는 관리자만 수행하며 `download_logs`의 외래키를 고려해 해당 로그를 먼저 삭제·비식별화하고 동의를 정리합니다. 누적 통계는 개인 식별자와 분리되어 있습니다. 실제 보유 기간을 확정한 후 보존·삭제 작업을 운영 일정에 반영하세요.

## 공식 참고

- [Cloudflare Pages D1 바인딩](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub Actions 토큰 권한](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [MIT 라이선스](https://opensource.org/license/mit)
