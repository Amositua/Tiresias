"""Slack webhook client — sends rich Block Kit notifications at each agent step."""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone
from typing import Any


class SlackClient:
    def __init__(self, webhook_url: str) -> None:
        self._url = webhook_url.strip()

    def _post(self, payload: dict[str, Any]) -> None:
        if not self._url:
            return
        try:
            data = json.dumps(payload).encode()
            req = urllib.request.Request(
                self._url, data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception:
            pass  # never let Slack failures interrupt the agent pipeline

    # ── Notification 1: Incident detected ────────────────────────────────────

    def notify_incident(
        self,
        table: str,
        column: str,
        psi_score: float,
        psi_threshold: float,
        confidence: float,
        reasoning: str,
        blast_radius_nodes: list[dict],
        report_id: str,
        pipeline_value: float = 0.0,
    ) -> None:
        multiple = f"{psi_score / psi_threshold:.1f}×" if psi_threshold else "—"

        blast_lines = []
        for n in blast_radius_nodes:
            if n.get("node_type") == "source":
                continue
            sev   = n.get("severity", "").upper()
            name  = n.get("label", n.get("name", ""))
            owner = n.get("owner")
            ref   = "  ◆ *references column*" if n.get("references_column") else ""
            owner_str = f"  →  {owner}" if owner else ""
            blast_lines.append(f"• `{name}`   *{sev}*{ref}{owner_str}")

        blast_text = "\n".join(blast_lines) if blast_lines else "No downstream assets"

        self._post({
            "attachments": [{
                "color": "#EF4444",
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "Silent Semantic Failure Detected"},
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Table*\n`{table}`"},
                            {"type": "mrkdwn", "text": f"*Column*\n`{column}`"},
                            {"type": "mrkdwn", "text": f"*PSI Score*\n`{psi_score:.4f}`  —  {multiple} threshold"},
                            {"type": "mrkdwn", "text": f"*Confidence*\n`{int(confidence * 100)}%`  ·  Gemini 3.1 Pro"},
                        ],
                    },
                    {"type": "divider"},
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Oracle's Assessment*\n_{reasoning[:280]}{'...' if len(reasoning) > 280 else ''}_",
                        },
                    },
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"*Blast Radius*\n{blast_text}"},
                    },
                    {"type": "divider"},
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"*${pipeline_value:,.0f} late-stage pipeline at risk*  ·  Report `{report_id[:8]}`  ·  Tiresias is initiating quarantine",
                            }
                        ],
                    },
                ],
            }]
        })

    # ── Notification 2: Table quarantined ─────────────────────────────────────

    def notify_quarantined(self, table: str, schema: str, connector_id: str) -> None:
        self._post({
            "attachments": [{
                "color": "#F59E0B",
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "Table Quarantined via Fivetran MCP"},
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Table*\n`{schema}.{table}`"},
                            {"type": "mrkdwn", "text": f"*Connector*\n`{connector_id}`"},
                            {"type": "mrkdwn", "text": "*Action*\n`modify_connection_table_config`"},
                            {"type": "mrkdwn", "text": "*Status*\n`enabled → false`"},
                        ],
                    },
                    {
                        "type": "context",
                        "elements": [
                            {"type": "mrkdwn", "text": "No further corrupt syncs will reach BigQuery.  Preparing dbt fix."},
                        ],
                    },
                ],
            }]
        })

    # ── Notification 3: GitHub PR opened ─────────────────────────────────────

    def notify_pr_opened(
        self,
        pr_url: str,
        pr_number: int,
        branch: str,
        fixes: list[dict],
    ) -> None:
        fix_text = ""
        for fix in fixes[:2]:
            model = fix.get("model_name", "")
            orig  = fix.get("original_snippet", "").strip()[:120]
            fixed = fix.get("fixed_snippet", "").strip()[:120]
            fix_text += f"\n*`{model}.sql`*\n```{orig}```\n↓  Oracle fix\n```{fixed}```\n"

        self._post({
            "attachments": [{
                "color": "#3B82F6",
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": f"GitHub PR #{pr_number} Opened — Action Required"},
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Branch:* `{branch}`\n\nOracle generated a corrected SQL fix and committed it automatically.{fix_text}",
                        },
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Review & Merge PR"},
                                "url": pr_url,
                                "style": "primary",
                            }
                        ],
                    },
                    {
                        "type": "context",
                        "elements": [
                            {"type": "mrkdwn", "text": "Tiresias will automatically re-enable the table at Fivetran the moment this PR is merged."},
                        ],
                    },
                ],
            }]
        })

    # ── Notification 4: Loop closed ───────────────────────────────────────────

    def notify_loop_closed(
        self,
        table: str,
        schema: str,
        connector_id: str,
        incident_started_at: datetime,
    ) -> None:
        now     = datetime.now(timezone.utc)
        elapsed = now - incident_started_at
        mins    = int(elapsed.total_seconds() // 60)
        secs    = int(elapsed.total_seconds() % 60)
        elapsed_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"

        self._post({
            "attachments": [{
                "color": "#22C55E",
                "blocks": [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "Loop Closed — Pipeline Restored"},
                    },
                    {
                        "type": "section",
                        "fields": [
                            {"type": "mrkdwn", "text": f"*Table*\n`{schema}.{table}`"},
                            {"type": "mrkdwn", "text": f"*Connector*\n`{connector_id}`"},
                            {"type": "mrkdwn", "text": f"*Resolution time*\n`{elapsed_str}`"},
                            {"type": "mrkdwn", "text": "*Re-enabled via*\n`modify_connection_table_config`"},
                        ],
                    },
                    {"type": "divider"},
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": (
                                ":white_check_mark:  PR merged by engineer\n"
                                ":white_check_mark:  Table re-enabled at Fivetran source\n"
                                ":white_check_mark:  VP dashboard healing on next sync\n\n"
                                "*0 engineering hours on detection*\n"
                                "*0 manual intervention on quarantine & fix*"
                            ),
                        },
                    },
                    {
                        "type": "context",
                        "elements": [
                            {"type": "mrkdwn", "text": "Tiresias · pre-cognitive data quality · autonomous agent loop complete"},
                        ],
                    },
                ],
            }]
        })
