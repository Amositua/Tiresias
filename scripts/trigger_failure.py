"""Trigger the silent semantic failure for testing.

Modes:
  simulation  -- direct BigQuery edit (dev only, no Fivetran sync)
  authentic   -- renames stage in HubSpot then triggers a real Fivetran sync
  reset       -- undoes either mode

Usage:
    python scripts/trigger_failure.py --mode authentic
    python scripts/trigger_failure.py --mode simulation
    python scripts/trigger_failure.py --mode reset
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

OLD_STAGE = "Contract Sent"
NEW_STAGE = "Contract Under Review"


def run_simulation(project: str, dataset: str) -> None:
    print("simulation mode -- direct BigQuery edit, no Fivetran sync involved")

    from google.cloud import bigquery

    client = bigquery.Client(project=project)
    table = f"`{project}.{dataset}.deal`"

    sql = f"""
        UPDATE {table}
        SET dealstage = @new_stage
        WHERE dealstage = @old_stage
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("old_stage", "STRING", OLD_STAGE),
            bigquery.ScalarQueryParameter("new_stage", "STRING", NEW_STAGE),
        ]
    )
    job = client.query(sql, job_config=job_config)
    job.result()
    print(f"updated {job.num_dml_affected_rows} rows: '{OLD_STAGE}' -> '{NEW_STAGE}'")


def run_authentic() -> None:
    import httpx

    hs_token = os.environ["HUBSPOT_ACCESS_TOKEN"]
    fivetran_key = os.environ["FIVETRAN_API_KEY"]
    fivetran_secret = os.environ["FIVETRAN_API_SECRET"]
    connector_id = os.environ["FIVETRAN_CONNECTOR_ID"]

    print("authentic mode -- HubSpot rename + Fivetran sync")

    print(f"\n[1/3] Finding pipeline stage '{OLD_STAGE}' in HubSpot...")
    hs_headers = {
        "Authorization": f"Bearer {hs_token}",
        "Content-Type": "application/json",
    }
    pipelines_resp = httpx.get(
        "https://api.hubapi.com/crm/v3/pipelines/deals",
        headers=hs_headers,
    )
    pipelines_resp.raise_for_status()

    stage_id = None
    pipeline_id = None
    for pipeline in pipelines_resp.json()["results"]:
        if pipeline.get("label") == "Sales Pipeline":
            pipeline_id = pipeline["id"]
            for stage in pipeline.get("stages", []):
                if stage.get("label") == OLD_STAGE:
                    stage_id = stage["id"]
                    break
        if stage_id:
            break

    if not stage_id:
        raise RuntimeError(
            f"Stage '{OLD_STAGE}' not found in HubSpot 'Sales Pipeline'. "
            "Check HubSpot Settings -> Pipelines."
        )
    print(f"    pipeline_id={pipeline_id}, stage_id={stage_id}")

    print(f"\n[2/3] Renaming '{OLD_STAGE}' -> '{NEW_STAGE}'...")
    httpx.patch(
        f"https://api.hubapi.com/crm/v3/pipelines/deals/{pipeline_id}/stages/{stage_id}",
        headers=hs_headers,
        json={"label": NEW_STAGE},
    ).raise_for_status()
    print("    done")

    print(f"\n[3/3] Triggering Fivetran sync ({connector_id})...")
    httpx.post(
        f"https://api.fivetran.com/v1/connectors/{connector_id}/sync",
        auth=(fivetran_key, fivetran_secret),
        json={"force": True},
    ).raise_for_status()
    print("    sync triggered")


def run_reset(mode: str, project: str, dataset: str) -> None:
    if mode == "simulation":
        from google.cloud import bigquery

        client = bigquery.Client(project=project)
        table = f"`{project}.{dataset}.deal`"
        sql = f"""
            UPDATE {table}
            SET dealstage = @old_stage
            WHERE dealstage = @new_stage
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("old_stage", "STRING", OLD_STAGE),
                bigquery.ScalarQueryParameter("new_stage", "STRING", NEW_STAGE),
            ]
        )
        job = client.query(sql, job_config=job_config)
        job.result()
        print(f"reverted {job.num_dml_affected_rows} rows")
    else:
        print("rename the stage back in HubSpot Settings -> Pipelines, then trigger a Fivetran sync")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["simulation", "authentic", "reset"], required=True)
    parser.add_argument("--reset-mode", choices=["simulation", "authentic"], default="simulation")
    args = parser.parse_args()

    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
    dataset = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")

    if args.mode == "simulation":
        run_simulation(project, dataset)
    elif args.mode == "authentic":
        run_authentic()
    elif args.mode == "reset":
        run_reset(args.reset_mode, project, dataset)
