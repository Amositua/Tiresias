"""Top-level orchestrator — coordinates Memory, Lineage, Oracle, and Fivetran MCP."""

from __future__ import annotations

import os
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog

from lineage.graph import BlastRadius, LineageGraph
from memory.fingerprint import DriftReport, PSI_WATCH
from oracle.inference import DriftClassification, OracleAgent, OracleVerdict
from tiresias.slack_client import SlackClient

log = structlog.get_logger(__name__)


@dataclass
class ImpactScore:
    pipeline_value_at_risk: float       # live BigQuery revenue query
    time_to_detect_seconds: float       # actual TTD from sync webhook to verdict
    industry_avg_ttd_seconds: float     # 3.2h benchmark (labeled as estimate)
    hours_saved_this_incident: float    # industry_avg - actual TTD in hours
    incidents_caught_total: int         # running count this session
    total_hours_saved: float            # cumulative across all incidents


@dataclass
class PendingAction:
    report_id: str
    connector_id: str
    schema_name: str
    table_name: str
    oracle_verdict: OracleVerdict
    proposed_fix: str
    schema_check: dict
    blast_radius: BlastRadius | None = None
    drift_report: DriftReport | None = None
    psi_threshold: float = PSI_WATCH
    github_pr_url: str | None = None
    github_pr_number: int | None = None
    github_branch: str | None = None
    impact: ImpactScore | None = None
    sync_received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
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
        self._quarantined: dict[str, PendingAction] = {}
        self._psi_log: deque[dict] = deque(maxlen=200)
        self._slack = SlackClient(os.environ.get("SLACK_WEBHOOK_URL", ""))
        self._incidents_caught: int = 0
        self._total_hours_saved: float = 0.0
        self._industry_avg_ttd_seconds: float = 11_520.0
        self._activity: deque[dict] = deque(maxlen=100)

    def _emit(
        self,
        agent: str,
        event: str,
        message: str,
        status: str = "done",
        report_id: str | None = None,
    ) -> None:
        self._activity.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent": agent,
            "event": event,
            "message": message,
            "status": status,
            "report_id": report_id,
        })

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
        sync_received_at = datetime.now(timezone.utc)
        self._audit("sync_received", connector_id=connector_id, table=f"{dataset}.{table}")
        self._emit("Memory", "sync_received", f"{connector_id} · {dataset}.{table}")

        # --- read-only schema check (no FIVETRAN_ALLOW_WRITES) ---
        self._emit("Memory", "schema_check", "querying Fivetran MCP for live schema config", "running")
        schema_config = await self._mcp.get_schema_config(connector_id)
        schema_name = _extract_schema_name(schema_config, table)
        self._audit(
            "schema_check",
            connector_id=connector_id,
            table=table,
            fivetran_schema=schema_name,
        )
        self._emit("Memory", "schema_check", f"schema '{schema_name}' · {table} located")

        # --- Memory: compute drift ---
        self._emit("Memory", "fingerprinting", f"computing PSI fingerprint · 7-day baseline", "running")
        if drift_report is None:
            if self._memory is None:
                raise ValueError("fingerprinter required when drift_report is not provided")
            drift_report = self._run_memory(connector_id, dataset, table)

        if drift_report.max_psi_column:
            self._emit(
                "Memory", "fingerprint_computed",
                f"PSI {drift_report.max_psi_score:.4f} on '{drift_report.max_psi_column}'"
                f" {'· anomalous' if drift_report.is_anomalous else '· within threshold'}",
            )
        else:
            self._emit("Memory", "fingerprint_computed",
                f"all columns within threshold · row_count z={drift_report.row_count_z_score:.2f}")

        # Append to rolling PSI log regardless of anomaly state
        self._psi_log.append({
            "timestamp": drift_report.computed_at.isoformat(),
            "psi": drift_report.max_psi_score,
            "column": drift_report.max_psi_column,
            "table": table,
            "is_anomalous": drift_report.is_anomalous,
        })

        if not drift_report.is_anomalous:
            self._audit("no_anomaly", connector_id=connector_id, table=table)
            return {"status": "clean", "table": f"{dataset}.{table}"}

        # --- Lineage: blast radius ---
        changed_column = drift_report.max_psi_column or ""
        self._emit("Lineage", "tracing_blast_radius", f"BFS from {table}.{changed_column} through dbt graph", "running")
        blast_radius = self._lineage.blast_radius(table, changed_column)
        owners = [n.owner for n in blast_radius.nodes if n.owner]
        owner_str = f" · {', '.join(set(owners))}" if owners else ""
        self._emit("Lineage", "blast_radius_traced",
            f"{len(blast_radius.nodes)} downstream assets affected{owner_str}")

        # --- Oracle: classify ---
        self._emit("Oracle", "classifying", "Gemini 3.1 Pro · structured reasoning", "running")
        verdict = self._oracle.classify(drift_report, blast_radius)
        self._audit(
            "oracle_verdict",
            report_id=drift_report.report_id,
            classification=verdict.classification.value,
            confidence=verdict.confidence,
        )
        self._emit("Oracle", "verdict_ready",
            f"{verdict.classification.value} · {int(verdict.confidence * 100)}% confidence",
            report_id=drift_report.report_id)

        if verdict.classification != DriftClassification.SILENT_SEMANTIC_FAILURE:
            return {
                "status": "no_action_needed",
                "classification": verdict.classification.value,
                "confidence": verdict.confidence,
                "reasoning": verdict.reasoning,
            }

        # --- Compute business impact score ---
        self._incidents_caught += 1
        ttd_seconds = (datetime.now(timezone.utc) - sync_received_at).total_seconds()
        hours_saved = max((self._industry_avg_ttd_seconds - ttd_seconds) / 3600, 0.0)
        self._total_hours_saved += hours_saved

        pipeline_value = 0.0
        try:
            if self._memory is not None:
                project = self._config.get("project", "tiresias-496915")
                dataset_env = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
                sql = (
                    f"SELECT COALESCE(SUM(d.property_amount), 0) AS v "
                    f"FROM `{project}.{dataset_env}.deal` d "
                    f"JOIN `{project}.{dataset_env}.deal_pipeline_stage` s "
                    f"  ON d.deal_pipeline_stage_id = s.stage_id "
                    f"WHERE s.stage_id = 'contractsent' AND NOT d._fivetran_deleted"
                )
                rows = list(self._memory._client.query(sql).result())
                pipeline_value = float(rows[0]["v"]) if rows else 0.0
        except Exception as exc:
            log.warning("impact_pipeline_query_failed", error=str(exc))

        impact = ImpactScore(
            pipeline_value_at_risk=pipeline_value,
            time_to_detect_seconds=round(ttd_seconds, 1),
            industry_avg_ttd_seconds=self._industry_avg_ttd_seconds,
            hours_saved_this_incident=round(hours_saved, 2),
            incidents_caught_total=self._incidents_caught,
            total_hours_saved=round(self._total_hours_saved, 2),
        )

        # --- Notify Slack: incident detected ---
        try:
            self._slack.notify_incident(
                table=table,
                column=changed_column,
                psi_score=drift_report.max_psi_score,
                psi_threshold=PSI_WATCH,
                confidence=verdict.confidence,
                reasoning=verdict.reasoning,
                blast_radius_nodes=[
                    {"node_type": n.node_type, "label": n.name, "severity": n.severity,
                     "owner": n.owner, "references_column": n.references_column}
                    for n in blast_radius.nodes
                ],
                report_id=drift_report.report_id,
                pipeline_value=impact.pipeline_value_at_risk,
            )
        except Exception as exc:
            log.warning("slack_notify_incident_failed", error=str(exc))

        # --- Generate dbt fix via second Gemini pass ---
        try:
            affected_models = [
                n.name for n in blast_radius.nodes
                if n.references_column and n.node_type == "model"
            ]
            models_sql = self._lineage.get_models_sql(affected_models)
            if models_sql:
                self._emit("Fix", "reading_models",
                    f"reading SQL for {', '.join(m['name'] for m in models_sql)}", "running",
                    report_id=drift_report.report_id)
                fixes = self._oracle.generate_fix(verdict, blast_radius, models_sql)
                verdict = verdict.model_copy(update={"suggested_fixes": fixes})
                if fixes:
                    self._emit("Fix", "fix_generated",
                        f"{len(fixes)} model(s) corrected · stage_id replaces mutable label",
                        report_id=drift_report.report_id)
        except Exception as exc:
            log.warning("fix_generation_failed", error=str(exc))
            self._emit("Fix", "fix_generation_failed", str(exc), "error")

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
            blast_radius=blast_radius,
            drift_report=drift_report,
            impact=impact,
            sync_received_at=sync_received_at,
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

        self._emit("MCP", "quarantine_confirmed",
            f"modify_connection_table_config · {action.schema_name}.{action.table_name} enabled=false",
            report_id=report_id)

        # Notify Slack: quarantined
        try:
            self._slack.notify_quarantined(
                table=action.table_name,
                schema=action.schema_name,
                connector_id=action.connector_id,
            )
        except Exception as exc:
            log.warning("slack_notify_quarantined_failed", error=str(exc))

        # Auto-create GitHub PR with the generated fix
        pr_url, pr_number, branch = None, None, None
        fixes = action.oracle_verdict.suggested_fixes
        if fixes:
            try:
                gh_token = os.environ.get("GITHUB_TOKEN", "")
                gh_repo = os.environ.get("GITHUB_REPO", "")
                if gh_token and gh_repo:
                    from tiresias.github_client import GitHubClient
                    gh = GitHubClient(gh_token, gh_repo)
                    pr_info = gh.create_fix_pr(
                        fixes=fixes,
                        report_id=report_id,
                        table=action.table_name,
                        column=action.oracle_verdict.affected_columns[0] if action.oracle_verdict.affected_columns else "",
                        reasoning=action.oracle_verdict.reasoning,
                    )
                    pr_url = pr_info["pr_url"]
                    pr_number = pr_info["pr_number"]
                    branch = pr_info["branch"]
                    self._audit("github_pr_created", pr_url=pr_url, pr_number=pr_number)
                    self._emit("GitHub", "pr_opened",
                        f"PR #{pr_number} opened · {gh_repo} · {branch}",
                        report_id=report_id)

                    # Notify Slack: PR opened
                    try:
                        self._slack.notify_pr_opened(
                            pr_url=pr_url,
                            pr_number=pr_number,
                            branch=branch,
                            fixes=[
                                {"model_name": f.model_name, "original_snippet": f.original_snippet, "fixed_snippet": f.fixed_snippet}
                                for f in fixes
                            ],
                        )
                    except Exception as slack_exc:
                        log.warning("slack_notify_pr_failed", error=str(slack_exc))
            except Exception as exc:
                log.warning("github_pr_failed", error=str(exc))

        action.github_pr_url = pr_url
        action.github_pr_number = pr_number
        action.github_branch = branch

        # Move to quarantined store — will auto-re-enable when PR is merged
        self._quarantined[report_id] = action

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
            "github_pr_url": pr_url,
            "github_pr_number": pr_number,
        }

    async def check_pr_and_reenable(self, report_id: str) -> dict:
        """Poll GitHub for PR merge status; auto-re-enable if merged."""
        action = self._quarantined.get(report_id)
        if action is None:
            return {"status": "not_found"}

        if not action.github_pr_number:
            return {"status": "no_pr", "report_id": report_id}

        gh_token = os.environ.get("GITHUB_TOKEN", "")
        gh_repo = os.environ.get("GITHUB_REPO", "")
        if not gh_token or not gh_repo:
            return {"status": "no_github_config"}

        try:
            from tiresias.github_client import GitHubClient
            gh = GitHubClient(gh_token, gh_repo)
            pr_state = gh.get_pr_state(action.github_pr_number)
        except Exception as exc:
            log.warning("pr_check_failed", error=str(exc))
            return {"status": "check_failed", "error": str(exc)}

        if pr_state["merged"]:
            # PR merged — automatically re-enable the table
            result = await self.execute_reenabled(report_id)
            result["pr_merged_at"] = pr_state["merged_at"]
            self._audit("auto_reenabled_after_pr_merge", report_id=report_id)
            return result

        return {
            "status": "pr_open",
            "report_id": report_id,
            "pr_state": pr_state["state"],
            "pr_url": pr_state["html_url"],
            "pr_number": action.github_pr_number,
        }

    async def execute_reenabled(self, report_id: str) -> dict:
        """Re-enable a quarantined table after the engineer deploys the dbt fix."""
        action = self._quarantined.pop(report_id, None)
        if action is None:
            raise KeyError(f"No quarantined action for report_id={report_id!r}")

        reenable_result = await self._mcp.reenable_table(
            action.connector_id, action.schema_name, action.table_name
        )
        self._audit(
            "reenable_executed",
            report_id=report_id,
            connector_id=action.connector_id,
            schema_name=action.schema_name,
            table_name=action.table_name,
        )

        self._emit("MCP", "reenable_confirmed",
            f"modify_connection_table_config · {action.schema_name}.{action.table_name} enabled=true · loop closed",
            report_id=report_id)

        # Notify Slack: loop closed
        try:
            self._slack.notify_loop_closed(
                table=action.table_name,
                schema=action.schema_name,
                connector_id=action.connector_id,
                incident_started_at=action.created_at,
            )
        except Exception as exc:
            log.warning("slack_notify_loop_closed_failed", error=str(exc))

        return {
            "status": "reenabled",
            "report_id": report_id,
            "mcp_tool": "modify_connection_table_config",
            "reenabled": f"{action.schema_name}.{action.table_name}",
            "fivetran_response": reenable_result,
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
