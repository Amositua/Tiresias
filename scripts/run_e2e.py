"""
End-to-end demo: simulated webhook → schema check → Memory/Lineage/Oracle → approval → quarantine.

Injects the pre-computed demo DriftReport (deal_pipeline_stage.label rename) so Memory/BigQuery
is not required. The MCP schema check and quarantine calls are real Fivetran API calls.

Usage:
    python scripts/run_e2e.py                  # interactive approval prompt
    python scripts/run_e2e.py --auto-approve   # approve automatically (for scripted demos)
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from lineage.graph import LineageGraph
from memory.fingerprint import (
    ColumnDrift,
    ColumnFingerprint,
    DriftReport,
    SchemaDelta,
    TableFingerprint,
)
from oracle.inference import OracleAgent
from tiresias.mcp_client import FivetranMCPClient
from tiresias.orchestrator import TiresiasOrchestrator

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
CONNECTOR_ID = os.environ.get("FIVETRAN_CONNECTOR_ID", "")
MANIFEST = str(
    Path(__file__).parent.parent / "backend" / "tests" / "fixtures" / "manifest.json"
)

_SEP = "-" * 60


def _build_drift_report() -> DriftReport:
    label_dist_current = {
        "Contract Under Review": 0.142857,
        "Qualified To Buy": 0.142857,
        "Appointment Scheduled": 0.142857,
        "Decision Maker Bought": 0.142857,
        "Presentation Scheduled": 0.142857,
        "Closed Won": 0.142857,
        "Closed Lost": 0.142857,
    }
    label_dist_baseline = {
        "Contract Sent": 0.142857,
        "Qualified To Buy": 0.142857,
        "Appointment Scheduled": 0.142857,
        "Decision Maker Bought": 0.142857,
        "Presentation Scheduled": 0.142857,
        "Closed Won": 0.142857,
        "Closed Lost": 0.142857,
    }
    current_fp = TableFingerprint(
        connection_id=CONNECTOR_ID,
        project_id=PROJECT,
        dataset_id="hubspot",
        table_name="deal_pipeline_stage",
        row_count=7,
        schema_hash="abc12345abcd1234",
        columns=[
            ColumnFingerprint(
                name="label",
                data_type="STRING",
                null_pct=0.0,
                distinct_count=7,
                top_values=[
                    {"value": k, "count": 1, "pct": round(v, 6)}
                    for k, v in label_dist_current.items()
                ],
                entropy=2.807355,
                psi_distribution=label_dist_current,
            )
        ],
    )
    return DriftReport(
        connection_id=CONNECTOR_ID,
        project_id=PROJECT,
        dataset_id="hubspot",
        table_name="deal_pipeline_stage",
        current_fingerprint=current_fp,
        baseline_fingerprint_count=5,
        baseline_includes_synthetic=False,
        overall_drift_score=2.1,
        max_psi_column="label",
        max_psi_score=2.1,
        row_count_z_score=0.0,
        schema_delta=SchemaDelta(),
        column_drifts=[
            ColumnDrift(
                column_name="label",
                drift_type="PSI_CATEGORICAL",
                psi_score=2.1,
                current_value=str(label_dist_current),
                baseline_value=str(label_dist_baseline),
                is_anomalous=True,
            )
        ],
        is_anomalous=True,
        anomaly_reason="column 'label' PSI=2.100 (threshold 0.25)",
    )


async def main(auto_approve: bool = False) -> None:
    if not CONNECTOR_ID:
        print("ERROR: FIVETRAN_CONNECTOR_ID not set in .env")
        sys.exit(1)

    api_key = os.environ.get("FIVETRAN_API_KEY", "")
    api_secret = os.environ.get("FIVETRAN_API_SECRET", "")
    if not api_key or not api_secret:
        print("ERROR: FIVETRAN_API_KEY / FIVETRAN_API_SECRET not set in .env")
        sys.exit(1)

    lineage = LineageGraph(MANIFEST)
    lineage.load()
    oracle = OracleAgent(project=PROJECT)
    mcp = FivetranMCPClient(api_key, api_secret)

    orch = TiresiasOrchestrator(
        fingerprinter=None,
        lineage_graph=lineage,
        oracle=oracle,
        mcp_client=mcp,
        config={},
    )

    drift_report = _build_drift_report()

    print(_SEP)
    print("STEP 1  simulated webhook: deal_pipeline_stage.label rename detected")
    print(f"        connector_id = {CONNECTOR_ID}")
    print(_SEP)

    result = await orch.handle_sync_completed(
        connector_id=CONNECTOR_ID,
        dataset="hubspot",
        table="deal_pipeline_stage",
        drift_report=drift_report,
    )

    if result.get("status") != "pending_approval":
        print(f"Pipeline returned status={result.get('status')!r} — no approval needed.")
        print(result)
        return

    report_id = result["report_id"]

    print()
    print(_SEP)
    print("STEP 2  MCP schema check (read-only) + Oracle verdict")
    print(_SEP)
    action = orch._pending[report_id]
    print(f"  Fivetran schema name:  {action.schema_name}")
    print(f"  Classification:        {result['classification']}")
    print(f"  Confidence:            {result['confidence']:.2f}")
    print(f"  Reasoning:             {result['reasoning']}")
    print(f"  Affected columns:      {result['affected_columns']}")
    print(f"  Blast radius:          {result['blast_radius_summary']}")
    print()
    print("  Proposed MCP action:")
    print(f"    modify_connection_table_config")
    print(f"      connection_id = {CONNECTOR_ID}")
    print(f"      schema_name   = {action.schema_name}")
    print(f"      table_name    = deal_pipeline_stage")
    print(f"      enabled       = false")

    print()
    print(_SEP)
    print("STEP 3  human approval gate")
    print(_SEP)
    print(f"  report_id: {report_id}")
    print()

    if auto_approve:
        answer = "approve"
        print("  [--auto-approve] Approving automatically.")
    else:
        answer = input("  Type 'approve' to quarantine the table, or anything else to dismiss: ").strip().lower()

    if answer != "approve":
        dismissed = orch.execute_dismissed(report_id)
        print(f"\n  Dismissed. {dismissed}")
        return

    print()
    print(_SEP)
    print("STEP 4  executing MCP quarantine (FIVETRAN_ALLOW_WRITES=true subprocess)")
    print(_SEP)

    exec_result = await orch.execute_approved(report_id)

    print()
    print(f"  Status:         {exec_result['status']}")
    print(f"  MCP tool:       {exec_result['mcp_tool']}")
    print(f"  Quarantined:    {exec_result['quarantined']}")
    print(f"  Next step:      {exec_result['next_step']}")
    print()
    print("  Fivetran API response:")
    import json
    print("  " + json.dumps(exec_result.get("fivetran_response", {}), indent=4).replace("\n", "\n  "))

    print()
    print(_SEP)
    print("STEP 5  audit log")
    print(_SEP)
    print("  All decisions logged via structlog to stdout.")
    print("  Audit fields: report_id, mcp_tool, schema_name, table_name,")
    print("  enabled=false, oracle_classification, oracle_confidence, timestamp.")
    print(_SEP)


if __name__ == "__main__":
    auto = "--auto-approve" in sys.argv
    asyncio.run(main(auto_approve=auto))
