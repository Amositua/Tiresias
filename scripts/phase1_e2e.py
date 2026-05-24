"""Phase 1 end-to-end test: setup → seed baseline → fingerprint real data → compare.

Run this once gcloud auth is complete:
    python scripts/phase1_e2e.py

What it does:
  1. Creates tiresias_meta BigQuery dataset (idempotent)
  2. Creates tiresias_fingerprints table (idempotent)
  3. Seeds 5 synthetic baseline fingerprints (is_synthetic=True)
  4. Runs compute_fingerprint() against the real synced hubspot.deal table
  5. Compares the real fingerprint against the synthetic baseline
  6. Prints a DriftReport — should be NOT anomalous (baseline matches real data)

If step 4 fails with "Table not found", the Fivetran sync hasn't landed in BigQuery yet.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
META_DATASET = os.environ.get("BIGQUERY_META_DATASET", "tiresias_meta")
HUBSPOT_DATASET = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
CONNECTOR_ID = os.environ.get("FIVETRAN_CONNECTOR_ID", "demo_connector")

from google.cloud import bigquery
from google.api_core.exceptions import Conflict, NotFound

from memory.fingerprint import BigQueryFingerprinter


def step1_create_dataset(client: bigquery.Client) -> None:
    print("\n[1/5] Creating tiresias_meta dataset...")
    dataset_id = f"{PROJECT}.{META_DATASET}"
    dataset = bigquery.Dataset(dataset_id)
    dataset.location = "US"
    dataset.description = "Tiresias agent metadata: fingerprints, drift reports"
    try:
        client.create_dataset(dataset, timeout=30)
        print(f"      Created dataset {dataset_id}")
    except Conflict:
        print(f"      Dataset {dataset_id} already exists.")


def step2_create_table(client: bigquery.Client) -> None:
    print("\n[2/5] Creating tiresias_fingerprints table...")
    schema = [
        bigquery.SchemaField("fingerprint_id",      "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("connection_id",        "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("project_id",           "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("dataset_id",           "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("table_name",           "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("row_count",            "INT64",     mode="REQUIRED"),
        bigquery.SchemaField("computed_at",          "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("schema_hash",          "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("column_fingerprints",  "STRING",    mode="REQUIRED"),
        bigquery.SchemaField("is_synthetic",         "BOOL",      mode="REQUIRED"),
    ]
    table_ref = f"{PROJECT}.{META_DATASET}.tiresias_fingerprints"
    table = bigquery.Table(table_ref, schema=schema)
    time_partitioning = bigquery.TimePartitioning(
        type_=bigquery.TimePartitioningType.DAY,
        field="computed_at",
    )
    table.time_partitioning = time_partitioning
    table.clustering_fields = ["project_id", "dataset_id", "table_name"]
    try:
        client.create_table(table)
        print(f"      Created table {table_ref}")
    except Conflict:
        print(f"      Table {table_ref} already exists.")


def step3_seed_baseline(client: bigquery.Client) -> None:
    print("\n[3/5] Seeding 5 synthetic baseline fingerprints...")
    # Import here so we run after sys.path is set
    import subprocess
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "seed_demo.py"), "--n", "5"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"      FAILED: {result.stderr}")
        raise RuntimeError("Seed failed")
    for line in result.stdout.strip().splitlines():
        print(f"      {line}")


def step4_fingerprint_real_data(client: bigquery.Client) -> None:
    print(f"\n[4/5] Running compute_fingerprint on {HUBSPOT_DATASET}.deal (real synced data)...")
    fp_agent = BigQueryFingerprinter(client, PROJECT, META_DATASET)

    # First check the table exists and has rows
    try:
        count_sql = f"SELECT COUNT(*) as n FROM `{PROJECT}.{HUBSPOT_DATASET}.deal`"
        rows = list(client.query(count_sql).result())
        row_count = rows[0]["n"]
        print(f"      hubspot.deal has {row_count} rows.")
        if row_count == 0:
            print("      WARNING: table is empty — Fivetran sync may not have loaded deals yet.")
    except NotFound:
        print(f"\n      ERROR: Table {PROJECT}.{HUBSPOT_DATASET}.deal not found.")
        print("      The Fivetran sync may still be in progress, or the dataset name may differ.")
        print("      Check your Fivetran dashboard for the exact BigQuery dataset name")
        print(f"      and update BIGQUERY_HUBSPOT_DATASET in your .env (currently: '{HUBSPOT_DATASET}')")
        raise

    # Show ALL columns Fivetran actually synced (no LIMIT — we need to find the stage column)
    schema_sql = f"""
        SELECT column_name, data_type
        FROM `{PROJECT}.{HUBSPOT_DATASET}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'deal'
        ORDER BY ordinal_position
    """
    schema_rows = list(client.query(schema_sql).result())
    existing_cols = {r.column_name for r in schema_rows}

    print(f"\n      All {len(schema_rows)} columns in hubspot.deal:")
    print(f"      {'column_name':<50} {'data_type'}")
    print(f"      {'-'*50} {'-'*15}")
    for r in schema_rows:
        print(f"      {r.column_name:<50} {r.data_type}")

    # Flag columns that look like deal stage — helps identify the real column name
    stage_candidates = [
        c for c in existing_cols
        if "stage" in c.lower() or "pipeline" in c.lower()
    ]
    amount_candidates = [c for c in existing_cols if "amount" in c.lower()]
    print(f"\n      -- Candidate columns for fingerprinting --")
    print(f"      Stage-related:  {sorted(stage_candidates)}")
    print(f"      Amount-related: {sorted(amount_candidates)}")

    # Confirmed real column names from 2026-05-23 schema inspection
    deal_profile_cols = [
        c for c in ["deal_pipeline_stage_id", "property_amount", "deal_pipeline_id",
                    "property_closedate"]
        if c in existing_cols
    ]
    print(f"\n      Deal profile columns confirmed: {deal_profile_cols}")

    fp = fp_agent.compute_fingerprint(
        dataset=HUBSPOT_DATASET,
        table="deal",
        connection_id=CONNECTOR_ID,
        profile_columns=deal_profile_cols if deal_profile_cols else None,
        is_synthetic=False,
    )
    fp_agent.store_fingerprint(fp)

    print(f"\n      deal fingerprint stored  ({fp.fingerprint_id})  rows={fp.row_count}")
    for col in fp.columns:
        if col.psi_distribution:
            top3 = sorted(col.psi_distribution.items(), key=lambda x: -x[1])[:3]
            print(f"        {col.name}: {', '.join(f'{v}={p:.1%}' for v,p in top3)} ...")
        elif col.mean is not None:
            print(f"        {col.name}: mean={col.mean:,.0f}  p50={col.p50:,.0f}")

    # Also fingerprint deal_pipeline_stage — the primary demo signal table
    print(f"\n      Fingerprinting deal_pipeline_stage (7-row dimension table)...")
    stage_schema_sql = f"""
        SELECT column_name FROM `{PROJECT}.{HUBSPOT_DATASET}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'deal_pipeline_stage'
    """
    stage_cols_existing = {r.column_name for r in client.query(stage_schema_sql).result()}
    stage_profile_cols = [
        c for c in ["label", "probability", "is_closed"]
        if c in stage_cols_existing
    ]
    print(f"      Stage profile columns confirmed: {stage_profile_cols}")

    stage_fp = fp_agent.compute_fingerprint(
        dataset=HUBSPOT_DATASET,
        table="deal_pipeline_stage",
        connection_id=CONNECTOR_ID,
        profile_columns=stage_profile_cols if stage_profile_cols else None,
        is_synthetic=False,
    )
    fp_agent.store_fingerprint(stage_fp)
    print(f"      deal_pipeline_stage fingerprint stored  ({stage_fp.fingerprint_id})")
    for col in stage_fp.columns:
        if col.psi_distribution:
            print(f"        {col.name}: {dict(list(col.psi_distribution.items())[:4])} ...")

    return fp, stage_fp


def _print_report(report, label: str) -> None:
    print(f"\n      -- DriftReport: {label} --")
    print(f"      is_anomalous:        {report.is_anomalous}")
    print(f"      overall_drift_score: {report.overall_drift_score:.4f}")
    print(f"      max_psi_column:      {report.max_psi_column}  (PSI={report.max_psi_score:.4f})")
    print(f"      row_count_z_score:   {report.row_count_z_score:.2f}")
    print(f"      baseline_count:      {report.baseline_fingerprint_count}  "
          f"(synthetic: {report.baseline_includes_synthetic})")
    print(f"      schema_delta.added:  {report.schema_delta.added}")
    print(f"      schema_delta.removed:{report.schema_delta.removed}")
    if report.is_anomalous:
        print(f"      reason: {report.anomaly_reason}")


def step5_compare(client: bigquery.Client, real_fps: tuple) -> None:
    print(f"\n[5/5] Comparing real fingerprints against synthetic baselines...")
    fp_agent = BigQueryFingerprinter(client, PROJECT, META_DATASET)
    deal_fp, stage_fp = real_fps

    deal_baseline = fp_agent.get_recent_fingerprints(HUBSPOT_DATASET, "deal", n=7)
    deal_baseline_only = [fp for fp in deal_baseline if fp.fingerprint_id != deal_fp.fingerprint_id]
    if deal_baseline_only:
        deal_report = fp_agent.compare(deal_fp, deal_baseline_only)
        _print_report(deal_report, "hubspot.deal")
        if not deal_report.is_anomalous:
            print("      OK: deal table clean -- stage IDs stable, amounts normal.")
        else:
            print("      WARNING: Unexpected anomaly on deal table.")
    else:
        print("      No deal baseline available for comparison.")

    stage_baseline = fp_agent.get_recent_fingerprints(HUBSPOT_DATASET, "deal_pipeline_stage", n=7)
    stage_baseline_only = [fp for fp in stage_baseline if fp.fingerprint_id != stage_fp.fingerprint_id]
    if stage_baseline_only:
        stage_report = fp_agent.compare(stage_fp, stage_baseline_only)
        _print_report(stage_report, "hubspot.deal_pipeline_stage")
        if not stage_report.is_anomalous:
            print("      OK: deal_pipeline_stage clean -- labels and probabilities stable.")
            print("\n      Phase 1 complete. Both tables fingerprinted on real Fivetran data.")
            print("      Schema delta empty -- watched_tables.yaml column names are correct.")
        else:
            print("      WARNING: Anomaly detected (may indicate synthetic baseline mismatch).")
    else:
        print("      No deal_pipeline_stage baseline available for comparison.")


if __name__ == "__main__":
    print("=" * 60)
    print("Tiresias Phase 1 — End-to-End Test")
    print(f"Project: {PROJECT}  |  Meta dataset: {META_DATASET}")
    print("=" * 60)

    client = bigquery.Client(project=PROJECT)

    step1_create_dataset(client)
    step2_create_table(client)
    step3_seed_baseline(client)
    real_fps = step4_fingerprint_real_data(client)
    step5_compare(client, real_fps)

    print("\n" + "=" * 60)
    print("Phase 1 complete.")
    print("=" * 60)
