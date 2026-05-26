"""Top-level orchestrator — coordinates Memory, Lineage, Oracle, and Fivetran MCP."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog

from lineage.graph import LineageGraph
from memory.fingerprint import DriftReport
from oracle.inference import DriftClassification, OracleAgent, OracleVerdict

log = structlog.get_logger(__name__)


@dataclass
class PendingAction:
    report_id: str
    connector_id: str
    schema_name: str       # discovered at runtime from get_connection_schema_config
    table_name: str
    oracle_verdict: OracleVerdict
    proposed_fix: str      # human-readable; shown in dashboard
    schema_check: dict     # raw Fivetran response from get_schema_config
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def _extract_schema_name(schema_config: dict, table_name: str) -> str | None:
    """Find the Fivetran schema name that contains the given table."""
    schemas = schema_config.get("data", {}).get("schemas", {})
    for schema_name, schema_data in schemas.items():
        if isinstance(schema_data, dict) and table_name in schema_data.get("tables", {}):
            return schema_name
    return None


class TiresiasOrchestrator:
    def __init__(
        self,
        fingerprinter: Any | None,   # BigQueryFingerprinter; None in demo mode
        lineage_graph: LineageGraph,
        oracle: OracleAgent,
        mcp_client: Any,             # FivetranMCPClient or FivetranRestClient
        config: dict[str, Any],
    ) -> None:
        self._memory = fingerprinter
        self._lineage = lineage_graph
        self._oracle = oracle
        self._mcp = mcp_client
        self._config = config
        self._pending: dict[str, PendingAction] = {}

    async def handle_sync_completed(
        self,
        connector_id: str,
        dataset: str,
        table: str,
        drift_report: DriftReport | None = None,
    ) -> dict:
        """
        Full pipeline: schema check → Memory → Lineage → Oracle → pending verdict.

        drift_report may be injected directly (demo/test); if None, Memory computes it
        from BigQuery. The MCP schema check always runs against the real Fivetran API.
        """
        self._audit("sync_received", connector_id=connector_id, table=f"{dataset}.{table}")

        # --- read-only schema check (no FIVETRAN_ALLOW_WRITES) ---
        schema_config = await self._mcp.get_schema_config(connector_id)
        schema_name = _extract_schema_name(schema_config, table)
        self._audit(
            "schema_check",
            connector_id=connector_id,
            table=table,
            fivetran_schema=schema_name,
        )

        # --- Memory: compute drift ---
        if drift_report is None:
            if self._memory is None:
                raise ValueError("fingerprinter required when drift_report is not provided")
            drift_report = self._run_memory(connector_id, dataset, table)

        if not drift_report.is_anomalous:
            self._audit("no_anomaly", connector_id=connector_id, table=table)
            return {"status": "clean", "table": f"{dataset}.{table}"}

        # --- Lineage: blast radius ---
        changed_column = drift_report.max_psi_column or ""
        blast_radius = self._lineage.blast_radius(table, changed_column)

        # --- Oracle: classify ---
        verdict = self._oracle.classify(drift_report, blast_radius)
        self._audit(
            "oracle_verdict",
            report_id=drift_report.report_id,
            classification=verdict.classification.value,
            confidence=verdict.confidence,
        )

        if verdict.classification != DriftClassification.SILENT_SEMANTIC_FAILURE:
            return {
                "status": "no_action_needed",
                "classification": verdict.classification.value,
                "confidence": verdict.confidence,
                "reasoning": verdict.reasoning,
            }

        # --- Queue pending approval ---
        if schema_name is None:
            schema_name = "unknown"
            log.warning("schema_name_not_found", table=table, connector_id=connector_id)

        proposed_fix = (
            f"Quarantine {table} at Fivetran source (enabled=false on schema '{schema_name}'). "
            f"No future syncs of this table will reach BigQuery until re-enabled. "
            f"Engineer fix: {verdict.recommended_action}"
        )

        action = PendingAction(
            report_id=drift_report.report_id,
            connector_id=connector_id,
            schema_name=schema_name,
            table_name=table,
            oracle_verdict=verdict,
            proposed_fix=proposed_fix,
            schema_check=schema_config,
        )
        self._pending[action.report_id] = action
        self._audit(
            "pending_approval",
            report_id=action.report_id,
            table=table,
            schema_name=schema_name,
            proposed_fix=proposed_fix,
        )

        return {
            "status": "pending_approval",
            "report_id": action.report_id,
            "classification": verdict.classification.value,
            "confidence": verdict.confidence,
            "reasoning": verdict.reasoning,
            "affected_columns": verdict.affected_columns,
            "blast_radius_summary": verdict.blast_radius_summary,
            "proposed_fix": proposed_fix,
        }

    async def execute_approved(self, report_id: str) -> dict:
        """
        Execute the approved quarantine action.

        Gate 1: report_id must exist in _pending (set by handle_sync_completed).
        Gate 2: quarantine_table spawns a subprocess with FIVETRAN_ALLOW_WRITES=true.
        Both must hold for the write to proceed. The pop() also prevents double-execution.
        """
        action = self._pending.pop(report_id, None)
        if action is None:
            raise KeyError(f"No pending action for report_id={report_id!r}")

        quarantine_result = await self._mcp.quarantine_table(
            action.connector_id, action.schema_name, action.table_name
        )

        self._audit(
            "quarantine_executed",
            report_id=report_id,
            connector_id=action.connector_id,
            mcp_tool="modify_connection_table_config",
            schema_name=action.schema_name,
            table_name=action.table_name,
            enabled=False,
            oracle_classification=action.oracle_verdict.classification.value,
            oracle_confidence=action.oracle_verdict.confidence,
        )

        return {
            "status": "executed",
            "report_id": report_id,
            "mcp_tool": "modify_connection_table_config",
            "quarantined": f"{action.schema_name}.{action.table_name}",
            "fivetran_response": quarantine_result,
            "next_step": (
                f"Re-enable {action.table_name} in Fivetran after deploying the dbt fix. "
                f"{action.oracle_verdict.recommended_action}"
            ),
        }

    def execute_dismissed(self, report_id: str) -> dict:
        action = self._pending.pop(report_id, None)
        if action is None:
            raise KeyError(f"No pending action for report_id={report_id!r}")
        self._audit("dismissed", report_id=report_id)
        return {"status": "dismissed", "report_id": report_id}

    def _run_memory(self, connector_id: str, dataset: str, table: str) -> DriftReport:
        current = self._memory.compute_fingerprint(dataset, table, connector_id)
        baseline = self._memory.get_recent_fingerprints(dataset, table, n=7)
        if not baseline:
            raise ValueError(f"No baseline fingerprints for {dataset}.{table}")
        return self._memory.compare(current, baseline)

    def _audit(self, event: str, **kwargs: Any) -> None:
        log.info(event, **kwargs)
