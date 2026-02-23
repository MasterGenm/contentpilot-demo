import argparse
import json
import os
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen


def _base_url() -> str:
    host = os.getenv("A2A_UI_HOST", "127.0.0.1")
    port = os.getenv("A2A_UI_PORT", "12000")
    return f"http://{host}:{port}"


def _parse_timeout(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if text in ("0", "none", "inf", "infinite", "unlimited"):
        return None
    return float(text)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run /api/chat then export session zip.")
    parser.add_argument("--base", default=None, help="Base URL, e.g. http://127.0.0.1:12000")
    parser.add_argument("--out", default=None, help="Output directory for the zip")
    parser.add_argument(
        "--timeout",
        default=os.getenv("A2A_DEMO_TIMEOUT", "180"),
        help="Timeout seconds; use 0/none/inf to disable",
    )
    parser.add_argument("--text", default="export demo ping", help="Input text for /api/chat")
    parser.add_argument("--mock", action="store_true", help="Use mock response to avoid LLM")
    args = parser.parse_args()
    args.timeout = _parse_timeout(args.timeout)
    return args


def main() -> int:
    args = _parse_args()
    base = args.base or _base_url()
    payload = {"input": args.text, "profile": "naga"}
    if args.mock:
        payload["mock"] = True
    req = Request(
        f"{base}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if args.timeout is None:
        with urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
    else:
        with urlopen(req, timeout=args.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))

    conversation_id = data.get("conversation_id")
    if not conversation_id:
        print("No conversation_id returned from /api/chat")
        return 1

    export_url = f"{base}/export/session?conversation_id={quote(conversation_id)}"
    out_dir = args.out or os.getcwd()
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{conversation_id}_session.zip")
    if args.timeout is None:
        with urlopen(export_url) as resp:
            content = resp.read()
    else:
        with urlopen(export_url, timeout=args.timeout) as resp:
            content = resp.read()
    with open(out_path, "wb") as f:
        f.write(content)

    print(f"Exported: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
