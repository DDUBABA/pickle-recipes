# 피클 레시피 · Pickle Recipes

**피클 제작사와 무관한 비공식 서드파티 커뮤니티입니다.** 제작사의 공식 서비스·제휴 서비스가 아니며, 게시물은 제작사의 검토·보증을 의미하지 않습니다. 운영자는 [DDUBABA](https://github.com/DDUBABA)입니다.

사용자가 만든 피클 커넥터와 레시피를 GitHub 계정 없이 검색·다운로드·공유하는 자료 허브입니다. 가이드·약관·API·템플릿·저장 경로는 이 커뮤니티 자체 규칙이며 제작사의 공식 규격이나 SDK가 아닙니다. 각 기능의 사용 가능 여부는 이용하는 AI 환경에 따라 달라집니다. **Cloudflare Pages + Pages Functions + D1**으로 동작하며, 공통 로그인 브릿지 엔진을 통합했습니다.

## 구현 범위

- 반응형 한국어 검색 UI: 종류·카테고리·인증 필터, 관련도 + 인기/최신/최근 패치 정렬, 다운로드 수, 상세·릴리즈 타임라인.
- 두 버튼으로 약관 동의, D1 기록, 최신 버전 재검증, 이용 동의에 포함된 자동 업로드. 웹·피클 공용 다운로드 JSON 번들.
- GitHub App 브랜치·PR 접수, 개인정보/위험 코드 검사, 기준 버전 충돌 확인, PR 번호 접수증.
- 공식 [문의·건의하기](https://github.com/DDUBABA/pickle-recipes/issues)와 계정 없는 웹 폼·`POST /api/feedback`: D1 비공개 저장, 개인정보·토큰 패턴 차단, 429 제한, 180일 정리.
- PR 검사 및 결과 코멘트, 병합 후 자동 버전 확정·카탈로그·사이트맵 생성·선택적 자동 배포.
- AI 진입점 `/guide.md`, `/template/`, `/terms.json`, `/recipes/index.json`, `/llms.txt`.
- [로그인 브릿지 목록](https://pickle-recipes.com/bridge/)과 `loginbridge--<siteId>.pickle-recipes.com` 전용 주소: 무료 Universal SSL, 단일 JSON 제출·자동 인덱싱, 기존 Pages 주소 호환. [운영 안내](docs/bridge-deployment.md).

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

2. 다른 계정에 배포할 때는 반환된 `database_id`로 `wrangler.jsonc`와 `wrangler.retention.jsonc`의 UUID를 함께 교체합니다. 현재 UUID는 이 프로젝트용으로 생성한 D1을 가리킵니다. 바인딩 이름은 반드시 `DB`입니다. `migrations/0001_init.sql`에 요청한 3개 테이블이 있습니다. `consents`에는 비밀 동의 토큰 해시와 자동 업로드 허용 여부 필드 2개를 추가했습니다.

3. 원격 마이그레이션과 Pages 프로젝트 생성을 진행합니다.

   ```sh
   pnpm run db:remote
   pnpm exec wrangler pages project create pickle-recipes --production-branch main
   ```

4. 기본 주소는 `https://pickle-recipes.com`이며 `https://pickle-recipes.pages.dev`도 호환 주소로 유지합니다. 주소를 변경할 때는 `site.config.json`의 `siteUrl`과 `index.html`의 canonical/OG/JSON-LD URL을 함께 수정합니다. 빌드의 `SITE_URL`로 출력 주소를 재정의할 수 있습니다.

5. 아래 런타임 비밀값을 Pages 프로젝트 **production** 환경에 등록합니다. 대시보드 Settings → Variables and Secrets 또는 `pnpm exec wrangler pages secret put NAME --project-name pickle-recipes`를 사용합니다. 개인키는 PEM 전체이며 실제 줄바꿈과 `\n` 모두 지원합니다.

   | 이름 | 용도 |
   | --- | --- |
   | `GITHUB_APP_ID` | 접수용 GitHub App ID |
   | `GITHUB_APP_PRIVATE_KEY` | GitHub에서 발급한 RSA PEM 개인키 (PKCS#1/PKCS#8) |
   | `GITHUB_INSTALLATION_ID` | 해당 저장소에 설치한 App installation ID |
   | `SUBMISSION_METADATA_SECRET` | PR 메타 위변조 검증용 충분히 긴 임의 비밀값. GitHub Actions secret에도 동일한 값 |
   | `ADMIN_STATS_TOKEN` | 선택 관리자 통계 접근 토큰. 미설정이어도 사용자/일별/버전별 통계는 비공개 |

   일반 변수 `GITHUB_REPOSITORY=DDUBABA/pickle-recipes`, `GITHUB_DEFAULT_BRANCH=main`은 Wrangler에 선언되어 있습니다. 비밀값은 `.dev.vars.example`을 복사한 **미추적** `.dev.vars`에만 로컬 설정하고, 터미널 기록·Git·채팅에 넣지 마세요.

6. 배포합니다.

   ```sh
   pnpm run deploy
   ```

7. 실서비스에서 `/terms.json`, `/guide.md`, `/api/consent/verify` 미동의 403, 미동의 검색·상세 열람과 동의 후 다운로드, D1 카운트를 확인합니다. D1 production과 preview는 다른 DB를 사용하고 **PR preview에 운영 GitHub App 키나 관리자 토큰을 주입하지 마세요.** Pages의 Functions 한도 초과 정책은 fail closed로 설정하세요.

Cloudflare Pages **Git integration**을 사용하면 저장소를 연결하고 production branch를 `production`으로 지정하세요. Build command는 `node scripts/build.mjs`, output directory는 `dist`, 환경변수는 `NODE_VERSION=22`, `SKIP_DEPENDENCY_INSTALL=1`입니다. 빌드 스크립트는 외부 npm 패키지가 필요하지 않고 Cloudflare가 Functions를 컴파일합니다. Preview branch 배포는 비활성화하세요. Actions가 릴리즈와 검사를 완료한 커밋만 `production` 브랜치에 fast-forward로 올리므로 미확정 main 머지를 자동 배포하지 않습니다.

**Direct Upload**는 대안입니다. 이 경우 위 CLI 명령을 사용하고, Actions에 Cloudflare API 토큰과 계정 ID가 있으면 원격 마이그레이션 및 직접 배포도 수행합니다. API 토큰이 없으면 직접 배포만 건너뛰고 검증된 `production` 브랜치는 항상 발행합니다.

## GitHub App 봇 설정

아이디 변경과 이메일 비공개 전환의 실제 적용 순서는 [계정 전환·배포 안내](docs/account-migration.md)를 따릅니다. 확인된 noreply 이메일 설정 전에는 커밋하지 않고, GitHub 아이디 변경 전에는 원격 URL을 바꾸지 않습니다.

1. GitHub Settings → Developer settings → GitHub Apps에서 전용 App을 만듭니다. 사용자 인증/OAuth 앱이 아닙니다. 홈페이지 URL은 실제 사이트 주소를 사용하고 webhook은 사용하지 않으면 비활성화합니다.
2. Repository permissions: **Contents: Read & write**, **Pull requests: Read & write**, Metadata: Read. 저장소는 `pickle-recipes` 하나만 설치 대상으로 선택합니다. 사용자 사이트 이용자에게 GitHub 로그인을 요구하지 않습니다.
3. App ID, installation ID, Generate a private key로 받은 PEM을 위 Cloudflare 비밀값에 등록합니다. App은 짧은 수명의 installation token을 요청할 때 해당 저장소로 범위를 제한합니다.
4. 저장소 Actions secrets에 `SUBMISSION_METADATA_SECRET`을 Cloudflare와 동일하게 등록합니다. 자동 배포를 사용하면 `CLOUDFLARE_API_TOKEN`(해당 계정 Pages 편집 및 D1 편집), `CLOUDFLARE_ACCOUNT_ID`도 등록합니다. 서버 코드에는 관리자 개인 GitHub 토큰을 넣지 않습니다.
5. 일반 `GITHUB_TOKEN`은 읽기 권한으로 제한하고, 버전 확정·배포에는 전용 GitHub App의 단기 토큰을 사용합니다. main 보호 규칙은 PR, 필수 검사 `validate`·`application-check`, 최신 main 반영과 검토 대화 해결을 요구합니다. 일반 필수 승인 인원은 0명으로 두되 **코드 소유자 승인은 필수로 유지**합니다. `.github/CODEOWNERS`에서 `recipes/`를 운영자에게 지정하고 자동 생성 파일 `recipes/index.json`만 제외합니다. 전역 마지막 푸시·추가 승인 의무는 해제해 운영자가 사이트·GitHub 운영 코드 PR을 추가 승인 없이 직접 병합할 수 있게 합니다. 새 커밋이 올라오면 기존 승인을 취소하는 설정은 유지합니다. 버전 자동화 봇의 직접 쓰기 예외는 별도로 제한합니다.

### Production 접수 API 설정 체크리스트

Pages의 `pickle-recipes` 프로젝트 → Settings → Variables and Secrets에서 **Production** 환경을 선택합니다. 개인키와 메타데이터 비밀값은 **Encrypt**로 저장하고, 변경 후 새 Production 배포를 실행해야 해당 배포의 `context.env`에 적용됩니다. 로컬 `.dev.vars`, GitHub Actions secrets, Preview 설정은 Production 런타임 설정을 대신하지 않습니다. [Cloudflare 환경변수·Secrets 문서](https://developers.cloudflare.com/pages/functions/bindings/#secrets)

| 확인할 설정 | 확인 사항 |
| --- | --- |
| `GITHUB_APP_ID` | PEM을 발급한 접수용 GitHub App의 App ID. installation ID나 Client secret과 혼동하지 않습니다. JWT issuer로 지원되는 Client ID도 사용할 수 있습니다. 앞뒤 공백·따옴표를 넣지 않습니다. |
| `GITHUB_INSTALLATION_ID` | 위 App을 `DDUBABA/pickle-recipes`에 설치한 installation의 **숫자 ID만** 넣습니다. 설치 설정 URL 전체나 App ID를 넣지 않습니다. |
| `GITHUB_APP_PRIVATE_KEY` | 폐기되지 않은 키의 BEGIN/END를 포함한 PEM 전체. 파일 경로나 PEM 전체를 다시 Base64 인코딩한 값은 사용할 수 없습니다. 암호화되지 않은 RSA PKCS#1(`BEGIN RSA PRIVATE KEY`)·PKCS#8(`BEGIN PRIVATE KEY`)을 지원합니다. |
| `SUBMISSION_METADATA_SECRET` | 충분히 긴 임의 문자열을 Pages와 저장소 Actions secret에 **바이트 단위로 동일하게** 등록합니다. 따옴표·끝 줄바꿈·공백도 값의 일부입니다. 코드가 임의로 정규화하지 않습니다. |

개인키의 실제 LF/CRLF, 문자 그대로의 `\n`/`\r\n`, 앞뒤 공백·BOM 및 한 겹의 짝지어진 따옴표를 정규화합니다. PEM 본문 손상, 암호화 키, 공개키, EC 키는 거부합니다. GitHub 기본 발급 키인 PKCS#1과 PKCS#8 모두 `node:crypto.createPrivateKey`로 검사하므로 운영자가 키를 변환할 필요는 없습니다. JWT 서명 시 검증된 키를 PKCS#8 DER로 내보내고, DER 뷰의 바이트만 복사하여 WebCrypto `importKey('pkcs8', ...)`에 전달합니다. 비동기 `crypto.subtle.sign`은 `RSASSA-PKCS1-v1_5`와 `SHA-256`을 사용하며 JWT의 `RS256`과 대응합니다. `node:crypto.sign`은 호출하지 않습니다. [GitHub 개인키 형식](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps), [GitHub JWT 문서](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [Cloudflare WebCrypto 문서](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

- App의 Repository permissions는 **Contents: Read and write**, **Pull requests: Read and write**이며, 설치 대상에 `DDUBABA/pickle-recipes`가 포함되어야 합니다. 권한을 바꿨다면 설치 소유자의 변경 승인까지 확인합니다. App 설치가 중지되거나 삭제되지 않았는지도 확인합니다.
- 일반 변수 `GITHUB_REPOSITORY=DDUBABA/pickle-recipes`, `GITHUB_DEFAULT_BRANCH=main`과 `DB` 바인딩·마이그레이션도 필요합니다. 접수 PR의 대상인 `main`과 Pages 배포 브랜치인 `production`은 서로 다른 설정입니다. `wrangler.jsonc`의 `nodejs_compat`와 compatibility date가 실제 배포에도 반영되었는지 확인합니다.
- 메타데이터 비밀값 불일치는 GitHub JWT 인증 실패가 아닙니다. 접수 PR이 생성되더라도 `scripts/release.mjs`의 HMAC 검증 또는 운영 점검이 실패할 수 있습니다. 런타임에서는 Actions secret과 비교할 수 없으므로 동일한 원본에서 두 곳에 등록합니다. 교체할 때는 기존 접수 PR의 서명도 영향을 받습니다.

### `POST /api/submit` 오류 진단

기존에는 `createPrivateKey`, JWT 인코딩·`sign`, `fetch` 연결·타임아웃, 응답 JSON 해석에서 발생한 일반 예외가 `submit.js`를 거쳐 미들웨어까지 전파되어 모두 `503 SERVICE_UNAVAILABLE`로 바뀌었습니다. `GITHUB_NOT_CONFIGURED`는 필수 값 누락만, `GITHUB_ERROR`는 GitHub에서 받은 비정상 HTTP 응답만 처리했습니다. 기존 코드에도 `\n` 변환은 있었으며, 정상 PKCS#1/PKCS#8과 `\n` 입력은 로컬 Cloudflare 런타임에서 동작합니다. 같은 런타임에서 기존 코드의 문자 그대로인 `\r\n`·외부 따옴표 입력 실패를 재현했고, 수정 후 두 형식의 10개 조합 모두 서명을 검증했습니다. 운영 키의 실제 입력 상태나 배포 설정은 별도 확인이 필요합니다.

운영에서 키 파싱을 통과한 뒤 `jwt_sign` 오류가 보고되어 JWT 서명을 WebCrypto로 교체했습니다. `key_parse` 분류는 유지하며, 이후 PKCS#8 내보내기·WebCrypto 가져오기·서명 실패는 `jwt_sign`으로 분류합니다.

아래 오류 응답에는 고정된 `code`, `stage`, 사용자 안내 및 해당하는 경우 숫자 `upstreamStatus`를 넣습니다. `jwt_sign`은 허용 목록에 있는 `errorName`·Node 오류 코드 또는 DOMException의 표준 숫자 코드(0–25)만 추가합니다. 알 수 없는 이름은 `UnknownError`, 알 수 없는 코드는 생략합니다. 임의의 예외 name/code 문자열도 그대로 반환하지 않습니다. 개인키·JWT·installation token·Authorization 헤더·GitHub 응답 본문·원본 예외 메시지/스택은 응답이나 로그에 넣지 않습니다.

| HTTP / code | stage | 확인할 부분 |
| --- | --- | --- |
| 503 `GITHUB_NOT_CONFIGURED` | `configuration` | 필수 값 누락·빈 문자열·공백만 있는 값 |
| 503 `GITHUB_CONFIG_INVALID` | `configuration` | ID·저장소 경로·환경변수 타입 |
| 503 `GITHUB_KEY_INVALID` | `key_parse` | PEM 정규화·헤더·키 파싱·RSA 키 종류 |
| 503 `GITHUB_JWT_SIGNING_FAILED` | `jwt_sign` | JWT 인코딩·PKCS#8 DER 내보내기·WebCrypto importKey/sign. 안전하게 분류한 errorName/errorCode로 런타임 오류 확인 |
| 502 `GITHUB_ERROR` | `github_api` | `upstreamStatus` 확인: 401은 App ID·키·JWT 시간, 403은 권한·설치 상태·제한, 404는 설치/저장소/브랜치 접근, 422는 토큰 범위·요청 내용 등을 점검 |
| 502 `GITHUB_NETWORK_ERROR` / 504 `GITHUB_TIMEOUT` | `github_api` | 연결·타임아웃 실패 |
| 502 `GITHUB_RESPONSE_INVALID` | `github_api` | JSON 본문 읽기/해석 실패 또는 토큰 누락 |
| 503 `SUBMISSION_METADATA_SIGNING_FAILED` | `metadata_sign` | PR 메타데이터 HMAC의 WebCrypto `importKey`·`sign` 실패 |

`SUBMISSION_METADATA_SECRET`나 `DB`가 아예 없으면 공통 rate-limit 미들웨어가 접수 처리보다 먼저 `503 SECURITY_UNAVAILABLE`을 반환합니다. D1 장애 등 분류되지 않은 내부 오류의 `503 SERVICE_UNAVAILABLE`은 유지합니다. 응답 코드로 원인을 좁히고, PR 생성 도중 실패했다면 재제출 전에 기존 브랜치/PR을 확인하세요.

회귀 테스트 `node --test tests/github-auth.test.mjs tests/github.test.mjs`는 임시 생성 키와 모의 GitHub 응답만 사용하여 PEM 형식별 실제 RSA 공개키 서명 검증, 키·서명·통신 실패 분류, `/api/submit`→미들웨어 응답 및 비밀값 비노출을 검사합니다. Node의 sign이 실패하도록 설정해도 JWT가 생성되는지, byteOffset이 있는 Buffer/Uint8Array의 DER 구간만 가져오는지, 예외 name/code에 비밀값이 들어 있어도 차단하는지도 확인합니다. 운영 점검은 새 Production 배포 후 동의가 있는 유효한 제출로 `201`과 PR 접수번호를 확인하고, 운영자가 PR 서명 검증까지 확인합니다. `/api/health` 성공만으로 GitHub App 연결이 검증되지는 않습니다.

## 동의·Retention 변경 배포 순서

문의 기능에는 `0004_feedback.sql`도 필요합니다. Git 연동만 사용하고 Actions에 Cloudflare 토큰이 없으면 **병합 전에** 원격 마이그레이션을 수동 적용합니다. 토큰이 있는 릴리즈는 마이그레이션 성공 후 `production` 브랜치를 갱신합니다. 문의 180일 삭제가 무요청 기간에도 동작하려면 새 `lib/retention.js`가 포함된 Cron Worker도 배포합니다.

기존 운영 환경에는 **Pages 새 코드 배포 전에** 아래 D1 마이그레이션을 적용합니다. 이어서 이 변경을 포함한 Pages를 배포하고 Cron Worker를 배포합니다. 기존 Git 연동에서는 PR 병합 후 릴리즈 작업이 갱신하는 production 브랜치가 Pages 배포 대상입니다.

```sh
pnpm exec wrangler d1 migrations apply DB --remote -c wrangler.jsonc
# 이 변경을 포함한 Pages 배포 후:
pnpm exec wrangler deploy -c wrangler.retention.jsonc
```

- `0003_consent_retention.sql`은 기존 expires_at을 NULL로 바꾸고, last_used_at을 동의 시각과 마지막 다운로드 시각 중 최신 값으로 채웁니다. 기존 약관 버전·철회·자동 업로드 선택은 그대로이며 약관 2026-11-17.6에는 재동의가 필요합니다. 이전 시스템이 검증 시각을 기록하지 않았으므로 과거 활동은 이 두 기록으로만 복원합니다.
- `workers/retention-cron/index.js`는 Pages와 같은 D1을 직접 정리합니다. `0 19 * * *`는 UTC 19시, 한국시간 매일 새벽 4시입니다. HTTP 공개 경로와 별도 인증 Secret은 사용하지 않습니다.
- Pages의 POST 요청은 요청 처리 후 Lazy Cleanup을 예약합니다. Cron·Lazy·수동 정리는 `lib/retention.js`와 `retention_state`를 공유하여 성공한 정리 간 최소 24시간을 지킵니다. 최근 활동을 먼저 갱신하며, 실행 식별자 획득과 모든 삭제가 하나의 D1 batch 트랜잭션이므로 동시 요청은 한 번만 정리하고 실패 시 타임스탬프도 롤백합니다. Lazy 오류는 원래 API 응답을 바꾸지 않고 다음 요청에서 재시도합니다. Cron 오류는 실패 실행으로 기록됩니다.
- 철회 180일 경과 및 미철회·최근 활동 180일 경과 동의는 자식 로그·이력을 먼저 삭제한 뒤 제거합니다. 최근 활동한 동의는 유지하되 오래된 IP·User-Agent는 지웁니다. 누적 item_stats는 변경하지 않습니다. 단순 공개 열람은 동의 활동 시각을 갱신하지 않습니다.
- `GET /api/health`의 `retentionLastRunAt`으로 마지막 성공 시각을 확인합니다. 아직 실행되지 않았으면 null이며, 매일 정리가 실행되는지는 Worker의 Scheduled/Observability 기록과 함께 확인합니다. Cron이 아직 배포되지 않아도 Pages POST 요청이 정리를 수행하지만 요청이 전혀 없는 기간에는 Cron이 필요합니다.

로컬 검증:

```sh
node scripts/build.mjs
node --test tests/*.test.mjs
pnpm exec wrangler d1 migrations apply DB --local -c wrangler.jsonc
pnpm exec wrangler pages functions build --outdir .wrangler/pages-check --compatibility-date 2026-11-17 --compatibility-flags nodejs_compat
pnpm exec wrangler deploy --dry-run -c wrangler.retention.jsonc
```

## 접수와 버전 자동화

운영 배포 워크플로는 이 저장소만 대상으로 하는 GitHub App 단기 토큰을 발급합니다. Actions 변수 `RELEASE_APP_ID`, 암호화 Secret `RELEASE_APP_PRIVATE_KEY`를 설정하고 일반 `GITHUB_TOKEN`은 읽기 권한으로 제한합니다. `main`의 PR·필수 검사(`validate`, `application-check`)·최신 main 반영·검토 대화 해결은 모든 변경에 적용하며, 승인 리뷰는 변경 경로에 따라 구분합니다.

- **사이트·GitHub 운영 변경**: 운영자가 자신의 PR을 검사 통과 후 추가 승인 리뷰 없이 병합합니다. 자동 생성 카탈로그 `recipes/index.json`도 여기에 포함됩니다.
- **신규 레시피·커넥터와 기존 항목 수정**: `recipes/`의 공통 코드 변경은 `.github/CODEOWNERS`에 지정된 운영자 `DDUBABA`의 승인 리뷰가 필요합니다. 새 커밋이 추가되면 재승인해야 합니다. 사이트 접수 API는 운영자 개인 토큰 대신 전용 GitHub App으로 PR을 작성하므로 운영자가 작성자와 별개로 승인할 수 있습니다. API는 PR 생성까지만 수행하며 자동 승인·병합하지 않습니다. 운영자 자신이 만든 항목도 사이트 접수 API를 이용합니다.

버전 확정 봇만 직접 쓰기 예외를 두고, `production`은 같은 봇만 업데이트할 수 있도록 별도 규칙을 적용합니다. 강제 푸시와 브랜치 삭제도 제한합니다. 봇 키를 교체하거나 접근을 철회할 때 Cloudflare와 Actions 두 저장 위치를 함께 관리하세요. 코드 소유자 지정은 병합 대상 브랜치의 파일을 기준으로 하므로, 새 보호 설정을 적용하기 전에 이 `CODEOWNERS`를 먼저 main에 반영해야 합니다.

Cloudflare의 프리뷰 접근 제한(Access)을 켜서 이전 배포의 해시 주소도 보호해야 합니다. 자동 프리뷰 생성 중지만으로는 기존 배포 주소가 차단되지 않습니다. API 코드도 현재 운영 origin만 허용합니다. `LOCAL_DEVELOPMENT=1`은 로컬 `.dev.vars`에서만 사용하며 운영 환경에는 등록하지 않습니다.

`POST /api/submit` 형식과 전체 동의 절차는 [guide.md](guide.md)를 따릅니다. API는 새 버전 입력을 거부하며 `baseVersion`, 공개용 `submittedBy`, `summary`, `type`, `meta`, `files`를 받습니다. 새 항목의 PR에는 임시 메타 `version:"1.0"`, `releases:[]`가 들어가지만, 릴리즈 전에는 사이트 카탈로그/번들에 노출되지 않습니다.

약관 `2026-11-17.6`의 동의 카드는 ‘동의하지 않음’과 ‘동의하고 이용’ 두 버튼만 제공합니다. ‘동의하고 이용’에는 규격·개인정보 제거 검증을 거친 공통 코드의 자동 업로드 허용이 포함됩니다. `POST /api/consent`는 `autoUploadAllowed`를 생략하면 `true`, 명시적으로 `false`를 보내면 `false`로 저장하고 반환합니다. 기존 동의 기록은 변경하지 않으며 이전 약관 이용자는 재동의해야 합니다. AI는 사용자의 자동 업로드 중지 요청을 로컬에 보존하고 재개 요청 전까지 제출하지 않아야 합니다. 실행 전 대상·권한·비용과 실행 후 실제 처리 결과를 확인할 최종 책임은 사용자에게 있습니다.

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
| `GET /api/consent/verify` | 동의 토큰·ID·최신 약관 버전·미철회 검증, last_used_at 갱신 |
| `POST /api/consent/revoke` | 토큰 소유 확인 후 동의 철회. 철회 180일 후 관련 기록 정리 |
| `GET /api/health` | DB 보안 스키마·현재 런타임 약관 상태 확인 |
| `GET /api/search` | 동의 없이 q, kind, category, authType, sort, limit 검색; blocked 제외 |
| `GET /api/items/:id` | 동의 없이 상세, README, requires, 릴리즈, 다운로드 수 열람 |
| `POST /api/download` | 동의 검증, D1 batch 로그+집계, JSON 번들 |
| `POST /api/submit` | 규격·PII·위험 코드·중복 검사 후 GitHub PR 접수 |
| `GET /api/stats` | items 공개, daily/versions/users 관리자 전용; format=json/csv, limit/offset |

동의 후 API 헤더는 `Authorization: Bearer <consentToken>`, `X-Consent-Id`, `X-Terms-Version`입니다. POST download/submit은 ID·버전을 본문에도 포함합니다. 관리자 통계 토큰은 Authorization에 단독 사용합니다. 타 출처 웹페이지 CORS는 허용하지 않으며 피클 서버/CLI의 직접 HTTP 요청은 지원합니다.

## 운영 경계

- 공개 GitHub 소스와 정적 전체 카탈로그는 직접 열람할 수 있습니다. **MIT 원본 접근까지 동의로 통제한다고 주장하지 않습니다.** 공개 검색·상세·항목별 통계 API는 동의 없이 이용하며 다운로드·제출 API는 동의를 검증합니다. 피클의 로컬 실행·예약 실행은 가이드 준수가 필요합니다. 로컬 실행 자체를 사이트 서버가 원격으로 차단할 수는 없습니다.
- `userIdentifier`는 자기 신고 식별자이며 실명·피클 계정 소유 증명이 아닙니다. 통계는 다운로드 요청 수이며 설치 완료·실사용·고유 인원 통계가 아닙니다. 개인 식별자를 임의로 쓰면 여러 사용자가 같은 집계에 나타날 수 있습니다.
- 개인정보/위험 코드 검사는 정규식과 AST 기반의 보조 검사로 완전한 검출을 보장하지 않습니다. 보수적으로 동적 실행·셸·역직렬화·난독화를 반려합니다. 운영자 코드 검토가 필수입니다. 서버와 CI는 커넥터 코드를 실행하지 않습니다.
- `lib/security.js`의 D1 원자적 카운터로 IP·토큰·전체 호출 제한을 적용합니다. 기본 120회/분/IP, 동의 5회/시간/IP, 제출 3회/시간/IP·토큰, 다운로드 30회/분/IP·토큰. 전체 API 600회/분, 동의 100회/시간, 제출 20회/시간입니다. 429 및 Retry-After를 반환합니다. IPv6는 /64로 묶고 카운터 키의 IP는 일별 HMAC으로 저장합니다. 이는 앱 수준의 남용 제한이며 대규모 네트워크 공격에 대한 별도 방어를 대체하지 않습니다.
- 약관·기록 정책을 바꾸면 `terms.json`과 `terms.html`의 버전을 함께 올려 배포합니다. 실제 운영자 연락 경로, 보유 기간, 국외 처리 고지 등은 실제 운영 방식에 맞춰 확정해야 합니다. 현재 문서는 구현된 동작을 설명하는 초기 운영 문안입니다.
- 동의는 약관 변경 또는 연결 해제(철회) 전까지 유효하며 고정 만료일은 없습니다. 다만 개인정보 보관을 최소화하기 위해 철회 후 180일이 지난 동의와 최근 활동(last_used_at) 기준 180일 이상 미사용한 미철회 동의는 식별자·토큰 해시·관련 동의 이력 및 다운로드 상세 기록과 함께 삭제합니다. 최근 활동한 미철회 동의는 유지합니다. 동의 기록의 IP·User-Agent와 개별 다운로드 상세 기록은 각 기록 시점부터 180일이 지나면 삭제하고, 항목별 누적 다운로드 수는 유지합니다. 서버의 일일 정리 또는 쓰기 요청 시 정리로 처리하며 정리 간격은 최소 24시간입니다. 삭제된 동의로 다시 다운로드·제출하려면 새 동의가 필요합니다. 백업의 이전 사본은 D1 복구 보관 기간 내에 남을 수 있으며 공개 PR 이력은 GitHub에 남습니다.
- `.github/workflows/operations.yml`은 health check 전용이며 정리 API를 호출하거나 정리용 Secret을 전달하지 않습니다. 데이터 정리는 Cloudflare 서버에서 처리합니다. 수동 운영 도구 `node scripts/operations.mjs --maintenance`와 서명된 `/api/admin/maintenance`는 호환 유지하며 같은 정리 함수와 24시간 간격을 적용합니다. 수동 호출은 기존 HMAC·5분 인증 시간·일회성 nonce가 필요합니다.

## 기술 참고 문서

- [Cloudflare Pages D1 바인딩](https://developers.cloudflare.com/pages/functions/bindings/)
- [D1 batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub Actions 토큰 권한](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- [MIT 라이선스](https://opensource.org/license/mit)

## 로그인 브릿지

[브릿지 목록](https://pickle-recipes.com/bridge/)과 `/bridge/index.json`에서 공통 로그인 설정을 찾습니다. 기존 `DDUBABA/pickle-loginbridge` 엔진과 3개 사이트 설정을 통합했으며 비밀값은 브라우저에서만 처리합니다. API 제출은 `type: "bridge"`, `files: {"sites/<siteId>.json": "JSON 문자열"}` 형식의 단일 JSON만 허용합니다. 세부 규격과 호스트 호환성은 [가이드](guide.md#9-로그인-브릿지-생성공개-제출), 운영 연결은 [브릿지 배포 문서](docs/bridge-deployment.md)를 참고하세요.
