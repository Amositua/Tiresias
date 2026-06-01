"""Tiresias backend API."""

from __future__ import annotations

import hashlib
import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)

import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lineage.graph import BlastRadius, LineageGraph
from oracle.inference import OracleAgent
from tiresias.orchestrator import PendingAction, TiresiasOrchestrator

log = structlog.get_logger(__name__)

_orchestrator: TiresiasOrchestrator | None = None


def _build_orchestrator() -> TiresiasOrchestrator:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
    manifest = os.environ.get(
        "DBT_MANIFEST_PATH",
        str(__import__("pathlib").Path(__file__).parent.parent / "tests" / "fixtures" / "manifest.json"),
    )
    api_key = os.environ.get("FIVETRAN_API_KEY", "")
    api_secret = os.environ.get("FIVETRAN_API_SECRET", "")

    lineage = LineageGraph(manifest)
    lineage.load()
    oracle = OracleAgent(project=project)

    use_rest = os.environ.get("FIVETRAN_USE_REST_FALLBACK", "false").lower() == "true"
    if use_rest:
        from tiresias.fivetran_rest import FivetranRestClient
        mcp_client: Any = FivetranRestClient(api_key, api_secret)
        log.warning("fivetran_rest_fallback_active")
    else:
        from tiresias.mcp_client import FivetranMCPClient
        mcp_client = FivetranMCPClient(api_key, api_secret)

    fingerprinter = None
    if os.environ.get("BIGQUERY_HUBSPOT_DATASET"):
        try:
            from google.cloud import bigquery
            from memory.fingerprint import BigQueryFingerprinter
            bq = bigquery.Client(project=project)
            fingerprinter = BigQueryFingerprinter(bq, project)
        except Exception as exc:
            log.warning("fingerprinter_init_failed", error=str(exc))

    return TiresiasOrchestrator(
        fingerprinter=fingerprinter,
        lineage_graph=lineage,
        oracle=oracle,
        mcp_client=mcp_client,
        config={"project": project},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator
    _orchestrator = _build_orchestrator()
    log.info("orchestrator_ready")
    yield
    _orchestrator = None


app = FastAPI(
    title="Tiresias",
    description="Pre-cognitive data quality agent for Fivetran pipelines",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_orchestrator() -> TiresiasOrchestrator:
    if _orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not ready")
    return _orchestrator


# ── health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "agent": "tiresias"}


# ── dev trigger (disabled unless TIRESIAS_DEV_TRIGGERS=true) ─────────────────

_DEV_TRIGGERS = os.environ.get("TIRESIAS_DEV_TRIGGERS", "").lower() == "true"


@app.post("/dev/trigger")
async def dev_trigger(request: Request) -> dict:
    """Run the full pipeline without Fivetran signature verification.

    Only active when TIRESIAS_DEV_TRIGGERS=true.  Never set that flag in
    production.  The Memory → Lineage → Oracle → MCP path is identical to
    the real webhook — only the signature check is skipped.
    """
    if not _DEV_TRIGGERS:
        raise HTTPException(status_code=404, detail="Not found")

    payload = await request.json()
    connector_id = payload.get("connector_id", "wanderer_financing")
    schema = payload.get("schema", "hubspot")
    table = payload.get("table", "deal_pipeline_stage")

    log.info("dev_trigger", connector_id=connector_id, table=f"{schema}.{table}")
    orch = _require_orchestrator()
    return await orch.handle_sync_completed(connector_id, schema, table)


# ── fivetran webhook ──────────────────────────────────────────────────────────

@app.post("/webhook/fivetran")
async def fivetran_webhook(
    request: Request,
    x_fivetran_signature: str | None = Header(None),
) -> dict:
    body = await request.body()
    _verify_fivetran_signature(body, x_fivetran_signature)

    payload = await request.json()
    event_type = payload.get("event")
    connector_id = payload.get("connector_id")
    schema = payload.get("schema", "hubspot")
    table = payload.get("table", "deal_pipeline_stage")

    if event_type != "sync_end":
        return {"status": "ignored", "event": event_type}

    log.info("fivetran_sync_completed", connector_id=connector_id)
    orch = _require_orchestrator()
    return await orch.handle_sync_completed(connector_id, schema, table)


def _verify_fivetran_signature(body: bytes, signature: str | None) -> None:
    secret = os.environ.get("FIVETRAN_WEBHOOK_SECRET", "")
    if not secret:
        return
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise HTTPException(status_code=401, detail="Invalid Fivetran signature")


# ── verdicts ──────────────────────────────────────────────────────────────────

class VerdictResponse(BaseModel):
    report_id: str
    status: str
    classification: str
    confidence: float
    reasoning: str
    affected_columns: list[str]
    recommended_action: str
    proposed_mcp_action: str
    blast_radius_summary: str
    blast_radius_graph: dict
    created_at: str
    # drift metrics
    psi_score: float
    psi_column: str | None
    psi_threshold: float
    row_delta_z: float
    anomaly_reason: str | None
    schema_added: list[str]
    schema_removed: list[str]
    dist_baseline: dict[str, float]
    dist_current: dict[str, float]


def _blast_radius_to_graph(br: BlastRadius | None) -> dict:
    if br is None:
        return {"nodes": [], "edges": []}
    source_node = {
        "id": br.source_table,
        "label": br.source_table,
        "node_type": "source",
        "severity": "flagged",
        "owner": None,
        "references_column": False,
    }
    downstream = [
        {
            "id": n.name,
            "label": n.name,
            "node_type": n.node_type,
            "severity": n.severity,
            "owner": n.owner,
            "references_column": n.references_column,
        }
        for n in br.nodes
    ]
    return {
        "nodes": [source_node] + downstream,
        "edges": [{"source": u, "target": v} for u, v in br.edges],
    }


def _action_to_response(action: PendingAction) -> VerdictResponse:
    v = action.oracle_verdict
    dr = action.drift_report
    return VerdictResponse(
        report_id=action.report_id,
        status="pending_approval",
        classification=v.classification.value,
        confidence=v.confidence,
        reasoning=v.reasoning,
        affected_columns=v.affected_columns,
        recommended_action=v.recommended_action,
        proposed_mcp_action=(
            f"modify_connection_table_config: "
            f"set {action.schema_name}.{action.table_name} enabled=false"
        ),
        blast_radius_summary=v.blast_radius_summary,
        blast_radius_graph=_blast_radius_to_graph(action.blast_radius),
        created_at=action.created_at.isoformat(),
        psi_score=dr.max_psi_score if dr else 0.0,
        psi_column=dr.max_psi_column if dr else None,
        psi_threshold=action.psi_threshold,
        row_delta_z=dr.row_count_z_score if dr else 0.0,
        anomaly_reason=dr.anomaly_reason if dr else None,
        schema_added=dr.schema_delta.added if dr else [],
        schema_removed=dr.schema_delta.removed if dr else [],
        dist_baseline=dr.max_psi_baseline_dist if dr else {},
        dist_current=dr.max_psi_current_dist if dr else {},
    )


@app.get("/verdicts")
def list_verdicts() -> dict:
    orch = _require_orchestrator()
    return {
        "verdicts": [_action_to_response(a).model_dump() for a in orch._pending.values()]
    }


@app.get("/verdicts/{report_id}")
def get_verdict(report_id: str) -> VerdictResponse:
    orch = _require_orchestrator()
    action = orch._pending.get(report_id)
    if action is None:
        raise HTTPException(status_code=404, detail="No pending verdict for this report_id")
    return _action_to_response(action)


# ── approvals ─────────────────────────────────────────────────────────────────

@app.post("/approvals/{report_id}")
async def approve_or_dismiss(report_id: str, request: Request) -> dict:
    body = await request.json()
    action = body.get("action")

    if action not in {"approve", "dismiss", "investigate"}:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action!r}")

    orch = _require_orchestrator()

    if action == "approve":
        try:
            return await orch.execute_approved(report_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="No pending action for this report_id")

    if action == "dismiss":
        try:
            return orch.execute_dismissed(report_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="No pending action for this report_id")

    log.info("investigate_flagged", report_id=report_id)
    return {"status": "flagged_for_investigation", "report_id": report_id}


# ── lineage ────────────────────────────────────────────────────────────────────

@app.get("/lineage/blast-radius")
def lineage_blast_radius(table: str, column: str = "") -> dict:
    orch = _require_orchestrator()
    br = orch._lineage.blast_radius(table, column)
    return _blast_radius_to_graph(br)


# ── vp pipeline (live BigQuery) ───────────────────────────────────────────────

@app.get("/vp-pipeline")
def vp_pipeline() -> dict:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "tiresias-496915")
    try:
        from google.cloud import bigquery as bq
    except ImportError:
        raise HTTPException(status_code=503, detail="google-cloud-bigquery not installed")

    sql = f"""
SELECT
  COALESCE(SUM(d.property_amount), 0) AS pipeline_value,
  COUNT(*)                             AS deal_count
FROM `{project}.hubspot.deal` d
JOIN `{project}.hubspot.deal_pipeline_stage` s
  ON d.deal_pipeline_stage_id = s.stage_id
WHERE s.label = 'Contract Sent'
  AND NOT d._fivetran_deleted
"""
    client = bq.Client(project=project)
    rows = list(client.query(sql).result())
    row = rows[0]
    return {
        "pipeline_value": float(row.pipeline_value),
        "deal_count": int(row.deal_count),
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "query_sql": (
            f"SELECT COALESCE(SUM(d.property_amount), 0)\n"
            f"FROM `{project}.hubspot.deal` d\n"
            f"JOIN `{project}.hubspot.deal_pipeline_stage` s\n"
            f"  ON d.deal_pipeline_stage_id = s.stage_id\n"
            f"WHERE s.label = 'Contract Sent'\n"
            f"  AND NOT d._fivetran_deleted"
        ),
    }


# ── monitoring summary + PSI trend ────────────────────────────────────────────

@app.get("/monitoring/summary")
def monitoring_summary() -> dict:
    orch = _require_orchestrator()
    latest_entry = list(orch._psi_log)[-1] if orch._psi_log else None
    return {
        "tables_watched": 2,
        "active_incidents": len(orch._pending),
        "psi_threshold": 0.25,
        "baseline_age_days": 7,
        "latest_psi": latest_entry["psi"] if latest_entry else None,
        "latest_psi_column": latest_entry["column"] if latest_entry else None,
        "latest_checked_at": latest_entry["timestamp"] if latest_entry else None,
        "is_anomalous": latest_entry["is_anomalous"] if latest_entry else False,
    }


@app.get("/monitoring/psi-trend")
def monitoring_psi_trend() -> dict:
    orch = _require_orchestrator()
    return {"data": list(orch._psi_log), "threshold": 0.25}


@app.get("/monitoring/freshness")
def monitoring_freshness() -> dict:
    orch = _require_orchestrator()
    if orch._memory is None:
        return {"tables": [], "threshold_seconds": 21_600}

    dataset = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
    threshold = int(os.environ.get("FRESHNESS_THRESHOLD_SECONDS", "21600"))
    tables = ["deal_pipeline_stage", "deal"]

    try:
        data = orch._memory.get_table_freshness(dataset, tables, threshold)
        return {"tables": data, "threshold_seconds": threshold}
    except Exception as exc:
        log.warning("freshness_query_failed", error=str(exc))
        return {"tables": [], "threshold_seconds": threshold, "error": str(exc)}


# ── fingerprints (stub) ───────────────────────────────────────────────────────

@app.get("/fingerprints")
def list_fingerprints(dataset: str, table: str, limit: int = 10) -> dict:
    return {"dataset": dataset, "table": table, "fingerprints": []}
