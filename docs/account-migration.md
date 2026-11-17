# DDUBABA 계정과 문의 기능 운영

## 계정 전환

2026-11-17 GitHub 계정을 `DDUBABA`로 변경하고 기존 저장소 `DDUBABA/pickle-recipes`의 소유권과 연결을 확인했다. GitHub Emails의 **Keep my email addresses private**, **Block command line pushes that expose my email**을 모두 활성화했다.

저장소 로컬 Git 설정은 다음과 같다. noreply 주소는 계정 변경 후 GitHub Emails 화면에서 확인했다.

```text
origin=https://github.com/DDUBABA/pickle-recipes.git
user.name=DDUBABA
user.email=294371325+DDUBABA@users.noreply.github.com
user.useConfigOnly=true
```

전역 Git 설정과 기존 공유 커밋 이력은 변경하지 않는다. 과거 커밋에 포함된 이메일은 현재 작성자 설정으로 지워지지 않는다. `GIT_AUTHOR_EMAIL`·`GIT_COMMITTER_EMAIL` 환경변수는 로컬 설정보다 우선하므로 새 셸에서 별도로 지정하지 않는다. noreply는 문의 수신 주소가 아니다.

접수·릴리즈 GitHub App의 이름을 **Pickle Recipes DDUBABA**, 홈페이지를 `https://github.com/DDUBABA/pickle-recipes`로 갱신했다. 기존 App ID와 installation은 유지하며 키 재발급이나 권한 확대는 필요하지 않다. 접수 App과 Cloudflare App의 설치 대상에 새 저장소 경로가 표시되는 것을 확인했다.

## 배포 설정

| 위치 | 항목 | 값/유지 조건 |
| --- | --- | --- |
| `wrangler.jsonc` / Pages | `GITHUB_REPOSITORY` | `DDUBABA/pickle-recipes`. 대시보드에서 소스 관리 대상으로 표시되므로 코드 배포로 반영한다. |
| Pages | `GITHUB_DEFAULT_BRANCH` | `main` — 레시피 PR 대상 |
| Pages Git 연동 | Production branch / Build / Output | `production` / `node scripts/build.mjs` / `dist`. Preview 비활성화. |
| Pages | `NODE_VERSION`, `SKIP_DEPENDENCY_INSTALL` | `22`, `1`. 운영에 `LOCAL_DEVELOPMENT`를 설정하지 않는다. |
| Pages Secrets | `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` | 기존 App과 installation을 유지하므로 기존 값 유지 |
| Pages / Actions Secrets | `SUBMISSION_METADATA_SECRET` | 기존 값을 유지하고 양쪽 값이 일치하도록 관리 |
| Actions variables/secrets | `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY` | 기존 App 유지. owner는 `github.repository_owner`에서 읽음. |
| Actions Secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | 이미 설정된 경우에만 직접 배포 사용. GitHub 이름 변경 때문에 새 키를 만들 필요 없음. |
| Pages / Cron | `DB` | 기존 `pickle-recipes` D1 바인딩 유지 |
| Cron | `pickle-recipes-retention` | 매일 UTC 19:00 / 한국시간 04:00 실행, 공개 URL 비활성화 |

문의는 D1에 저장하며 GitHub App에 Issues 쓰기 권한을 요구하지 않는다. 공개 건의는 [GitHub Issues](https://github.com/DDUBABA/pickle-recipes/issues), 계정 없는 비공개 접수는 [웹 폼](https://pickle-recipes.pages.dev/#feedback) 또는 `POST /api/feedback`을 사용한다.

## 변경 배포 절차

운영 D1 마이그레이션을 **PR 병합과 Pages 배포 전에** 적용한다. 원격 작업은 Cloudflare 인증이 필요하다. 이 저장소에는 기존 동의 보관 정책 마이그레이션과 `0004_feedback.sql`이 포함되어 있다.

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote -c wrangler.jsonc
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote -c wrangler.jsonc
```

코드를 별도 브랜치에서 커밋·푸시하고 `main` 대상 PR의 `validate`·`application-check` 통과 후 병합한다. `output/`, `.local/`, `.dev.vars`, 빌드 결과와 테스트 DB는 커밋하지 않는다. 기존 공유 커밋을 다시 쓰거나 강제 푸시할 필요는 없다.

Actions **Release and build index**가 검증과 카탈로그 생성을 마친 뒤 `production` 브랜치를 갱신한다. Cloudflare 토큰이 Actions에 설정되어 있으면 D1 마이그레이션을 `production` 갱신 전에 실행한다. 토큰이 없으면 위 원격 마이그레이션을 별도로 완료해야 한다. Pages Git 연동이 `production`을 배포하며 직접 CLI 배포도 같은 브랜치를 사용한다.

보관 정책 변경 시 Cron Worker도 배포한다.

```powershell
node node_modules/wrangler/bin/wrangler.js deploy -c wrangler.retention.jsonc
```

배포 후 `/terms.json`의 `termsVersion=2026-11-17.6`, 하단 문의 링크, 익명 문의 폼의 접수를 확인한다. 새 약관 적용 후 다운로드·레시피 공유에는 재동의가 필요하며 문의에는 동의 토큰이 필요 없다. 테스트는 개인정보나 비밀이 없는 제목·내용으로 수행한다.

## 접수 확인과 보관

Cloudflare → D1 → pickle-recipes → Console에서 운영자 권한으로 조회한다.

```sql
SELECT feedback_id, category, title, content, submitted_by, created_at
FROM feedbacks ORDER BY created_at DESC LIMIT 100;
```

문의는 180일 후 삭제한다. 문의별 원문 IP·User-Agent·동의 토큰은 저장하지 않으며 읽기·수정 API는 공개하지 않는다. 접수번호가 반환되고 공개 이슈나 자동 답변은 생성되지 않는다. 개인정보·토큰 패턴 필터는 완전한 탐지를 보장하지 않으므로 접수 내용을 공개 이슈로 옮기기 전 운영자가 다시 확인한다.

## 검증

- 전체 Node 테스트 95개 통과. 입력 검증, 민감정보 차단, 원자적 레이트 리밋, 보관 정책, 폼 동작 회귀 테스트 포함.
- 카탈로그 검증·정적 빌드, Python AST·컴파일, Pages Functions 컴파일, Cron Worker dry-run 통과.
- 별도 로컬 D1에 0001~0004 마이그레이션 적용 성공.
- 로컬 Cloudflare HTTP에서 201 접수, 400 개인정보 차단, 403 외부 Origin, 405/Allow 비허용 메서드, 413 크기 제한, 429/Retry-After 확인. 끝 슬래시 유무가 같은 한도를 공유함.

계정 전환 관련 공식 참고: [GitHub 사용자 이름](https://docs.github.com/en/account-and-profile/reference/username-reference), [커밋 이메일](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address), [Cloudflare GitHub 연동](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).
