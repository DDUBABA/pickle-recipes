"""Replace the service function; never include real personal configuration."""
import argparse
import json
from pathlib import Path


def load_profile():
    path = Path.home() / ".config" / "pickle-profile" / "profile.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def run_service(profile):
    # Do not echo profile data, access keys, or raw service responses.
    return {"ok": False, "code": "NOT_IMPLEMENTED", "message": "서비스 동작을 구현하세요."}


def main():
    parser = argparse.ArgumentParser(description="Pickle connector template")
    parser.add_argument("--json", action="store_true", help="JSON standard output")
    args = parser.parse_args()
    try:
        result = run_service(load_profile())
    except (OSError, ValueError):
        result = {"ok": False, "code": "CONFIG_ERROR", "message": "개인 설정을 확인하세요."}
    print(json.dumps(result, ensure_ascii=False) if args.json else result["message"])
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
