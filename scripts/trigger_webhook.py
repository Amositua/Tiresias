"""
Trigger the full Tiresias pipeline locally for testing and demo.

Usage:
    # Normal drift detection (deal_pipeline_stage label rename)
    python scripts/trigger_webhook.py

    # Billing anomaly simulation (row explosion on deal table)
    python scripts/trigger_webhook.py --mode billing_anomaly
    python scripts/trigger_webhook.py --mode billing_anomaly --multiplier 6.0

    # Custom table/schema
    python scripts/trigger_webhook.py --table deal --schema hubspot
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent

BASE_URL = "http://localhost:8000"


def _post(url: str, payload: dict, timeout: int = 120) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        error_body = exc.read()
        try:
            result = json.loads(error_body)
        except Exception:
            result = {"error": error_body.decode(errors="replace")}
        print(f"HTTP {exc.code}:", file=sys.stderr)
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Trigger the Tiresias pipeline for demo/testing")
    parser.add_argument("--connector", default="wanderer_financing")
    parser.add_argument("--schema", default="hubspot")
    parser.add_argument("--table", default="deal_pipeline_stage")
    parser.add_argument(
        "--mode",
        choices=["drift", "billing_anomaly"],
        default="drift",
        help="drift: normal PSI drift detection | billing_anomaly: row explosion simulation",
    )
    parser.add_argument(
        "--multiplier",
        type=float,
        default=4.8,
        help="Row multiplier for billing_anomaly mode (default 4.8×)",
    )
    args = parser.parse_args()

    if args.mode == "billing_anomaly":
        print(f"Simulating billing anomaly on {args.schema}.{args.table} ({args.multiplier}× row explosion)…")
        result = _post(
            f"{BASE_URL}/dev/simulate-billing",
            {
                "connector_id": args.connector,
                "schema": args.schema,
                "table": args.table if args.table != "deal_pipeline_stage" else "deal",
                "multiplier": args.multiplier,
            },
        )
    else:
        result = _post(
            f"{BASE_URL}/dev/trigger",
            {
                "connector_id": args.connector,
                "schema": args.schema,
                "table": args.table,
            },
        )

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
