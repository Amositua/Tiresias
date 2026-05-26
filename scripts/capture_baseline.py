"""
Capture a real fingerprint of the current BigQuery state and store it as baseline.

Run this BEFORE renaming anything in HubSpot. It computes the actual column
distributions from BigQuery and stores them N times (with staggered timestamps)
so the PSI comparison has a stable reference when the renamed data arrives.

Usage:
    python scripts/capture_baseline.py                   # n=5, dry_run=False
    python scripts/capture_baseline.py --n 3 --dry-run  # preview without writing

The stored fingerprints are real (is_synthetic=False). Do not run this after
the rename — that would pollute the baseline with the post-drift distribution.
"""

from __future__ import annotations

import argparse
import copy
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env", override=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--n", type=int, default=5, help="Copies to store (default: 5)")
    parser.add_argument("--table", default="deal_pipeline_stage")
    parser.add_argument("--dataset", default=None, help="Override BIGQUERY_HUBSPOT_DATASET")
    parser.add_argument("--dry-run", action="store_true", help="Print distribution without writing")
    args = parser.parse_args()

    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
    dataset = args.dataset or os.environ.get("BIGQUERY_HUBSPOT_DATASET", "")
    meta_dataset = os.environ.get("BIGQUERY_META_DATASET", "tiresias_meta")
    connector_id = os.environ.get("FIVETRAN_CONNECTOR_ID", "wanderer_financing")

    if not dataset:
        print("ERROR: BIGQUERY_HUBSPOT_DATASET is not set in .env", file=sys.stderr)
        sys.exit(1)

    from google.cloud import bigquery
    from memory.fingerprint import BigQueryFingerprinter

    client = bigquery.Client(project=project)
    fp_client = BigQueryFingerprinter(client, project, meta_dataset)

    print(f"Querying {project}.{dataset}.{args.table} ...")
    live = fp_client.compute_fingerprint(dataset, args.table, connector_id)

    # Show what we captured
    for col in live.columns:
        if col.psi_distribution:
            print(f"\n  {col.name} distribution (PSI baseline):")
            for val, pct in sorted(col.psi_distribution.items(), key=lambda x: -x[1]):
                bar = "█" * int(pct * 40)
                print(f"    {val:<35} {bar} {pct:.3f}")
        elif col.mean is not None:
            print(f"\n  {col.name}: mean={col.mean:.4f}  stddev={col.stddev:.4f}")

    print(f"\n  row_count={live.row_count}  schema_hash={live.schema_hash}")

    if args.dry_run:
        print("\n[dry-run] Nothing written.")
        return

    # Store N copies staggered 3 days apart so rolling baseline has spread
    now = datetime.now(timezone.utc)
    stored = []
    for i in range(args.n):
        fp_copy = live.model_copy(
            update={
                "fingerprint_id": str(uuid.uuid4()),
                "computed_at": now - timedelta(days=(args.n - 1 - i) * 3),
                "is_synthetic": False,
            }
        )
        fp_client.store_fingerprint(fp_copy)
        stored.append(fp_copy.fingerprint_id)
        print(f"  stored  {fp_copy.fingerprint_id}  (computed_at={fp_copy.computed_at.date()})")

    print(f"\nBaseline ready: {args.n} real fingerprints for {dataset}.{args.table}")
    print("You can now rename the stage in HubSpot and trigger a Fivetran sync.")


if __name__ == "__main__":
    main()
