#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
[커넥터] 스마트싱스 기기제어 — 기기 상태 조회·전원 제어·차량 시동·자동 루틴·장면
비공식 Pickle Recipes 커뮤니티(피클 제작사와 무관)에 공유하는 커넥터입니다. 표준 라이브러리만 씁니다.
대상: 삼성 스마트싱스에 기기를 등록해 쓰는 계정
하는 일: 기기 목록·상태·센서 요약, 전원 켜기/끄기, 차량 원격 시동, 자동 루틴(스마트싱스가 직접 실행) 만들기·지우기, 장면 실행

개인정보를 읽는 곳: 실행 인자 → 환경변수 → ~/.config/smartthings/ 설정 파일
  · --token <인증 키>
  · SMARTTHINGS_TOKEN 환경변수
  · ~/.config/smartthings/token (키 문자열 한 줄, 또는 브릿지가 준 {"token": "..."} JSON)
  · ~/.config/smartthings/config.json (같은 형식)
저장 위치: 인증 키는 ~/.config/smartthings/ 에만 둡니다(폴더 700, 파일 600).

[인증 키 발급] https://account.smartthings.com → Personal access tokens (24시간마다 만료)
  휴대폰에서 옮기려면 피클 로그인 브릿지 https://pickle-loginbridge--smartthings-pat.pages.dev/
  에서 smartthings_config.json 을 받아 위 token 파일 자리에 두면 됩니다(내용이 JSON이어도 읽습니다).

[자동 루틴(Rules)이란]
스마트싱스 계정에 저장되어 스마트싱스 클라우드(또는 허브)가 직접 실행하는 자동화입니다.
피클을 거치지 않으므로 피클 사용 한도를 쓰지 않고, 24시간 인증 키가 만료돼도 계속 동작합니다.
API로 만든 루틴은 스마트폰 앱의 '루틴' 탭에는 표시되지 않습니다(이 스크립트 또는 my.smartthings.com/advanced에서 관리).

[종료 코드] 0 성공 · 2 사용법·입력 오류 · 3 인증·설정 파일 없음 · 1 그 밖의 실행 실패
[명세] 'info' — 인증 없이 이 설명과 지금 상태를 보여 줍니다. 'info --json'은 기계가 읽는 형식.
"""

import sys
import os
import json
import time
import argparse
import datetime
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "https://api.smartthings.com/v1"
VERSION = "1.0"
TOKEN_PATH = os.path.expanduser("~/.config/smartthings/token")
CONFIG_PATH = os.path.expanduser("~/.config/smartthings/config.json")
PROFILE_PATH = os.path.expanduser("~/.config/pickle-profile/profile.json")


class AuthError(RuntimeError):
    """인증·설정이 없거나 만료됨 → 종료 코드 3."""


class UsageError(RuntimeError):
    """사용법·입력 오류 → 종료 코드 2."""

# ---------------------------------------------------------------- 값 표시 규칙

STATE_TEXT = {
    "on": "켜짐",
    "off": "꺼짐",
    "open": "열림",
    "closed": "닫힘",
    "active": "감지됨",
    "inactive": "감지 없음",
    "wet": "물 감지",
    "dry": "정상(물 없음)",
    "present": "재실(사람 있음)",
    "not present": "비재실(사람 없음)",
    "locked": "잠김",
    "unlocked": "잠금 해제",
    "online": "정상 연결",
    "offline": "오프라인",
    "good": "좋음",
    "moderate": "보통",
    "unhealthy": "나쁨",
    "very unhealthy": "매우 나쁨",
    "hazardous": "위험",
    "none": "없음",
    "running": "작동 중",
    "stopped": "정지",
    "idle": "대기",
    "unknown": "알 수 없음",
}

# capability -> [(속성, 표시 이름)] — 사람이 읽는 상태 요약에 쓰는 주요 항목
STATUS_FIELDS = [
    ("switch", [("switch", "전원")]),
    ("switchLevel", [("level", "밝기(%)")]),
    ("temperatureMeasurement", [("temperature", "온도")]),
    ("relativeHumidityMeasurement", [("humidity", "습도")]),
    ("contactSensor", [("contact", "문·창문")]),
    ("motionSensor", [("motion", "모션")]),
    ("presenceSensor", [("presence", "재실 감지")]),
    ("waterSensor", [("water", "누수")]),
    ("smokeDetector", [("smoke", "연기")]),
    ("carbonMonoxideDetector", [("carbonMonoxide", "일산화탄소")]),
    ("illuminanceMeasurement", [("illuminance", "조도(lux)")]),
    ("battery", [("battery", "배터리")]),
    ("powerMeter", [("power", "소비전력(W)"), ("energy", "누적전력(kWh)")]),
    ("airQualitySensor", [("airQuality", "공기질")]),
    ("dustSensor", [("dustLevel", "미세먼지(PM10)"), ("fineDustLevel", "초미세먼지(PM2.5)")]),
    ("veryFineDustSensor", [("veryFineDustLevel", "초미세먼지(PM2.5)")]),
    ("odorSensor", [("odorLevel", "냄새")]),
    ("dustHealthConcern", [("dustHealthConcern", "먼지 건강지수")]),
    ("fineDustHealthConcern", [("fineDustHealthConcern", "미세먼지 건강지수")]),
    ("veryFineDustHealthConcern", [("veryFineDustHealthConcern", "초미세먼지 건강지수")]),
    ("samsungce.airQualityHealthConcern", [("airQualityHealthConcern", "공기질 건강지수")]),
    ("valve", [("valve", "밸브")]),
    ("lock", [("lock", "잠금")]),
    ("doorControl", [("door", "문")]),
    ("windowShade", [("windowShade", "블라인드·커튼")]),
    ("vehicleEngine", [("engineState", "시동")]),
    ("vehicleDoorState", [("lockState", "도어 잠금")]),
    ("vehicleRange", [("estimatedRemainingRange", "주행 가능 거리(km)")]),
    ("vehicleOdometer", [("odometerReading", "주행거리(km)")]),
    ("vehicleHvac", [("hvacState", "공조"), ("temperature", "설정 온도(°C)")]),
    ("healthCheck", [("DeviceWatch-DeviceStatus", "연결 상태")]),
]

# 요약·센서 목록에서 "상태 기기"로 볼 capability
SENSOR_CAPABILITIES = [
    "temperatureMeasurement",
    "relativeHumidityMeasurement",
    "contactSensor",
    "motionSensor",
    "presenceSensor",
    "waterSensor",
    "smokeDetector",
    "carbonMonoxideDetector",
    "illuminanceMeasurement",
    "airQualitySensor",
    "dustSensor",
    "veryFineDustSensor",
    "odorSensor",
    "battery",
]


def _token_from_file(path):
    """키 한 줄, 또는 브릿지가 주는 {"token": "..."} JSON 둘 다 읽습니다."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
    except Exception:
        return None
    if not raw:
        return None
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
        except Exception:
            return None
        for key in ("token", "access_token", "accessToken", "pat", "key"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
    return raw


def load_profile():
    """비밀이 아닌 개인 설정. 없거나 읽을 수 없으면 빈 사전을 돌려주고 값을 출력하지 않습니다."""
    try:
        with open(PROFILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def profile_default_location():
    """프로필의 smartthings.default_location (홈 이름 또는 ID). 없으면 None."""
    section = load_profile().get("smartthings")
    if isinstance(section, dict):
        value = section.get("default_location")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_token(cli_token=None):
    if cli_token:
        return cli_token.strip()
    env_token = os.environ.get("SMARTTHINGS_TOKEN")
    if env_token:
        return env_token.strip()
    return _token_from_file(TOKEN_PATH) or _token_from_file(CONFIG_PATH)


def token_state():
    """어디에서 키를 읽을 수 있는지만 확인합니다. 값은 보여 주지 않습니다."""
    if os.environ.get("SMARTTHINGS_TOKEN"):
        return {"source": "환경변수", "available": True, "path": "SMARTTHINGS_TOKEN"}
    for path in (TOKEN_PATH, CONFIG_PATH):
        if _token_from_file(path):
            return {"source": "설정 파일", "available": True, "path": path}
    return {"source": "없음", "available": False, "path": TOKEN_PATH}


def api_request(endpoint, token, method="GET", data=None, _retries=0):
    url = f"{BASE_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        # 호출이 몰리면 429(요청 과다)가 온다. 결과를 바꾸지 않는 GET·DELETE만 잠깐 쉬었다 다시 보낸다.
        if e.code == 429 and method in ("GET", "DELETE") and _retries < 2:
            time.sleep(5 if _retries == 0 else 15)
            return api_request(endpoint, token, method=method, data=data, _retries=_retries + 1)
        try:
            return {"error": json.loads(err_body), "status": e.code}
        except Exception:
            return {"error": err_body, "status": e.code}


def check_response(res, what="API 요청"):
    """오류 응답이면 예외로 알린다 (401은 대개 PAT 만료·권한 부족)."""
    if isinstance(res, dict) and "error" in res:
        status = res.get("status")
        hint = ""
        if status == 401:
            raise AuthError(
                f"{what} 실패 (HTTP 401) — 인증 키가 만료되었거나 권한이 부족합니다. "
                "새 인증 키를 받아 ~/.config/smartthings/token 에 두어 주세요."
            )
        raise RuntimeError(f"{what} 실패 (HTTP {status}): {res.get('error')}")
    return res


def get_devices(token):
    res = check_response(api_request("/devices", token), "기기 목록 조회")
    return res.get("items", [])


def find_device(token, query):
    devices = get_devices(token)
    exact_matches = []
    partial_matches = []
    q = query.strip().lower()
    for d in devices:
        label = (d.get("label") or "").lower()
        name = (d.get("name") or "").lower()
        if q == label or q == name:
            exact_matches.append(d)
        elif q in label or q in name:
            partial_matches.append(d)
    return exact_matches or partial_matches


def get_room_map(token):
    """roomId -> (위치 이름, 방 이름). 권한이 없거나 방을 쓰지 않으면 빈 사전."""
    rooms = {}
    try:
        locations = api_request("/locations", token).get("items", []) or []
    except Exception:  # noqa: BLE001
        return rooms
    for loc in locations:
        loc_id = loc.get("locationId")
        if not loc_id:
            continue
        try:
            res = api_request(f"/locations/{loc_id}/rooms", token)
        except Exception:  # noqa: BLE001
            continue
        for room in (res.get("items") or []):
            if room.get("roomId"):
                rooms[room["roomId"]] = (loc.get("name"), room.get("name"))
    return rooms


def room_suffix(device, rooms, multi_location=False):
    if not rooms:
        return ""
    loc_name, room_name = rooms.get(device.get("roomId"), (None, None))
    if not room_name:
        return ""
    return f" [{loc_name}/{room_name}]" if multi_location else f" [{room_name}]"


def device_capabilities(device):
    """기기의 capability id 집합 (구성요소 전체 합집합)."""
    caps = set()
    for comp in device.get("components", []) or []:
        for cap in comp.get("capabilities", []) or []:
            if cap.get("id"):
                caps.add(cap["id"])
    return caps


def get_status(token, device_id):
    return check_response(api_request(f"/devices/{device_id}/status", token), "기기 상태 조회")


def get_status_safe(token, device):
    """여러 기기를 한꺼번에 볼 때 한 기기의 오류가 전체를 멈추지 않게 한다."""
    try:
        return get_status(token, device["deviceId"])
    except Exception as e:  # noqa: BLE001
        return {"error": {"message": str(e)}, "status": "client_error"}


def fetch_statuses(token, devices, workers=8):
    """상태 조회는 기기마다 1회 호출이라 병렬로 돌린다."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        statuses = list(pool.map(lambda d: get_status_safe(token, d), devices))
    return list(zip(devices, statuses))


def get_main(status):
    if not isinstance(status, dict):
        return {}
    return (status.get("components") or {}).get("main") or {}


def fmt_value(raw):
    if isinstance(raw, bool):
        return "예" if raw else "아니오"
    if isinstance(raw, float):
        if raw.is_integer():
            return str(int(raw))
        return f"{raw:.1f}"
    if isinstance(raw, int):
        return str(raw)
    text = STATE_TEXT.get(str(raw).strip().lower())
    return text if text is not None else str(raw)


def attr_value(main, capability, attr):
    """속성 값. 값이 없으면 (False, None), 있으면 (True, 값)."""
    cap = main.get(capability)
    if not isinstance(cap, dict):
        return False, None
    field = cap.get(attr)
    if not isinstance(field, dict):
        return False, None
    return True, field.get("value")


def open_items(main, capability, suffixes):
    """도어·창문처럼 여러 항목이 한 capability에 들어 있는 경우 열린 것만 골라낸다."""
    cap = main.get(capability)
    if not isinstance(cap, dict):
        return None
    opened = []
    for attr, field in cap.items():
        if not isinstance(field, dict):
            continue
        if not any(attr.endswith(s) for s in suffixes):
            continue
        if str(field.get("value", "")).lower() in ("open", "opening", "ajar"):
            opened.append(attr)
    return opened


def describe_status(status):
    """상태 JSON -> [(표시 이름, 값 텍스트)] 목록. 읽을 수 있는 값만 담는다."""
    main = get_main(status)
    rows = []
    seen = set()
    for capability, fields in STATUS_FIELDS:
        cap = main.get(capability)
        if not isinstance(cap, dict):
            continue
        for attr, label in fields:
            if label in seen:
                continue
            present, raw = attr_value(main, capability, attr)
            if raw is None:
                rows.append((label, "값 없음(기기 응답 없음)"))
            else:
                text = fmt_value(raw)
                if capability == "vehicleEngine" and attr == "engineState":
                    text = {"running": "시동 걸림", "stopped": "시동 꺼짐"}.get(str(raw).strip().lower(), text)
                if attr == "temperature" and capability == "temperatureMeasurement":
                    text = f"{text}°C"
                elif attr == "humidity":
                    text = f"{text}%"
                elif attr == "battery":
                    text = f"{text}%"
                    try:
                        if float(raw) <= 20:
                            text += " (배터리 부족)"
                    except (TypeError, ValueError):
                        pass
                elif attr in ("dustLevel", "fineDustLevel", "veryFineDustLevel", "airQuality", "odorLevel"):
                    text += " (1 좋음 ~ 5 나쁨)"
                rows.append((label, text))
            seen.add(label)

    doors = open_items(main, "vehicleDoorState", ["Door"])
    if doors is not None:
        rows.append(("열린 도어", ", ".join(doors) if doors else "모두 닫힘"))
    windows = open_items(main, "vehicleWindowState", ["Window"])
    if windows is not None:
        rows.append(("열린 창문", ", ".join(windows) if windows else "모두 닫힘"))

    warnings = main.get("vehicleWarning")
    if isinstance(warnings, dict):
        bad = []
        for attr, field in warnings.items():
            if not isinstance(field, dict):
                continue
            value = field.get("value")
            if isinstance(value, (list, dict)) or value is None:
                continue
            text = str(value).strip().lower()
            if text in ("", "normal", "none", "ok"):
                continue
            bad.append(f"{attr}={text}")
        if bad:
            rows.append(("차량 경고", ", ".join(sorted(bad))))
    return rows


def is_offline(status):
    present, raw = attr_value(get_main(status), "healthCheck", "DeviceWatch-DeviceStatus")
    return present and str(raw).lower() == "offline"


def status_summary(status):
    """한 줄 요약 (센서·전원 목록용)."""
    if isinstance(status, dict) and "error" in status:
        return "상태 조회 실패"
    parts = []
    for label, text in describe_status(status):
        if label == "연결 상태" or text.startswith("값 없음"):
            continue
        parts.append(f"{label} {text}")
    if is_offline(status):
        parts.append("오프라인")
    return " · ".join(parts) if parts else "표시할 상태 값 없음"


def send_command(token, device_id, capability, command, args=None):
    payload = {
        "commands": [
            {
                "component": "main",
                "capability": capability,
                "command": command,
                "arguments": args or []
            }
        ]
    }
    return check_response(api_request(f"/devices/{device_id}/commands", token, method="POST", data=payload), "명령 전송")


def switch_device(token, device_id, state):
    command = "on" if state.lower() in ("on", "1", "켜기", "켜줘", "켜") else "off"
    return send_command(token, device_id, "switch", command)


def control_vehicle_engine(token, device_id, start=True, duration=10, temp=24):
    """차량 원격 시동 및 공조 제어"""
    if start:
        r1 = send_command(token, device_id, "vehicleEngine", "startEngine")
        r2 = send_command(token, device_id, "vehicleHvacRemoteSwitch", "on", [
            {"ignitionDuration": duration, "temperature": {"value": temp, "unit": "C"}, "defog": "off"}
        ])
        return {"engine": r1, "hvac": r2}
    else:
        r1 = send_command(token, device_id, "vehicleEngine", "stopEngine")
        r2 = send_command(token, device_id, "vehicleHvacRemoteSwitch", "off")
        return {"engine": r1, "hvac": r2}


def device_label(device):
    return device.get("label") or device.get("name")


# ------------------------------------------------- 자동 루틴(Rules)·수동 루틴(Scenes) 공통

UNIT_KR = {"second": "초", "minute": "분", "hour": "시간", "day": "일", "week": "주"}

REFERENCE_KR = {"now": "지금", "sunrise": "일출", "sunset": "일몰", "noon": "정오", "midnight": "자정"}

# 자정 기준 분으로 계산할 수 있는 기준 시각 (일출·일몰은 날짜마다 달라 계산하지 않는다)
REFERENCE_MINUTE = {"midnight": 0, "noon": 12 * 60}

RULE_STATUS_KR = {"enabled": "사용 중", "disabled": "중지됨"}

# 규칙의 요일 (Rules API는 영문 3자 코드를 쓴다)
DAY_KR = {"sun": "일", "mon": "월", "tue": "화", "wed": "수", "thu": "목", "fri": "금", "sat": "토"}
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

# 위치(홈) 속성 이름 → 한국어 (Rules API의 location.attribute 12종)
LOCATION_ATTR_KR = {
    "temperaturec": "실외 기온(℃)",
    "temperaturef": "실외 기온(℉)",
    "temperature": "실외 기온",
    "humidity": "실외 습도",
    "finedust": "미세먼지(PM10)",
    "finedustindex": "미세먼지 지수",
    "ultrafinedust": "초미세먼지(PM2.5)",
    "ultrafinedustindex": "초미세먼지 지수",
    "weather": "실외 날씨",
    "weatheralertseverity": "기상특보 등급",
    "security": "보안 상태",
    "mode": "홈 모드",
}

# 속성 이름을 한국어로 (상태 요약과 같은 표를 재사용)
ATTR_LABEL = {}
for _cap, _fields in STATUS_FIELDS:
    for _attr, _label in _fields:
        ATTR_LABEL.setdefault(_attr, _label)


def fmt_iso(value):
    """ISO 8601 문자열 -> 로컬 시간 문자열."""
    if not value:
        return "-"
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return str(value)


def fmt_epoch_ms(value):
    """밀리초 단위 타임스탬프 -> 로컬 시간 문자열."""
    try:
        return datetime.datetime.fromtimestamp(int(value) / 1000).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError, OSError):
        return str(value)


def get_locations(token):
    return check_response(api_request("/locations", token), "홈(위치) 목록 조회").get("items") or []


def resolve_location(token, query=None):
    """홈(위치) 하나를 고른다. 여러 홈이면 프로필의 기본 홈 → 기기가 가장 많은 홈 순서로 고른다."""
    locations = get_locations(token)
    if not locations:
        raise UsageError("스마트싱스 홈(위치)을 찾을 수 없습니다. 계정에 홈이 있는지 확인해 주세요.")
    if query:
        q = str(query).strip().lower()
        for loc in locations:
            if q in ((loc.get("locationId") or "").lower(), (loc.get("name") or "").lower()):
                return loc
        partial = [loc for loc in locations if q in (loc.get("name") or "").lower()]
        if len(partial) == 1:
            return partial[0]
        names = ", ".join(f"{loc.get('name')}({loc.get('locationId')})" for loc in locations)
        raise UsageError(f"홈(위치)을 찾을 수 없습니다: '{query}'. 있는 홈: {names}")
    if len(locations) == 1:
        return locations[0]
    preferred = profile_default_location()
    if preferred:
        q = preferred.lower()
        exact = [loc for loc in locations
                 if q in ((loc.get("locationId") or "").lower(), (loc.get("name") or "").lower())]
        if len(exact) == 1:
            return exact[0]
    counts = {}
    for d in get_devices(token):
        key = d.get("locationId")
        counts[key] = counts.get(key, 0) + 1
    return max(locations, key=lambda loc: counts.get(loc.get("locationId"), 0))


def device_label_map(token, location_id=None):
    """deviceId -> 라벨. 루틴 정의를 읽을 수 있게 풀어 보여 줄 때 쓴다."""
    try:
        devices = get_devices(token)
    except Exception:  # noqa: BLE001
        return {}
    labels = {}
    for d in devices:
        if location_id and d.get("locationId") and d.get("locationId") != location_id:
            continue
        labels[d.get("deviceId")] = device_label(d) or d.get("deviceId")
    return labels


def mode_name_map(token, location_id):
    """홈 모드 id -> 이름."""
    res = api_request(f"/locations/{location_id}/modes", token)
    if not isinstance(res, dict) or "error" in res:
        return {}
    return {m["id"]: m.get("name") for m in (res.get("items") or []) if m.get("id")}


def get_rules(token, location_id):
    res = check_response(api_request(f"/rules?locationId={location_id}", token), "자동 루틴 목록 조회")
    return res.get("items") or []


def get_scenes(token, location_id):
    res = check_response(api_request(f"/scenes?locationId={location_id}", token), "장면 목록 조회")
    return res.get("items") or []


def describe_value(raw):
    if isinstance(raw, bool):
        return "예" if raw else "아니오"
    if isinstance(raw, str):
        return STATE_TEXT.get(raw.strip().lower(), raw)
    return fmt_value(raw)


def describe_operand(op, labels, modes=None):
    """규칙 JSON의 operand(left/right) 하나를 읽을 수 있는 문구로 바꾼다."""
    if not isinstance(op, dict):
        return describe_value(op)
    if "device" in op:
        dev = op.get("device") or {}
        ids = dev.get("devices") or []
        names = ", ".join(labels.get(i, i) for i in ids) if ids else "기기"
        attr = dev.get("attribute") or ""
        label = ATTR_LABEL.get(attr, attr or dev.get("capability", ""))
        comp = dev.get("component") or "main"
        suffix = "" if comp == "main" else f"({comp})"
        return f"{names}의 {label}{suffix}"
    if "location" in op:
        loc = op.get("location") or {}
        attr = str(loc.get("attribute") or "")
        return LOCATION_ATTR_KR.get(attr.lower(), attr or "홈(위치)")
    if "time" in op:
        return describe_time_ref(op.get("time"))
    if "string" in op:
        text = str(op["string"])
        if modes and text in modes:
            return f"'{modes[text]}'"
        return f"'{describe_value(text)}'"
    if "integer" in op:
        return str(op["integer"])
    if "decimal" in op:
        return fmt_value(op["decimal"])
    if "boolean" in op:
        return "예" if op["boolean"] else "아니오"
    if "array" in op:
        return "[" + ", ".join(describe_operand(x, labels, modes) for x in (op.get("array") or [])) + "]"
    return json.dumps(op, ensure_ascii=False)


def describe_time_ref(ref):
    if not isinstance(ref, dict):
        return "정해진 시각"
    base = str(ref.get("reference") or "").strip()
    text = REFERENCE_KR.get(base.lower(), base or "정해진 시각")
    off = ref.get("offset") or {}
    value = (off.get("value") or {}).get("integer")
    if value:
        unit = UNIT_KR.get(str(off.get("unit") or "minute").lower(), off.get("unit") or "분")
        text += f" {abs(value)}{unit} {'뒤' if value > 0 else '전'}"
    return text


def clock_from_reference(reference, offset_minutes):
    """정오·자정 기준이면 실제 시계 시각(HH:MM)을 계산한다. 일출·일몰은 계산하지 않는다."""
    base = REFERENCE_MINUTE.get(str(reference or "").strip().lower())
    if base is None:
        return None
    total = (base + offset_minutes) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def describe_days(sp):
    """specific의 daysOfWeek를 '월·화·수' 처럼 문구로. 없으면 빈 문자열."""
    days = sp.get("daysOfWeek") or []
    keys = [str(d).strip().lower() for d in days if str(d).strip()]
    if not keys:
        return ""
    if sorted(keys) == sorted(DAY_ORDER[:5]):
        return "평일"
    if sorted(keys) == sorted(DAY_ORDER):
        return ""
    ordered = [k for k in DAY_ORDER if k in keys]
    return "·".join(DAY_KR.get(k, k) for k in ordered)


def describe_every(every):
    """every 동작(주기 실행)을 문구로."""
    ev = every if isinstance(every, dict) else {}
    if "interval" in ev:
        iv = ev.get("interval") or {}
        value = (iv.get("value") or {}).get("integer") or (iv.get("value") or {}).get("decimal")
        unit = UNIT_KR.get(str(iv.get("unit") or "minute").lower(), iv.get("unit") or "분")
        return f"{value}{unit}마다"
    if "specific" in ev:
        sp = ev.get("specific") or {}
        ref = str(sp.get("reference") or "").strip()
        off = sp.get("offset") or {}
        raw_value = (off.get("value") or {}).get("integer") or 0
        unit = str(off.get("unit") or "Minute").lower()
        offset_minutes = raw_value * 60 if unit == "hour" else raw_value
        clock = clock_from_reference(ref, offset_minutes)
        days = describe_days(sp)
        when = "매일" if not days else ("평일" if days == "평일" else f"매주 {days}")
        if sp.get("year") and sp.get("month") and sp.get("day"):
            when = f"{sp.get('year')}-{int(sp.get('month')):02d}-{int(sp.get('day')):02d} 한 번"
        if not raw_value:
            return f"{when} {REFERENCE_KR.get(ref.lower(), ref or '정해진 시각')}" + (f" ({clock})" if clock else "")
        unit_kr = UNIT_KR.get(unit, off.get("unit") or "분")
        text = f"{when} {REFERENCE_KR.get(ref.lower(), ref or '정해진 시각')} {abs(raw_value)}{unit_kr} {'뒤' if raw_value > 0 else '전'}"
        return text + (f" ({clock})" if clock else "")
    if "between" in ev:
        return "정해진 시간대마다"
    return "정해진 주기"


def describe_condition(cond, labels, modes=None):
    """조건(condition)을 문구로."""
    if not isinstance(cond, dict) or not cond:
        return "조건 없음"
    if "every" in cond:
        return describe_every(cond.get("every"))
    if "and" in cond:
        return " 그리고 ".join(describe_condition(c, labels, modes) for c in (cond.get("and") or []))
    if "or" in cond:
        return " 또는 ".join(describe_condition(c, labels, modes) for c in (cond.get("or") or []))
    if "not" in cond:
        return f"아닌 경우({describe_condition(cond.get('not'), labels, modes)})"
    if "changes" in cond:
        return f"{describe_condition(cond.get('changes'), labels, modes)} 가 될 때"
    if "remains" in cond:
        inner = cond.get("remains") or {}
        dur = inner.get("duration") or {}
        value = (dur.get("value") or {}).get("integer")
        unit = UNIT_KR.get(str(dur.get("unit") or "minute").lower(), "분")
        rest = describe_condition({k: v for k, v in inner.items() if k != "duration"}, labels, modes)
        return f"{rest} ({value}{unit} 이상 계속)"
    if "was" in cond:
        inner = cond.get("was") or {}
        dur = inner.get("duration") or {}
        value = (dur.get("value") or {}).get("integer")
        unit = UNIT_KR.get(str(dur.get("unit") or "minute").lower(), "분")
        rest = describe_condition({k: v for k, v in inner.items() if k != "duration"}, labels, modes)
        return f"최근 {value}{unit} 안에 {rest} 였던 적이 있을 때"
    for key, sign in (
        ("equals", "="),
        ("greaterThan", ">"),
        ("greaterThanOrEquals", ">="),
        ("lessThan", "<"),
        ("lessThanOrEquals", "<="),
    ):
        if key in cond:
            inner = cond.get(key) or {}
            left = describe_operand(inner.get("left"), labels, modes)
            right = describe_operand(inner.get("right"), labels, modes)
            return f"{left} {sign} {right}"
    if "between" in cond:
        inner = cond.get("between") or {}
        return (
            f"{describe_operand(inner.get('start'), labels, modes)} ≤ "
            f"{describe_operand(inner.get('value'), labels, modes)} ≤ {describe_operand(inner.get('end'), labels, modes)}"
        )
    if "stays" in cond:
        inner = cond.get("stays") or {}
        dur = inner.get("duration") or {}
        value = (dur.get("value") or {}).get("integer")
        unit = UNIT_KR.get(str(dur.get("unit") or "minute").lower(), "분")
        return f"{describe_condition({k: v for k, v in inner.items() if k != 'duration'}, labels, modes)} ( {value}{unit} 유지)"
    return json.dumps(cond, ensure_ascii=False)


def rule_text_lines(action, labels, modes=None, depth=0):
    """규칙의 동작 하나를 들여쓴 여러 줄로 표현한다."""
    if not isinstance(action, dict):
        return [json.dumps(action, ensure_ascii=False)]
    ind = "  " * depth

    if "every" in action:
        every = action.get("every") or {}
        lines = [f"{ind}주기: {describe_every(every)}"]
        nested = every.get("actions") or every.get("then") or action.get("actions") or action.get("then") or []
        for sub in nested:
            lines += rule_text_lines(sub, labels, modes, depth + 1)
        for sub in (every.get("else") or action.get("else") or []):
            lines.append(f"{ind}그 밖의 경우:")
            lines += rule_text_lines(sub, labels, modes, depth + 1)
        return lines

    if "if" in action:
        inner = action.get("if") or {}
        cond = {k: v for k, v in inner.items() if k not in ("then", "else")}
        lines = [f"{ind}조건: {describe_condition(cond, labels, modes)}"]
        for sub in (inner.get("then") or []):
            lines += rule_text_lines(sub, labels, modes, depth + 1)
        for sub in (inner.get("else") or []):
            lines.append(f"{ind}그 밖의 경우:")
            lines += rule_text_lines(sub, labels, modes, depth + 1)
        return lines

    if "command" in action:
        cmd = action.get("command") or {}
        ids = cmd.get("devices") or []
        names = ", ".join(labels.get(i, i) for i in ids) if ids else "기기"
        lines = []
        for c in (cmd.get("commands") or []):
            text = f"{ind}{names} → {c.get('capability')} {c.get('command')}"
            comp = c.get("component") or "main"
            if comp != "main":
                text += f" ({comp})"
            args = c.get("arguments") or []
            if args:
                text += f" {json.dumps(args, ensure_ascii=False)}"
            lines.append(text)
        for delay in (cmd.get("delays") or []):
            lines.append(f"{ind}{json.dumps(delay, ensure_ascii=False)}")
        return lines or [f"{ind}명령 없음"]

    if "sleep" in action:
        dur = (action.get("sleep") or {}).get("duration") or {}
        value = (dur.get("value") or {}).get("integer")
        unit = UNIT_KR.get(str(dur.get("unit") or "second").lower(), "초")
        return [f"{ind}{value}{unit} 대기"]

    if "location" in action:
        mode = (action.get("location") or {}).get("mode")
        name = (modes or {}).get(mode, mode)
        return [f"{ind}홈 모드 → {name}"]

    return [f"{ind}{json.dumps(action, ensure_ascii=False)}"]


def scene_matches(scenes, query):
    """장면 id 또는 이름으로 하나를 찾는다. 애매하면 후보를 돌려준다."""
    q = str(query).strip()
    for s in scenes:
        if (s.get("sceneId") or "").lower() == q.lower():
            return s, None
    exact = [s for s in scenes if (s.get("sceneName") or "").strip() == q]
    if len(exact) == 1:
        return exact[0], None
    partial = [s for s in scenes if q.lower() in (s.get("sceneName") or "").lower()]
    if len(partial) == 1:
        return partial[0], None
    return None, partial or []


def print_device_status(device, status, as_json=False):
    label = device_label(device)
    if as_json:
        print(f"### {label} ({device.get('deviceId')})")
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return
    print(f"{label}  (id: {device.get('deviceId')})")
    if isinstance(status, dict) and "error" in status:
        print("  상태 조회 실패:", status.get("error"))
        return
    if is_offline(status):
        print("  ⚠️ 오프라인 — 마지막으로 보고된 값이며 지금 상태와 다를 수 있습니다.")
    rows = describe_status(status)
    if not rows:
        print("  이 레시피가 요약하는 상태 값이 없습니다. '--json'으로 전체 응답을 확인할 수 있습니다.")
        return
    for name, value in rows:
        print(f"  - {name}: {value}")
    other = unsupported_note(status)
    if other:
        print(f"  (그 밖에 {other} 항목이 더 있습니다 — '--json'으로 전체 확인)")


def unsupported_note(status):
    known = {cap for cap, _ in STATUS_FIELDS}
    main = get_main(status)
    skip_prefixes = ("custom.", "samsungce.", "legendabsolute60149.", "ocf", "firmwareUpdate", "refresh", "execute")
    extra = [cap for cap in main if cap not in known and not cap.startswith(skip_prefixes)]
    return len(extra) if extra else 0


# ---------------------------------------------------------------- 명세(info)

COMMANDS = [
    ("list", "기기 목록 ('--caps', '--cap', '--json')"),
    ("status", "기기 상태 — 전원·온습도·문·창문·모션·누수·공기질·배터리·차량 ('--json')"),
    ("sensors", "센서 값을 보고하는 기기 전체 한 줄씩"),
    ("on-list", "지금 켜져 있는 기기만"),
    ("on / off", "전원 켜기 / 끄기"),
    ("start-engine / stop-engine", "차량 원격 시동·공조 켜기 / 끄기"),
    ("rules", "자동 루틴 목록 ('--json', '--loc')"),
    ("rule-create", "자동 루틴 만들기 (JSON 파일 또는 표준입력, '--dry-run')"),
    ("rule-delete", "자동 루틴 지우기 ('--dry-run')"),
    ("scenes / scene-run", "수동 루틴(장면) 목록 / 실행 ('--dry-run')"),
    ("info", "이 설명과 지금 상태 (인증 없이 동작, '--json')"),
]


def info_payload():
    state = token_state()
    return {
        "recipe": "스마트싱스 기기제어",
        "version": VERSION,
        "service": "삼성 스마트싱스 (api.smartthings.com)",
        "description": "기기 상태 조회·전원 제어·차량 시동·자동 루틴·장면을 처리합니다.",
        "commands": [{"name": n, "description": d} for n, d in COMMANDS],
        "inputs": {
            "order": ["실행 인자(--token)", "환경변수", "설정 파일"],
            "env": ["SMARTTHINGS_TOKEN"],
            "files": [
                {"path": TOKEN_PATH, "accepts": "키 한 줄 또는 {\"token\": \"...\"} JSON"},
                {"path": CONFIG_PATH, "accepts": "같은 형식"},
            ],
            "profile": {
                "path": PROFILE_PATH,
                "optional_keys": ["smartthings.default_location (홈이 여러 개일 때 기본 홈 이름 또는 ID)"],
                "secret_free": "인증 키나 실제 개인정보 값은 프로필에 넣지 않습니다.",
            },
        },
        "storage": {
            "dir": os.path.dirname(TOKEN_PATH),
            "dir_permission": "700",
            "files": [
                {"path": TOKEN_PATH, "permission": "600", "content": "인증 키 (24시간 유효)"},
                {"path": CONFIG_PATH, "permission": "600", "content": "같은 형식의 인증 키"},
            ],
        },
        "state": {"token": state},
        "limits": [
            "인증 키는 24시간마다 만료됩니다 — 만료되면 새로 받아야 합니다.",
            "앱에서 만든 루틴은 API로 조회·수정·삭제·실행할 수 없습니다.",
            "API로 만든 루틴은 스마트폰 앱 '루틴' 탭에 보이지 않을 수 있습니다.",
            "밝기·색온도·커튼 열림 정도·공조 온도 세밀 조절은 다루지 않습니다.",
            "규칙 실행 이력 조회는 지원되지 않습니다(403).",
            "서비스가 capability 이름을 바꾸면 명령이 거절될 수 있습니다.",
        ],
        "exit_codes": {"0": "성공", "2": "사용법·입력 오류", "3": "인증·설정 파일 없음", "1": "그 밖의 실행 실패"},
        "setup": {
            "issue_url": "https://account.smartthings.com",
            "bridge": "https://pickle-loginbridge--smartthings-pat.pages.dev/",
            "download_filename": "smartthings_config.json",
        },
    }


def print_info(as_json=False):
    spec = info_payload()
    if as_json:
        print(json.dumps(spec, ensure_ascii=False, indent=2))
        return
    state = spec["state"]["token"]
    print(f"{spec['recipe']}  v{spec['version']}")
    print(f"서비스: {spec['service']}")
    print(f"설명: {spec['description']}")
    print("\n할 수 있는 일")
    for name, desc in COMMANDS:
        print(f"  {name:<28} {desc}")
    print("\n필요한 입력 (읽는 순서: 실행 인자 → 환경변수 → 설정 파일)")
    print("  --token <인증 키> · SMARTTHINGS_TOKEN · ~/.config/smartthings/token")
    print("  설정 파일에는 키 한 줄과 {\"token\": \"...\"} JSON 둘 다 넣을 수 있습니다.")
    print("\n선택: 프로필 파일에서 기본 홈 이름을 읽을 수 있습니다 (비밀값은 넣지 않습니다)")
    print("\n저장 위치")
    print(f"  {os.path.dirname(TOKEN_PATH)} (폴더 700) · token/config.json (600)")
    print("\n지금 상태")
    if state["available"]:
        print(f"  인증 키: 있음 ({state['source']}) — 값은 표시하지 않습니다")
    else:
        print(f"  인증 키: 없음 — https://account.smartthings.com 에서 발급해 {TOKEN_PATH} 에 두세요")
    print("\n하지 못하는 일·한계")
    for line in spec["limits"]:
        print(f"  - {line}")
    print("\n종료 코드: 0 성공 · 2 사용법·입력 오류 · 3 인증·설정 없음 · 1 그 밖의 실패")


def main():
    parser = argparse.ArgumentParser(description="스마트싱스 기기 상태 조회·제어 및 자동 루틴(Rules)·장면(Scenes) API 클라이언트")
    parser.add_argument("--token", help="스마트싱스 PAT 토큰")
    subparsers = parser.add_subparsers(dest="command", help="명령어")

    # info
    parser_info = subparsers.add_parser("info", help="레시피 명세와 지금 상태 (인증 없이 동작)")
    parser_info.add_argument("--json", action="store_true", help="기계가 읽는 JSON으로 출력")

    # list
    parser_list = subparsers.add_parser("list", help="연결된 전체 기기 목록 조회")
    parser_list.add_argument("--caps", action="store_true", help="기기별 capability 목록도 함께 표시")
    parser_list.add_argument("--cap", help="특정 capability를 가진 기기만 (예: switch, contactSensor)")
    parser_list.add_argument("--json", action="store_true", help="원본 JSON 출력")

    # status
    parser_status = subparsers.add_parser("status", help="특정 기기 상태 조회 (전원·온습도·문열림·모션·누수·공기질 등)")
    parser_status.add_argument("query", help="기기명 또는 라벨")
    parser_status.add_argument("--json", action="store_true", help="원본 상태 JSON 출력")

    # sensors
    subparsers.add_parser("sensors", help="센서가 있는 기기의 현재 값 한눈에 보기 (온습도·문열림·모션·누수·공기질·배터리)")

    # on-list
    subparsers.add_parser("on-list", help="지금 켜져 있는(switch=on) 기기만 모아 보기")

    # on / off
    parser_on = subparsers.add_parser("on", help="기기 전원 켜기")
    parser_on.add_argument("query", help="기기명 또는 라벨")

    parser_off = subparsers.add_parser("off", help="기기 전원 끄기")
    parser_off.add_argument("query", help="기기명 또는 라벨")

    # start-engine / stop-engine
    parser_start = subparsers.add_parser("start-engine", help="차량 원격 시동 및 공조 켜기")
    parser_start.add_argument("query", help="차량 기기명 또는 라벨")
    parser_start.add_argument("--temp", type=int, default=24, help="설정 온도 (기본 24도)")
    parser_start.add_argument("--duration", type=int, default=10, help="시동 유지 시간(분, 기본 10분)")

    parser_stop = subparsers.add_parser("stop-engine", help="차량 원격 시동 끄기")
    parser_stop.add_argument("query", help="차량 기기명 또는 라벨")

    # rules / rule-create / rule-delete — 스마트싱스 자체 실행 자동 루틴
    parser_rules = subparsers.add_parser("rules", help="API로 만든 자동 루틴 목록 (스마트싱스가 직접 실행)")
    parser_rules.add_argument("--json", action="store_true", help="원본 정의 JSON 출력")
    parser_rules.add_argument("--loc", help="홈(위치) 이름 또는 ID — 여러 홈일 때")

    parser_rule_create = subparsers.add_parser("rule-create", help="자동 루틴 생성 (룰 JSON 파일 또는 표준입력)")
    parser_rule_create.add_argument("json_file", nargs="?", help="룰 JSON 파일 경로 ('-' 또는 생략하면 표준입력)")
    parser_rule_create.add_argument("--loc", help="홈(위치) 이름 또는 ID — 여러 홈일 때")
    parser_rule_create.add_argument("--dry-run", action="store_true", help="형식만 검사하고 만들지 않음")

    parser_rule_delete = subparsers.add_parser("rule-delete", help="자동 루틴 삭제")
    parser_rule_delete.add_argument("rule_id", help="룰 id ('rules' 결과에서 확인)")
    parser_rule_delete.add_argument("--loc", help="홈(위치) 이름 또는 ID — 여러 홈일 때")
    parser_rule_delete.add_argument("--dry-run", action="store_true", help="대상만 확인하고 삭제하지 않음")

    # scenes / scene-run — 스마트폰 앱에서 만든 수동 루틴(장면)
    parser_scenes = subparsers.add_parser("scenes", help="수동 루틴(장면) 목록")
    parser_scenes.add_argument("--json", action="store_true", help="원본 JSON 출력")
    parser_scenes.add_argument("--loc", help="홈(위치) 이름 또는 ID — 여러 홈일 때")

    parser_scene_run = subparsers.add_parser("scene-run", help="수동 루틴(장면) 실행")
    parser_scene_run.add_argument("scene", help="장면 id 또는 정확한 이름")
    parser_scene_run.add_argument("--loc", help="홈(위치) 이름 또는 ID — 여러 홈일 때")
    parser_scene_run.add_argument("--dry-run", action="store_true", help="대상만 확인하고 실행하지 않음")

    if len(sys.argv) < 2:
        parser.print_help()
        sys.exit(2)

    args = parser.parse_args()
    if args.command == "info":
        print_info(args.json)
        return

    token = get_token(args.token)
    if not token:
        print("오류: 인증 키가 없습니다. --token 인자, SMARTTHINGS_TOKEN 환경변수, 또는 "
              f"{TOKEN_PATH} 파일을 확인해 주세요. (발급: https://account.smartthings.com)", file=sys.stderr)
        sys.exit(3)

    if args.command == "list":
        devices = get_devices(token)
        if args.cap:
            devices = [d for d in devices if args.cap in device_capabilities(d)]
        if args.json:
            print(json.dumps(devices, ensure_ascii=False, indent=2))
            sys.exit(0)
        print(f"총 {len(devices)}개 기기 연결됨:")
        rooms = get_room_map(token)
        multi_location = len({d.get("locationId") for d in devices}) > 1
        for d in devices:
            line = f"- {device_label(d)}{room_suffix(d, rooms, multi_location)} (id: {d.get('deviceId')})"
            print(line)
            if args.caps:
                caps = sorted(c for c in device_capabilities(d) if c not in ("refresh", "healthCheck", "execute"))
                print(f"    capabilities: {', '.join(caps) if caps else '-'}")

    elif args.command == "status":
        matches = find_device(token, args.query)
        if not matches:
            print(f"기기를 찾을 수 없습니다: '{args.query}'", file=sys.stderr)
            sys.exit(2)
        for d in matches:
            print_device_status(d, get_status(token, d["deviceId"]), as_json=args.json)
            print()

    elif args.command == "sensors":
        devices = [d for d in get_devices(token) if device_capabilities(d) & set(SENSOR_CAPABILITIES)]
        if not devices:
            print("센서 값을 보고하는 기기가 없습니다.")
            sys.exit(0)
        print(f"센서 기기 {len(devices)}개:")
        rooms = get_room_map(token)
        multi_location = len({d.get("locationId") for d in devices}) > 1
        for d, st in fetch_statuses(token, devices):
            print(f"- {device_label(d)}{room_suffix(d, rooms, multi_location)}: {status_summary(st)}")

    elif args.command == "on-list":
        devices = [d for d in get_devices(token) if "switch" in device_capabilities(d)]
        on_devices = []
        for d, st in fetch_statuses(token, devices):
            present, raw = attr_value(get_main(st), "switch", "switch")
            if present and str(raw).lower() == "on":
                on_devices.append(d)
        if not on_devices:
            print(f"지금 켜져 있는 기기가 없습니다 (전원 제어 기기 {len(devices)}개 확인).")
            sys.exit(0)
        print(f"지금 켜져 있는 기기 {len(on_devices)}개 (전원 제어 기기 {len(devices)}개 중):")
        rooms = get_room_map(token)
        multi_location = len({d.get("locationId") for d in on_devices}) > 1
        for d in on_devices:
            print(f"- {device_label(d)}{room_suffix(d, rooms, multi_location)} (id: {d.get('deviceId')})")

    elif args.command in ("on", "off"):
        matches = find_device(token, args.query)
        if not matches:
            print(f"기기를 찾을 수 없습니다: '{args.query}'", file=sys.stderr)
            sys.exit(2)
        target = matches[0]
        label = device_label(target)
        res = switch_device(token, target["deviceId"], args.command)
        print(f"성공: {label} -> {args.command} (결과: {res})")

    elif args.command == "start-engine":
        matches = find_device(token, args.query)
        if not matches:
            print(f"차량 기기를 찾을 수 없습니다: '{args.query}'", file=sys.stderr)
            sys.exit(2)
        target = matches[0]
        label = device_label(target)
        res = control_vehicle_engine(token, target["deviceId"], start=True, duration=args.duration, temp=args.temp)
        print(f"성공: {label} 원격 시동 명령 전송 (온도: {args.temp}℃, 유지: {args.duration}분, 결과: {res})")

    elif args.command == "stop-engine":
        matches = find_device(token, args.query)
        if not matches:
            print(f"차량 기기를 찾을 수 없습니다: '{args.query}'", file=sys.stderr)
            sys.exit(2)
        target = matches[0]
        label = device_label(target)
        res = control_vehicle_engine(token, target["deviceId"], start=False)
        print(f"성공: {label} 원격 시동 종료 명령 전송 (결과: {res})")

    elif args.command == "rules":
        loc = resolve_location(token, args.loc)
        rules = get_rules(token, loc["locationId"])
        if args.json:
            print(json.dumps({"location": loc.get("name"), "locationId": loc.get("locationId"), "rules": rules}, ensure_ascii=False, indent=2))
            sys.exit(0)
        print(f"홈: {loc.get('name')} ({loc.get('locationId')})")
        if not rules:
            print("API로 만든 자동 루틴이 없습니다.")
        else:
            labels = device_label_map(token, loc.get("locationId"))
            modes = mode_name_map(token, loc.get("locationId"))
            print(f"API로 만든 자동 루틴 {len(rules)}개:")
            for i, rule in enumerate(rules, 1):
                status = RULE_STATUS_KR.get(str(rule.get("status", "")).lower(), rule.get("status") or "-")
                print(f"{i}. [{status}] {rule.get('name')}  (id: {rule.get('id')})")
                for action in (rule.get("actions") or []):
                    for line in rule_text_lines(action, labels, modes):
                        print(f"   {line}")
                meta = ["실행 위치: " + ("허브(로컬)" if str(rule.get("executionLocation", "")).lower() == "local" else "클라우드")]
                if rule.get("dateCreated"):
                    meta.append(f"만든 날짜: {fmt_iso(rule.get('dateCreated'))}")
                print(f"   ({' · '.join(meta)})")
                print()
        print("참고: API로 만든 자동 루틴은 스마트폰 앱 '루틴' 탭에 보이지 않을 수 있습니다. 이 목록이나 my.smartthings.com/advanced에서 확인할 수 있습니다.")
        print("      스마트폰 앱에서 만든 자동 루틴은 이 목록에 나오지 않고, API로 조회·수정·삭제할 수 없습니다.")

    elif args.command == "rule-create":
        path = args.json_file
        if not path or path == "-":
            raw = sys.stdin.read()
        else:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = f.read()
            except OSError as e:
                print(f"오류: 룰 JSON 파일을 읽을 수 없습니다: {path} ({e})", file=sys.stderr)
                sys.exit(2)
        if not raw.strip():
            print("오류: 룰 JSON이 비어 있습니다. README의 자동 루틴 예시처럼 name과 actions를 담은 JSON을 파일이나 표준입력으로 넘겨 주세요.", file=sys.stderr)
            sys.exit(2)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"오류: 룰 JSON 문법 오류 (줄 {e.lineno}, 칸 {e.colno}): {e.msg}", file=sys.stderr)
            sys.exit(2)
        if not isinstance(payload, dict) or not payload.get("name") or not payload.get("actions"):
            print("오류: 룰에는 name(이름)과 actions(동작 목록)가 있어야 합니다.", file=sys.stderr)
            sys.exit(2)
        loc = resolve_location(token, args.loc)
        print(f"홈: {loc.get('name')} ({loc.get('locationId')})")
        if args.dry_run:
            print("형식 확인 통과 — 이 JSON으로 만들 예정입니다 (--dry-run 이라 만들지 않았습니다):")
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            sys.exit(0)
        res = check_response(api_request(f"/rules?locationId={loc['locationId']}", token, method="POST", data=payload), "자동 루틴 생성")
        execution = "허브(로컬)" if str(res.get("executionLocation", "")).lower() == "local" else "클라우드"
        print(f"자동 루틴 생성 완료: {res.get('name')}  (id: {res.get('id')}, 상태: {RULE_STATUS_KR.get(str(res.get('status', '')).lower(), res.get('status'))}, 실행 위치: {execution})")
        print("참고: API로 만든 자동 루틴은 스마트폰 앱 '루틴' 탭에 보이지 않을 수 있습니다. 확인·삭제는 'rules' 또는 my.smartthings.com/advanced에서 합니다.")

    elif args.command == "rule-delete":
        loc = resolve_location(token, args.loc)
        rules = get_rules(token, loc["locationId"])
        target = None
        for rule in rules:
            if (rule.get("id") or "").lower() == str(args.rule_id).strip().lower():
                target = rule
                break
        if not target:
            print(f"자동 루틴을 찾을 수 없습니다: '{args.rule_id}' (홈: {loc.get('name')})", file=sys.stderr)
            if rules:
                print("이 홈의 API 루틴:" + ", ".join(f"{r.get('name')}({r.get('id')})" for r in rules))
            sys.exit(2)
        print(f"대상: {target.get('name')}  (id: {target.get('id')})")
        if args.dry_run:
            print("--dry-run 이라 삭제하지 않았습니다.")
            sys.exit(0)
        check_response(api_request(f"/rules/{target.get('id')}?locationId={loc['locationId']}", token, method="DELETE"), "자동 루틴 삭제")
        remaining = get_rules(token, loc["locationId"])
        still_there = any((r.get("id") or "") == target.get("id") for r in remaining)
        if still_there:
            print(f"삭제 요청은 전송됐지만 목록에 남아 있습니다: {target.get('id')} — 잠시 뒤 'rules'로 다시 확인해 주세요.")
        else:
            print(f"삭제 완료: {target.get('name')}  (id: {target.get('id')}) · 남은 API 루틴 {len(remaining)}개")

    elif args.command == "scenes":
        loc = resolve_location(token, args.loc)
        scenes = get_scenes(token, loc["locationId"])
        if args.json:
            print(json.dumps({"location": loc.get("name"), "locationId": loc.get("locationId"), "scenes": scenes}, ensure_ascii=False, indent=2))
            sys.exit(0)
        print(f"홈: {loc.get('name')} ({loc.get('locationId')})")
        if not scenes:
            print("수동 루틴(장면)이 없습니다.")
            sys.exit(0)
        print(f"수동 루틴(장면) {len(scenes)}개:")
        for i, scene in enumerate(scenes, 1):
            meta = [f"id: {scene.get('sceneId')}"]
            if scene.get("lastExecutedDate"):
                meta.append(f"마지막 실행: {fmt_epoch_ms(scene.get('lastExecutedDate'))}")
            else:
                meta.append("실행 기록 없음")
            if scene.get("editable") is False:
                meta.append("앱에서 만든 장면(API로 수정 불가)")
            print(f"{i}. {scene.get('sceneName')}  ({' · '.join(meta)})")
        print("실행: scene-run <장면 id 또는 이름>")

    elif args.command == "scene-run":
        loc = resolve_location(token, args.loc)
        scenes = get_scenes(token, loc["locationId"])
        target, candidates = scene_matches(scenes, args.scene)
        if not target:
            if candidates:
                print(f"장면 이름이 정확히 하나로 정해지지 않습니다: '{args.scene}'")
                print("후보: " + ", ".join(f"{c.get('sceneName')}({c.get('sceneId')})" for c in candidates))
            else:
                print(f"장면을 찾을 수 없습니다: '{args.scene}' (홈: {loc.get('name')})")
            sys.exit(2)
        print(f"대상 장면: {target.get('sceneName')}  (id: {target.get('sceneId')})")
        if args.dry_run:
            print("--dry-run 이라 실행하지 않았습니다.")
            sys.exit(0)
        res = check_response(api_request(f"/scenes/{target.get('sceneId')}/execute", token, method="POST", data={}), "장면 실행")
        status = res.get("status") if isinstance(res, dict) else None
        if status and str(status).lower() != "success":
            print(f"장면 실행 요청 결과: {status} ({json.dumps(res, ensure_ascii=False)})")
        else:
            print(f"장면 실행 요청 완료: {target.get('sceneName')}")


if __name__ == "__main__":
    try:
        main()
    except AuthError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(3)
    except UsageError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(2)
    except RuntimeError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(1)
