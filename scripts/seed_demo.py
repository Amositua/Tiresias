"""Seed synthetic fingerprints for dev/testing (is_synthetic=True, not for demo).

Usage:
    python scripts/seed_demo.py [--n 5] [--dry-run]
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv

from memory.fingerprint import (
    ColumnFingerprint,
    TableFingerprint,
    BigQueryFingerprinter,
    _schema_hash,
    _compute_entropy,
)

load_dotenv(Path(__file__).parent.parent / ".env")


_DEAL_TABLE_SCHEMA = [
    {"name": "deal_pipeline_stage_id", "data_type": "STRING"},
    {"name": "property_amount", "data_type": "FLOAT64"},
    {"name": "deal_pipeline_id", "data_type": "STRING"},
]

_DEAL_STAGE_ID_DISTRIBUTION = {
    "qualifiedtobuy":         0.20,
    "contractsent":           0.18,
    "presentationscheduled":  0.18,
    "appointmentscheduled":   0.15,
    "decisionmakerboughtin":  0.14,
    "closedwon":              0.10,
    "closedlost":             0.05,
}

_DEAL_PIPELINE_DISTRIBUTION = {
    "default": 1.0,
}

_AMOUNT_STATS = {
    "min_val": 0.0,
    "max_val": 280000.0,
    "mean": 106180.0,
    "stddev": 73500.0,
    "p1": 0.0,
    "p25": 55000.0,
    "p50": 95000.0,
    "p75": 150000.0,
    "p99": 275000.0,
}

_DEAL_ROW_COUNT_BASE = 100

_STAGE_TABLE_SCHEMA = [
    {"name": "label", "data_type": "STRING"},
    {"name": "probability", "data_type": "FLOAT64"},
    {"name": "is_closed", "data_type": "BOOL"},
]

_STAGE_LABEL_DISTRIBUTION = {
    "Appointment Scheduled":   1 / 7,
    "Qualified To Buy":        1 / 7,
    "Presentation Scheduled":  1 / 7,
    "Decision Maker Bought-In": 1 / 7,
    "Contract Sent":           1 / 7,
    "Closed Won":              1 / 7,
    "Closed Lost":             1 / 7,
}

_STAGE_IS_CLOSED_DISTRIBUTION = {
    "True":  2 / 7,
    "False": 5 / 7,
}

_PROBABILITY_STATS = {
    "min_val": 0.0,
    "max_val": 1.0,
    "mean": 0.557,
    "stddev": 0.349,
    "p1": 0.0,
    "p25": 0.2,
    "p50": 0.6,
    "p75": 0.9,
    "p99": 1.0,
}

_STAGE_ROW_COUNT_BASE = 7


def _noise(value: float, pct: float = 0.03) -> float:
    return max(0.0, value + random.gauss(0, value * pct))


def _noisy_distribution(dist: dict[str, float], pct: float = 0.02) -> dict[str, float]:
    noisy = {k: max(0.001, v + random.gauss(0, v * pct)) for k, v in dist.items()}
    total = sum(noisy.values())
    return {k: round(v / total, 6) for k, v in noisy.items()}


def _make_deal_fingerprint(
    connection_id: str,
    project_id: str,
    computed_at: datetime,
    row_count: int,
) -> TableFingerprint:
    dist = _noisy_distribution(_DEAL_STAGE_ID_DISTRIBUTION)
    stage_id_col = ColumnFingerprint(
        name="deal_pipeline_stage_id",
        data_type="STRING",
        null_pct=0.0,
        distinct_count=7,
        top_values=[
            {"value": k, "count": int(v * row_count), "pct": v}
            for k, v in sorted(dist.items(), key=lambda x: -x[1])
        ],
        entropy=_compute_entropy(dist),
        psi_distribution=dist,
    )

    pipeline_dist = _noisy_distribution(_DEAL_PIPELINE_DISTRIBUTION, pct=0.001)
    pipeline_col = ColumnFingerprint(
        name="deal_pipeline_id",
        data_type="STRING",
        null_pct=0.0,
        distinct_count=1,
        top_values=[{"value": "default", "count": row_count, "pct": 1.0}],
        entropy=0.0,
        psi_distribution=pipeline_dist,
    )

    amount_col = ColumnFingerprint(
        name="property_amount",
        data_type="FLOAT64",
        null_pct=0.0,
        distinct_count=random.randint(90, 100),
        min_val=0.0,
        max_val=_noise(_AMOUNT_STATS["max_val"], 0.02),
        mean=_noise(_AMOUNT_STATS["mean"], 0.03),
        stddev=_noise(_AMOUNT_STATS["stddev"], 0.04),
        p1=0.0,
        p25=_noise(_AMOUNT_STATS["p25"], 0.03),
        p50=_noise(_AMOUNT_STATS["p50"], 0.03),
        p75=_noise(_AMOUNT_STATS["p75"], 0.03),
        p99=_noise(_AMOUNT_STATS["p99"], 0.02),
    )

    schema_raw = [{"name": c["name"], "data_type": c["data_type"]} for c in _DEAL_TABLE_SCHEMA]
    return TableFingerprint(
        fingerprint_id=str(uuid.uuid4()),
        connection_id=connection_id,
        project_id=project_id,
        dataset_id="hubspot",
        table_name="deal",
        row_count=row_count + random.randint(-2, 2),
        computed_at=computed_at,
        schema_hash=_schema_hash(schema_raw),
        columns=[stage_id_col, pipeline_col, amount_col],
        is_synthetic=True,
    )


def _make_stage_fingerprint(
    connection_id: str,
    project_id: str,
    computed_at: datetime,
) -> TableFingerprint:
    label_dist = _noisy_distribution(_STAGE_LABEL_DISTRIBUTION, pct=0.005)
    label_col = ColumnFingerprint(
        name="label",
        data_type="STRING",
        null_pct=0.0,
        distinct_count=7,
        top_values=[
            {"value": k, "count": 1, "pct": v}
            for k, v in sorted(label_dist.items(), key=lambda x: -x[1])
        ],
        entropy=_compute_entropy(label_dist),
        psi_distribution=label_dist,
    )

    is_closed_dist = _noisy_distribution(_STAGE_IS_CLOSED_DISTRIBUTION, pct=0.01)
    is_closed_col = ColumnFingerprint(
        name="is_closed",
        data_type="BOOL",
        null_pct=0.0,
        distinct_count=2,
        top_values=[
            {"value": k, "count": round(v * 7), "pct": v}
            for k, v in sorted(is_closed_dist.items(), key=lambda x: -x[1])
        ],
        entropy=_compute_entropy(is_closed_dist),
        psi_distribution=is_closed_dist,
    )

    prob_col = ColumnFingerprint(
        name="probability",
        data_type="FLOAT64",
        null_pct=0.0,
        distinct_count=7,
        min_val=0.0,
        max_val=1.0,
        mean=_noise(_PROBABILITY_STATS["mean"], 0.01),
        stddev=_noise(_PROBABILITY_STATS["stddev"], 0.02),
        p1=0.0,
        p25=_PROBABILITY_STATS["p25"],
        p50=_PROBABILITY_STATS["p50"],
        p75=_PROBABILITY_STATS["p75"],
        p99=_PROBABILITY_STATS["p99"],
    )

    schema_raw = [{"name": c["name"], "data_type": c["data_type"]} for c in _STAGE_TABLE_SCHEMA]
    return TableFingerprint(
        fingerprint_id=str(uuid.uuid4()),
        connection_id=connection_id,
        project_id=project_id,
        dataset_id="hubspot",
        table_name="deal_pipeline_stage",
        row_count=_STAGE_ROW_COUNT_BASE,
        computed_at=computed_at,
        schema_hash=_schema_hash(schema_raw),
        columns=[label_col, is_closed_col, prob_col],
        is_synthetic=True,
    )


def seed(
    n: int,
    project_id: str,
    meta_dataset: str,
    connection_id: str,
    dry_run: bool = False,
) -> None:
    # Generate n fingerprints spaced ~3 days apart, ending at now
    now = datetime.now(timezone.utc)
    timestamps = [now - timedelta(days=(n - 1 - i) * 3) for i in range(n)]
    deal_row_counts = [_DEAL_ROW_COUNT_BASE + random.randint(-1, 3) for _ in range(n)]

    deal_fps = [
        _make_deal_fingerprint(connection_id, project_id, ts, rc)
        for ts, rc in zip(timestamps, deal_row_counts)
    ]
    stage_fps = [
        _make_stage_fingerprint(connection_id, project_id, ts)
        for ts in timestamps
    ]
    all_fps = deal_fps + stage_fps

    if dry_run:
        for fp in all_fps:
            print(json.dumps(fp.model_dump(mode="json"), indent=2, default=str))
            print("---")
        print(f"\n[dry-run] {len(deal_fps)} deal + {len(stage_fps)} deal_pipeline_stage — nothing written.")
        return

    from google.cloud import bigquery  # noqa: PLC0415
    client = bigquery.Client(project=project_id)
    fingerprinter = BigQueryFingerprinter(client, project_id, meta_dataset)

    for fp in all_fps:
        fingerprinter.store_fingerprint(fp)
        print(
            f"  {fp.table_name:<25} {fp.fingerprint_id}  "
            f"(computed_at={fp.computed_at.date()}) [is_synthetic=True]"
        )

    print(f"\nSeeded {len(deal_fps)} x deal + {len(stage_fps)} x deal_pipeline_stage fingerprints.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--n", type=int, default=5, help="Number of fingerprints to seed (default: 5)")
    parser.add_argument("--dry-run", action="store_true", help="Print JSON without writing to BigQuery")
    args = parser.parse_args()

    seed(
        n=args.n,
        project_id=os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915"),
        meta_dataset=os.environ.get("BIGQUERY_META_DATASET", "tiresias_meta"),
        connection_id=os.environ.get("FIVETRAN_CONNECTOR_ID", "demo_connector"),
        dry_run=args.dry_run,
    )
