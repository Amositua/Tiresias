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
from oracle.inference import FixSuggestion, OracleAgent
from tiresias.orchestrator import ImpactScore, PendingAction, TiresiasOrchestrator

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


async def _poll_fivetran_syncs(
    orch: "TiresiasOrchestrator",
    connector_id: str,
    dataset: str,
    tables: list[str],
    interval_seconds: int,
) -> None:
    """
    Background task: poll the Fivetran REST API every `interval_seconds`.
    When succeeded_at changes (new sync completed), automatically trigger
    the full Memory → Lineage → Oracle → MCP pipeline for each watched table.
    """
    import asyncio
    import base64
    import json as _json
    import urllib.request as _ur

    api_key    = os.environ.get("FIVETRAN_API_KEY", "")
    api_secret = os.environ.get("FIVETRAN_API_SECRET", "")
    if not api_key or not api_secret:
        log.warning("fivetran_poller_disabled", reason="FIVETRAN_API_KEY/SECRET not set")
        return

    credentials = base64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
    last_succeeded_at: str | None = None

    log.info(
        "fivetran_poller_started",
        connector_id=connector_id,
        interval_seconds=interval_seconds,
        tables=tables,
    )

    while True:
        await asyncio.sleep(interval_seconds)
        try:
            req = _ur.Request(
                f"https://api.fivetran.com/v1/connectors/{connector_id}",
                headers={
                    "Authorization": f"Basic {credentials}",
                    "Accept": "application/json;version=2",
                },
            )
            with _ur.urlopen(req, timeout=15) as resp:
                data = _json.loads(resp.read())

            succeeded_at = data.get("data", {}).get("succeeded_at")
            if not succeeded_at:
                continue

            if last_succeeded_at is None:
                # First successful poll — record current timestamp, do not trigger
                last_succeeded_at = succeeded_at
                log.info("fivetran_poller_baseline", succeeded_at=succeeded_at)
                continue

            if succeeded_at != last_succeeded_at:
                # New sync completed
                last_succeeded_at = succeeded_at
                log.info(
                    "fivetran_sync_auto_detected",
                    connector_id=connector_id,
                    succeeded_at=succeeded_at,
                )
                for table in tables:
                    try:
                        await orch.handle_sync_completed(connector_id, dataset, table)
                    except Exception as exc:
                        log.warning("auto_trigger_failed", table=table, error=str(exc))

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("fivetran_poll_error", error=str(exc))


async def _poll_pr_merges(orch: "TiresiasOrchestrator", interval_seconds: int = 20) -> None:
    """
    Background task: check every `interval_seconds` whether any quarantined
    action's GitHub PR has been merged. If so, call execute_reenabled()
    automatically — no frontend polling required.
    """
    import asyncio
    gh_token = os.environ.get("GITHUB_TOKEN", "")
    gh_repo  = os.environ.get("GITHUB_REPO", "")

    if not gh_token or not gh_repo:
        log.warning("pr_poller_disabled", reason="GITHUB_TOKEN/REPO not set")
        return

    log.info("pr_poller_started", interval_seconds=interval_seconds)

    while True:
        await asyncio.sleep(interval_seconds)
        try:
            if not orch._quarantined:
                continue

            from tiresias.github_client import GitHubClient
            gh = GitHubClient(gh_token, gh_repo)

            for report_id, action in list(orch._quarantined.items()):
                if not action.github_pr_number:
                    continue
                try:
                    pr_state = gh.get_pr_state(action.github_pr_number)
                    if pr_state.get("merged"):
                        log.info("pr_merge_detected", report_id=report_id,
                                 pr_number=action.github_pr_number)
                        await orch.execute_reenabled(report_id)
                except Exception as exc:
                    log.warning("pr_poll_check_failed", report_id=report_id, error=str(exc))

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("pr_poller_error", error=str(exc))


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    global _orchestrator
    _orchestrator = _build_orchestrator()
    log.info("orchestrator_ready")

    # Start background Fivetran sync poller
    connector_id  = os.environ.get("FIVETRAN_CONNECTOR_ID", "wanderer_financing")
    dataset       = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
    tables        = ["deal_pipeline_stage", "deal"]
    interval      = int(os.environ.get("FIVETRAN_POLL_INTERVAL_SECONDS", "60"))

    _poll_task = asyncio.create_task(
        _poll_fivetran_syncs(_orchestrator, connector_id, dataset, tables, interval)
    )

    # Start background PR merge poller — re-enables table when PR merged on GitHub
    _pr_task = asyncio.create_task(_poll_pr_merges(_orchestrator, interval_seconds=20))

    log.info("fivetran_poller_scheduled", interval_seconds=interval)
    log.info("pr_poller_scheduled", interval_seconds=20)

    yield

    _poll_task.cancel()
    _pr_task.cancel()
    for t in [_poll_task, _pr_task]:
        try:
            await t
        except asyncio.CancelledError:
            pass

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
    suggested_fixes: list[FixSuggestion]
    impact: dict | None
    github_pr_url: str | None
    github_pr_number: int | None


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


def _impact_to_dict(impact: ImpactScore | None) -> dict | None:
    if impact is None:
        return None
    return {
        "pipeline_value_at_risk": impact.pipeline_value_at_risk,
        "time_to_detect_seconds": impact.time_to_detect_seconds,
        "industry_avg_ttd_seconds": impact.industry_avg_ttd_seconds,
        "hours_saved_this_incident": impact.hours_saved_this_incident,
        "incidents_caught_total": impact.incidents_caught_total,
        "total_hours_saved": impact.total_hours_saved,
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
        suggested_fixes=v.suggested_fixes,
        github_pr_url=action.github_pr_url,
        github_pr_number=action.github_pr_number,
        impact=_impact_to_dict(action.impact),
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

    if action not in {"approve", "dismiss", "investigate", "reenable"}:
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

    if action == "reenable":
        try:
            return await orch.execute_reenabled(report_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="No quarantined action for this report_id")

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


@app.get("/monitoring/pr-status/{report_id}")
async def monitoring_pr_status(report_id: str) -> dict:
    """Check GitHub PR status and auto-re-enable table if PR was merged."""
    orch = _require_orchestrator()
    return await orch.check_pr_and_reenable(report_id)


@app.get("/monitoring/quarantined")
def monitoring_quarantined() -> dict:
    """Return all quarantined actions with their PR info."""
    orch = _require_orchestrator()
    result = []
    for report_id, action in orch._quarantined.items():
        result.append({
            "report_id": report_id,
            "table": f"{action.schema_name}.{action.table_name}",
            "github_pr_url": action.github_pr_url,
            "github_pr_number": action.github_pr_number,
            "created_at": action.created_at.isoformat(),
        })
    return {"quarantined": result}


@app.get("/monitoring/connector-health")
async def monitoring_connector_health() -> dict:
    """Return all tables in the connector with enabled status and Tiresias coverage."""
    orch = _require_orchestrator()
    connector_id = os.environ.get("FIVETRAN_CONNECTOR_ID", "wanderer_financing")
    dataset = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")

    try:
        schema_config = await orch._mcp.get_schema_config(connector_id)
    except Exception as exc:
        log.warning("connector_health_schema_failed", error=str(exc))
        return {"tables": [], "connector_id": connector_id, "error": str(exc)}

    schemas = schema_config.get("data", {}).get("schemas", {})
    tables_out = []

    for schema_name, schema_data in schemas.items():
        if not isinstance(schema_data, dict):
            continue
        for table_name, table_data in schema_data.get("tables", {}).items():
            if not isinstance(table_data, dict):
                continue
            tables_out.append({
                "schema": schema_name,
                "table": table_name,
                "enabled": table_data.get("enabled", False),
                "has_baseline": False,  # filled below
            })

    # Check which tables have stored fingerprints in BigQuery
    if orch._memory is not None:
        try:
            covered = set()
            import google.cloud.bigquery as bq
            sql = f"""
                SELECT DISTINCT dataset_id || '.' || table_name AS key
                FROM `{orch._memory._fingerprints_table}`
                WHERE dataset_id = @dataset
            """
            job_config = bq.QueryJobConfig(
                query_parameters=[bq.ScalarQueryParameter("dataset", "STRING", dataset)]
            )
            rows = list(orch._memory._client.query(sql, job_config=job_config).result())
            covered = {r["key"] for r in rows}
            for t in tables_out:
                t["has_baseline"] = f"{t['schema']}.{t['table']}" in covered or t["table"] in {k.split(".")[-1] for k in covered}
        except Exception as exc:
            log.warning("connector_health_coverage_failed", error=str(exc))

    tables_out.sort(key=lambda t: (not t["has_baseline"], not t["enabled"], t["table"]))
    covered_count = sum(1 for t in tables_out if t["has_baseline"])
    return {
        "connector_id": connector_id,
        "total_tables": len(tables_out),
        "monitored_tables": covered_count,
        "coverage_pct": round(covered_count / len(tables_out) * 100) if tables_out else 0,
        "tables": tables_out,
    }


@app.get("/monitoring/activity")
def monitoring_activity(limit: int = 50) -> dict:
    orch = _require_orchestrator()
    entries = list(orch._activity)[-limit:]
    return {"entries": entries}


_risk_cache: dict = {}
_RISK_CACHE_TTL = 60  # seconds — Gemini calls are slow, no need to hit every 4s


@app.get("/monitoring/risk-forecast")
def monitoring_risk_forecast(refresh: bool = False) -> dict:
    """Return proactive drift risk scores for all watched tables.

    Results are cached for 60 s. Pass ?refresh=true to force recompute.
    Also incorporates the in-memory PSI log for immediate recency signals
    without waiting for BigQuery fingerprint storage to commit.
    """
    global _risk_cache
    now = datetime.now(timezone.utc)

    # Serve cache unless stale or forced refresh
    if not refresh and _risk_cache:
        age = (now - _risk_cache["_computed_at"]).total_seconds()
        if age < _RISK_CACHE_TTL:
            return {k: v for k, v in _risk_cache.items() if k != "_computed_at"}

    orch = _require_orchestrator()
    if orch._memory is None:
        return {"tables": [], "generated_at": now.isoformat(), "cached": False}

    dataset = os.environ.get("BIGQUERY_HUBSPOT_DATASET", "hubspot")
    watched = ["deal_pipeline_stage", "deal"]

    # Build a recency map from the in-memory PSI log (immediate signal)
    recent_psi: dict[str, float] = {}
    recent_days_map: dict[str, float] = {}
    for entry in list(orch._psi_log):
        t = entry.get("table", "")
        psi = entry.get("psi", 0.0)
        if entry.get("is_anomalous") and psi > recent_psi.get(t, 0):
            recent_psi[t] = psi
            try:
                ts = datetime.fromisoformat(entry["timestamp"]).replace(tzinfo=timezone.utc)
                days = (now - ts).total_seconds() / 86400
                recent_days_map[t] = round(days, 2)
            except Exception:
                pass

    results = []
    for table in watched:
        try:
            profile = orch._memory.get_risk_profile(dataset, table)

            # Merge in-memory recency signals into the profile
            if table in recent_psi:
                profile["max_psi"] = max(profile.get("max_psi", 0.0), recent_psi[table])
                if profile.get("recent_anomaly_days") is None or recent_days_map.get(table, 999) < profile["recent_anomaly_days"]:
                    profile["recent_anomaly_days"] = recent_days_map[table]
                profile["anomaly_count"] = max(profile.get("anomaly_count", 0), 1)

            prediction = orch._oracle.predict_risk(table, profile)
            results.append(prediction)
        except Exception as exc:
            log.warning("risk_forecast_failed", table=table, error=str(exc))
            results.append({
                "table": table,
                "risk_score": 0,
                "risk_level": "UNKNOWN",
                "reason": "Unable to compute — check fingerprint history",
                "volatile_column": None,
                "max_psi": 0.0,
                "anomaly_count": 0,
                "recent_anomaly_days": None,
                "fingerprint_count": 0,
            })

    payload = {
        "tables": results,
        "generated_at": now.isoformat(),
        "psi_threshold": 0.25,
        "cached": False,
    }
    _risk_cache = {**payload, "_computed_at": now}
    return payload


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
