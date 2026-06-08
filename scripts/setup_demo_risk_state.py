"""
Reset the risk forecast for deal_pipeline_stage to a clean baseline (LOW risk, no past drifts).

What this does:
  1. Wipes ALL fingerprints for deal_pipeline_stage
  2. Stores 5 clean baseline fingerprints staggered over the past 2 weeks

Result:
  LOW risk · 0 past drifts · clean baseline ready for demo

Usage:
    cd backend
    python ../scripts/setup_demo_risk_state.py
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

project     = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
dataset     = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
meta        = os.environ.get("BIGQUERY_META_DATASET", "tiresias_meta")
connector   = os.environ.get("FIVETRAN_CONNECTOR_ID", "wanderer_financing")
table_id    = f"{project}.{meta}.tiresias_fingerprints"
temp_id     = f"{project}.{meta}.tiresias_fingerprints_setup_tmp"

from google.cloud import bigquery as bq
from memory.fingerprint import BigQueryFingerprinter

client      = bq.Client(project=project)
fp_client   = BigQueryFingerprinter(client, project, meta)
now         = datetime.now(timezone.utc)


# ── Step 1: wipe ALL fingerprints for deal_pipeline_stage ────────────────────

print("Step 1 — wiping all fingerprints for deal_pipeline_stage ...")
client.query(f"""
    CREATE OR REPLACE TABLE `{temp_id}`
    PARTITION BY DATE(computed_at)
    CLUSTER BY project_id, dataset_id, table_name
    AS
    SELECT * FROM `{table_id}`
    WHERE NOT (
        table_name  = 'deal_pipeline_stage'
        AND dataset_id = 'hubspot'
    )
""").result()

client.delete_table(table_id)

client.query(f"""
    CREATE OR REPLACE TABLE `{table_id}`
    PARTITION BY DATE(computed_at)
    CLUSTER BY project_id, dataset_id, table_name
    AS SELECT * FROM `{temp_id}`
""").result()

client.delete_table(temp_id)
print("  done.")


# ── Step 2: capture the live clean fingerprint ────────────────────────────────

print(f"\nStep 2 — capturing live fingerprint from {project}.{dataset}.deal_pipeline_stage ...")
live = fp_client.compute_fingerprint(dataset, "deal_pipeline_stage", connector)

label_col = next((c for c in live.columns if c.name == "label"), None)
if label_col is None:
    print("  ERROR: 'label' column not found. Make sure HubSpot is reset to 'Contract Sent'.")
    sys.exit(1)

print(f"  label distribution: {label_col.psi_distribution}")


# ── Step 3: store 5 clean baseline fingerprints ──────────────────────────────

print("\nStep 3 — storing 5 clean baseline fingerprints ...")
for i, offset in enumerate([14, 10, 7, 4, 0]):
    fp = live.model_copy(update={
        "fingerprint_id": str(uuid.uuid4()),
        "computed_at": now - timedelta(days=offset),
        "is_synthetic": False,
    })
    fp_client.store_fingerprint(fp)
    print(f"  stored  computed_at={fp.computed_at.date()}")


# ── Done ──────────────────────────────────────────────────────────────────────

print("""
Done. Restart the backend and check /monitoring/risk-forecast.

Expected state:
  deal_pipeline_stage — LOW risk · 0 past drifts · clean baseline
""")
