"""Run Oracle classification on the demo scenario (deal_pipeline_stage.label rename)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from lineage.graph import LineageGraph
from memory.fingerprint import (
    ColumnDrift,
    ColumnFingerprint,
    DriftReport,
    SchemaDelta,
    TableFingerprint,
)
from oracle.inference import ORACLE_MODEL, OracleAgent

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
MANIFEST = str(Path(__file__).parent.parent / "backend" / "tests" / "fixtures" / "manifest.json")


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
        connection_id="wanderer_financing",
        project_id="tiresias-496915",
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
        connection_id="wanderer_financing",
        project_id="tiresias-496915",
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


def main() -> None:
    drift_report = _build_drift_report()

    g = LineageGraph(MANIFEST)
    g.load()
    blast_radius = g.blast_radius("deal_pipeline_stage", "label")

    print(f"Calling Oracle ({ORACLE_MODEL})...")
    agent = OracleAgent(project=PROJECT)
    verdict = agent.classify(drift_report, blast_radius)

    print("\n=== ORACLE VERDICT ===")
    print(f"Classification:     {verdict.classification.value}")
    print(f"Confidence:         {verdict.confidence:.2f}")
    print(f"\nReasoning:\n  {verdict.reasoning}")
    print(f"\nAffected columns:   {verdict.affected_columns}")
    print(f"\nRecommended action:\n  {verdict.recommended_action}")
    print(f"\nBlast radius:       {verdict.blast_radius_summary}")
    print(f"\nModel:              {verdict.model_used}")
    print(f"Baseline:           {verdict.baseline_fingerprint_count} fingerprints, "
          f"synthetic={verdict.baseline_includes_synthetic}")

    if verdict.thought_text:
        print(f"\n--- THOUGHT (audit only) ---")
        print(verdict.thought_text[:800])
        if len(verdict.thought_text) > 800:
            print(f"... [{len(verdict.thought_text)} chars total]")


if __name__ == "__main__":
    main()
