"""
Trigger the full Tiresias pipeline locally for testing and demo.

Calls /dev/trigger, which runs the identical Memory -> Lineage -> Oracle -> MCP
path as the production webhook but skips Fivetran signature verification.
The endpoint is only active when TIRESIAS_DEV_TRIGGERS=true (set in .env).

Usage:
    python scripts/trigger_webhook.py
    python scripts/trigger_webhook.py --table deal --schema hubspot
    python scripts/trigger_webhook.py --connector my_connector --url http://localhost:8000
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(description="Trigger the Tiresias pipeline for demo/testing")
    parser.add_argument("--connector", default="wanderer_financing")
    parser.add_argument("--schema", default="hubspot")
    parser.add_argument("--table", default="deal_pipeline_stage")
    parser.add_argument("--url", default="http://localhost:8000/dev/trigger")
    args = parser.parse_args()

    payload = {
        "connector_id": args.connector,
        "schema": args.schema,
        "table": args.table,
    }
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        args.url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        error_body = exc.read()
        try:
            result = json.loads(error_body)
        except Exception:
            result = {"error": error_body.decode(errors="replace")}
        print(f"HTTP {exc.code}:", file=sys.stderr)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
