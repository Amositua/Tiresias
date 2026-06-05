"""
Remove anomalous demo-run fingerprints so the risk forecast starts at LOW.

BigQuery note: rows written via streaming insert cannot be deleted for
up to 90 minutes. If you see a streaming buffer error, wait 30-60 minutes
and run this script again.

Usage:
    python scripts/reset_risk_history.py
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env", override=True)

from google.cloud import bigquery

project  = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
meta     = "tiresias_meta"
table_id = f"{project}.{meta}.tiresias_fingerprints"
temp_id  = f"{project}.{meta}.tiresias_fingerprints_clean"

client = bigquery.Client(project=project)

# Step 1: Write clean rows to a temp table (preserving partitioning/clustering)
print("Creating clean temp table...")
step1 = f"""
CREATE OR REPLACE TABLE `{temp_id}`
PARTITION BY DATE(computed_at)
CLUSTER BY project_id, dataset_id, table_name
AS
SELECT * FROM `{table_id}`
WHERE NOT (
    table_name    = 'deal_pipeline_stage'
    AND dataset_id  = 'hubspot'
    AND is_synthetic = false
    AND computed_at >= '2026-06-01T00:00:00Z'
)
"""
client.query(step1).result()
print("Temp table created.")

# Step 2: Drop original table
print("Dropping original table...")
client.delete_table(table_id)
print("Dropped.")

# Step 3: Rename temp to original
print("Restoring clean table...")
step3 = f"""
CREATE OR REPLACE TABLE `{table_id}`
PARTITION BY DATE(computed_at)
CLUSTER BY project_id, dataset_id, table_name
AS SELECT * FROM `{temp_id}`
"""
client.query(step3).result()
print("Restored.")

# Step 4: Drop temp
client.delete_table(temp_id)
print("Done — anomalous fingerprints removed.")
print()
print("Now run:  python scripts/capture_baseline.py")
