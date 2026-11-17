# 스마트싱스 기기제어

삼성 스마트싱스에 연결된 기기의 **상태를 읽고, 전원을 켜고 끄며, 차량 원격 시동과 스마트싱스 자체 자동 루틴·장면을 다루는** 커넥터입니다. 파이썬 표준 라이브러리만 쓰고, 서비스와는 `https://api.smartthings.com/v1` 로 직접 통신합니다.

이 문서는 피클 제작사와 무관한 비공식 Pickle Recipes 커뮤니티의 제출물입니다. 제작사의 공식 SDK나 공식 규격이 아니며, 게시물이 제작사의 검토·보증을 받았다는 뜻도 아닙니다.

## 개요

| 명령 | 하는 일 |
| --- | --- |
| `info` | 이 커넥터의 명세와 지금 상태(인증 키가 있는지)를 보여 줍니다. 인증 없이 동작하고 `--json`을 지원합니다. |
| `list` | 연결된 기기 목록 — 라벨, 방, 기기 id. `--caps`는 기기별 capability, `--cap <종류>`는 그 종류의 기기만, `--json`은 원본 |
| `status <기기명>` | 기기 하나의 상태 — 전원·밝기·온도·습도·문/창문·모션·재실·누수·공기질·조도·배터리·연결 상태·차량(시동·도어·창문·주행거리·경고). `--json`은 원본 상태 |
| `sensors` | 센서 값을 보고하는 기기를 한 줄씩 요약 (방별 온습도·문열림·누수·공기질·배터리) |
| `on-list` | 지금 켜져 있는 기기만 |
| `on <기기명>` / `off <기기명>` | 전원 켜기 / 끄기 |
| `start-engine <차량명>` | 차량 원격 시동 + 공조 (기본 24℃·10분, `--temp`·`--duration`) |
| `stop-engine <차량명>` | 원격 시동 끄기 |
| `rules` | 스마트싱스 자체 자동 루틴 목록 (이름·상태·조건→동작 요약). `--json`은 원본 |
| `rule-create <JSON>` | 자동 루틴 생성 (파일 또는 표준입력 `-`, `--dry-run`은 형식 검사만) |
| `rule-delete <rule_id>` | 자동 루틴 삭제 (대상 이름을 먼저 보여 주고 지움, `--dry-run`은 대상 확인만) |
| `scenes` / `scene-run <장면>` | 스마트폰 앱에서 만든 수동 루틴(장면) 목록 / 실행 (`--dry-run` 지원) |

`<기기명>`은 라벨 또는 이름의 **부분 일치**로 찾습니다(정확 일치 우선). 기기가 여러 개 걸리면 첫 항목을 쓰므로, 실행 전에는 `list`로 대상 라벨을 확인하는 편이 안전합니다.

값은 capability 이름을 그대로 노출하지 않고 한국어 항목으로 풀어 보여 줍니다. 값이 없는 항목은 `값 없음(기기 응답 없음)`, 연결이 끊긴 기기는 `오프라인`으로 표시해 **0이나 꺼짐으로 잘못 읽히지 않게** 했습니다. 상태 조회는 기기마다 1회 호출이라 스레드로 병렬 처리하고, 429(요청 과다)는 결과를 바꾸지 않는 GET·DELETE만 두 번까지 잠깐 쉬었다 다시 보냅니다.

**하지 못하는 일과 한계**

- 앱에서 만든 자동 루틴은 API로 조회·수정·삭제·실행할 수 없습니다. 앱에서 고쳐야 합니다.
- API로 만든 자동 루틴은 스마트폰 앱의 '루틴' 탭에 표시되지 않을 수 있습니다. 확인·삭제는 `rules`·`rule-delete` 또는 `my.smartthings.com/advanced`를 기준으로 하세요.
- 자동 루틴에서는 알림·질문을 보내거나 외부 서비스 조건을 쓸 수 없습니다. 그런 흐름은 이 커넥터가 아니라 예약 실행과 조합해야 합니다.
- 다루지 않는 범위: 밝기·색온도·조명 색 변경, 커튼 열림 정도(%), 공조 온도 세밀 조절, 기기 모드 전환.
- 규칙 실행 이력 조회는 지원되지 않습니다(403). 마지막 실행 시각으로만 확인합니다.
- 인증 키는 24시간마다 만료됩니다. 만료되면 401이 오고, 새 키를 받아야 합니다.
- 오프라인이거나 배터리가 떨어진 센서는 마지막 값만 남아 있습니다. 그 값을 현재 상태로 단정하지 마세요.
- 스마트싱스가 capability 이름을 바꾸면 명령이 거절될 수 있습니다.

**종료 코드** — `0` 성공 · `2` 사용법·입력 오류 · `3` 인증·설정 없음(401 포함) · `1` 그 밖의 실행 실패

## 필요한 커넥터

없습니다. 이 항목은 커넥터(`kind: connector`, `requires: []`)입니다.

`rules`·`rule-create`로 만드는 자동 루틴은 **스마트싱스 클라우드(가능하면 허브)가 직접 실행**하므로, 이 커넥터가 계속 돌 필요도 없고 다른 커넥터도 필요하지 않습니다. 여러 커넥터를 묶는 레시피에서 쓸 때는 이 커넥터 id `smartthings-device-control`을 `requires`에 넣고, 레시피 README에 실행 순서를 적으세요.

## 설정

**1. 인증 키 발급 (사용자 본인)**

1. `https://account.smartthings.com` 에 로그인
2. **Personal access tokens** → **Generate new token**
3. 권한(scope)은 필요한 것만 최소로: `devices`(조회·제어), `locations`, `scenes`(조회·실행), `rules`(조회·생성·삭제)
4. **유효기간 24시간** — 2024년 12월 30일 이후 발급되는 키는 24시간만 유효합니다. 하루가 지나 401이 오면 새로 받아야 합니다.

**2. 인증 키를 두는 곳 (셋 중 하나, 읽는 순서: 실행 인자 → 환경변수 → 파일)**

| 방법 | 예 | 비고 |
| --- | --- | --- |
| 파일 (권장) | `~/.config/smartthings/token` | 키 문자열 한 줄 또는 `{"token": "..."}` JSON. 폴더 700, 파일 600 |
| 환경변수 | `SMARTTHINGS_TOKEN` | 셸 기록에 남지 않게 주의 |
| 인자 | `--token <키>` (`--token`은 하위 명령 **앞**에) | 셸 기록·프로세스 목록에 남으므로 권장하지 않음 |

```bash
mkdir -p ~/.config/smartthings && chmod 700 ~/.config/smartthings
printf '%s' '발급받은키' > ~/.config/smartthings/token
chmod 600 ~/.config/smartthings/token
```

`~/.config/smartthings/config.json` 에 같은 형식으로 두어도 읽습니다. 휴대폰에서 발급했다면 커뮤니티의 로그인 브릿지 `https://pickle-loginbridge--smartthings-pat.pages.dev/` 에서 `smartthings_config.json` 파일로 내려받아 위 자리에 그대로 두어도 됩니다(입력한 값은 서버로 보내지 않고 브라우저 안에서만 파일을 만듭니다). 이 경로들은 **이 커뮤니티의 로컬 저장 규칙**이며 제작사의 공식 경로가 아닙니다.

**3. 프로필 파일 (선택, 비밀 아닌 값만)**

홈(위치)이 여러 개인 계정에서 기본 홈을 정해 두고 싶을 때만 씁니다. `~/.config/pickle-profile/profile.json` 을 가장 먼저 확인합니다.

```json
{
  "smartthings": {
    "default_location": "홈 이름 또는 locationId"
  }
}
```

- 프로필 파일은 **읽기만** 하고, 없거나 깨져 있으면 조용히 무시합니다.
- **인증 키나 실제 개인정보 값을 프로필 파일에 넣지 마세요.** 인증 키는 위 2번의 보안 보관 위치에만 둡니다.
- 기기 이름·방 이름은 프로필에 저장하지 않고, 실행할 때마다 계정에서 읽어 옵니다.

**4. 24시간 만료 대응**

자주 쓰는 환경이라면 만료 전에 새 키를 받아 두는 예약 실행과 함께 쓰는 편이 좋습니다. 이 커넥터 자체는 예약을 만들지 않습니다.

## 실행

```bash
# 인증 없이 명세와 상태 확인
python scripts/smartthings_control.py info
python scripts/smartthings_control.py info --json

# 기기 목록 / 기기별 capability / 특정 종류만 (예: 문·창문 센서)
python scripts/smartthings_control.py list
python scripts/smartthings_control.py list --caps
python scripts/smartthings_control.py list --cap contactSensor

# 상태 조회 — 전원·온습도·문열림·모션·누수·공기질·배터리·차량
python scripts/smartthings_control.py status 현관등
python scripts/smartthings_control.py status 현관등 --json

# 센서 요약 / 지금 켜져 있는 기기
python scripts/smartthings_control.py sensors
python scripts/smartthings_control.py on-list

# 전원 제어 (라벨은 list 결과에서 확인)
python scripts/smartthings_control.py on 현관등
python scripts/smartthings_control.py off 현관등

# 차량 원격 시동 + 공조 (온도·유지 분 지정)
python scripts/smartthings_control.py start-engine 내차량 --temp 22 --duration 10
python scripts/smartthings_control.py stop-engine 내차량

# 자동 루틴 목록 / 삭제
python scripts/smartthings_control.py rules
python scripts/smartthings_control.py rule-delete <rule_id> --dry-run

# 자동 루틴 만들기 — 먼저 --dry-run으로 형식 확인
python scripts/smartthings_control.py rule-create rule.json --dry-run
python scripts/smartthings_control.py rule-create rule.json

# 수동 루틴(장면) 목록 / 실행 (이름이 정확히 하나로 정해질 때만 실행)
python scripts/smartthings_control.py scenes
python scripts/smartthings_control.py scene-run 외출 --dry-run

# 홈이 여러 개일 때 — 이름 또는 id로 지정
python scripts/smartthings_control.py rules --loc "우리집"
```

자동 루틴 JSON의 최소 형태는 아래와 같습니다(`DEVICE_ID`는 `list --json`에서 확인한 값으로 바꿔 쓰세요).

```json
{
  "name": "평일 아침 조명 켜기",
  "actions": [
    {
      "if": {
        "and": [
          { "every": { "specific": { "atTime": "07:00", "daysOfWeek": ["Mon", "Tue", "Wed", "Thu", "Fri"] } } },
          { "equals": {
              "left":  { "device": { "deviceId": "DEVICE_ID", "component": "main", "capability": "switch", "attribute": "switch" } },
              "right": { "string": "off" } } }
        ]
      },
      "then": [
        { "command": { "device": { "deviceId": "DEVICE_ID", "component": "main", "capability": "switch", "command": "on" } } }
      ]
    }
  ]
}
```

- 요일은 **`daysOfWeek`(복수형)** 입니다. `dayOfWeek`·`weekdays`·`days`로 쓰면 `Unrecognized field`로 거절됩니다. 값은 `["Mon","Tue","Wed","Thu","Fri"]` 처럼 씁니다.
- 되돌릴 수 없거나 위험한 동작(차량 시동, 도어 잠금 해제, 밸브, 난방, 의료기기)은 자동 루틴으로 만들지 마세요.
- 실행 전에 조건·동작·대상 기기를 사용자에게 보여 주고 승인을 받은 뒤 `--dry-run` 없이 실행하세요.
- 이 커뮤니티 자료를 실행하기 직전에는 커뮤니티의 최신 약관 동의를 다시 검증해야 합니다.

`--json`은 `info`·`list`·`status`·`rules`·`scenes`에서 기계가 읽는 표준 출력을 냅니다. 그 밖의 명령은 사람이 읽는 요약을 출력합니다.

## 개인정보 보호

- 이 커넥터의 **코드와 문서에는 전화번호·이메일·주민번호·차량번호·주소·동호수·토큰·개인 로컬 경로가 들어 있지 않습니다.** 개인 값은 실행 시점에 사용자 환경에서만 읽습니다.
- 인증 키는 출력하지 않습니다. `info`는 키가 **있는지**와 어디서 읽었는지만 보여 줍니다. 오류 메시지에도 키 값을 넣지 않습니다.
- 인증 키는 실행 인자·환경변수·`~/.config/smartthings/` 파일에서만 읽고, 어떤 서버로도 보내지 않습니다(요청 대상은 `api.smartthings.com` 하나입니다).
- 기기 이름·방 이름·상태 값은 계정에서 읽은 실제 값입니다. 그 출력을 그대로 공개 게시물이나 PR 본문에 붙이지 마세요.
- 프로필 파일은 선택 사항이며 읽기만 합니다. 업로드·수정하지 않습니다.
- 업데이트는 공통 코드만 교체하고, 사용자의 `~/.config/` 설정·예약·보안 보관소는 건드리지 않습니다.
- 전원 끄기·차량 시동·장면 실행·루틴 생성/삭제처럼 사용자 환경을 바꾸는 동작은 실행 전에 대상과 영향을 알리고 승인을 받은 뒤 실행하세요. 실행 뒤에는 실제 처리 결과(성공 여부·남은 상태)를 사용자가 직접 확인해야 하며, 이용 결과에 대한 책임은 사용자 본인에게 있습니다.
- 자동 업로드(이 커뮤니티로의 제출)는 사용자가 동의한 범위에서만 이뤄지며, 중지를 요청하면 즉시 멈춥니다.

## 변경 이력

- **1.0** (2026-11-17) — 최초 등록. 기기 목록·상태·센서 요약, 전원 켜기/끄기, 차량 원격 시동·공조, 자동 루틴 목록·생성·삭제, 장면 목록·실행. 표준 라이브러리만 사용하며 `info --json`으로 명세를 노출합니다.
