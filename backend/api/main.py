"""Tiresias backend API."""

import hashlib
import hmac
import logging
import os

import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

log = structlog.get_logger(__name__)

app = FastAPI(
    title="Tiresias",
    description="Pre-cognitive data quality agent for Fivetran pipelines",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "agent": "tiresias"}


@app.post("/webhook/fivetran")
async def fivetran_webhook(
    request: Request,
    x_fivetran_signature: str = Header(None),
) -> dict:
    body = await request.body()
    _verify_fivetran_signature(body, x_fivetran_signature)

    payload = await request.json()
    event_type = payload.get("event")
    connector_id = payload.get("connector_id")

    if event_type != "sync_end":
        return {"status": "ignored", "event": event_type}

    log.info("fivetran_sync_completed", connector_id=connector_id)

    return {"status": "accepted", "connector_id": connector_id}


def _verify_fivetran_signature(body: bytes, signature: str | None) -> None:
    secret = os.environ.get("FIVETRAN_WEBHOOK_SECRET", "")
    if not secret:
        return
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise HTTPException(status_code=401, detail="Invalid Fivetran signature")


@app.get("/fingerprints")
def list_fingerprints(dataset: str, table: str, limit: int = 10) -> dict:
    return {"dataset": dataset, "table": table, "fingerprints": []}


@app.post("/approvals/{report_id}")
async def approve_fix(report_id: str, request: Request) -> dict:
    body = await request.json()
    action = body.get("action")

    if action not in {"approve", "dismiss", "investigate"}:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    log.info("approval_received", report_id=report_id, action=action)

    return {"status": "received", "report_id": report_id, "action": action}
