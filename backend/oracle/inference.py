"""Gemini inference layer — classifies DriftReports into one of four categories."""

from __future__ import annotations

import ast
import json
import logging
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from lineage.graph import BlastRadius
from memory.fingerprint import DriftReport

log = logging.getLogger(__name__)

ORACLE_MODEL = "gemini-3.1-pro-preview"
_ORACLE_LOCATION = "global"  # Gemini 3.1 Pro Preview: global endpoint only; regional causes silent 404


class DriftClassification(str, Enum):
    NORMAL_SEASONAL = "NORMAL_SEASONAL"
    BENIGN_GROWTH = "BENIGN_GROWTH"
    SILENT_SEMANTIC_FAILURE = "SILENT_SEMANTIC_FAILURE"
    UPSTREAM_DATA_QUALITY = "UPSTREAM_DATA_QUALITY"


class _GeminiClassification(BaseModel):
    """Schema passed to Gemini via response_schema — only what the model fills in."""
    classification: DriftClassification
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    affected_columns: list[str]
    recommended_action: str
    blast_radius_summary: str


class FixSuggestion(BaseModel):
    model_name: str
    file_path: str
    original_snippet: str   # the exact line(s) that will break
    fixed_snippet: str      # the corrected replacement
    explanation: str        # why this fix is correct


class _GeminiFixes(BaseModel):
    fixes: list[FixSuggestion]


class OracleVerdict(BaseModel):
    classification: DriftClassification
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    affected_columns: list[str]
    recommended_action: str
    blast_radius_summary: str
    model_used: str
    baseline_fingerprint_count: int
    baseline_includes_synthetic: bool
    suggested_fixes: list[FixSuggestion] = Field(default_factory=list)
    thought_text: str | None = Field(default=None, exclude=True)  # audit only


class OracleAgent:
    def __init__(self, project: str, model: str = ORACLE_MODEL) -> None:
        self._model = model
        self._project = project
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            from google import genai
            self._client = genai.Client(
                vertexai=True,
                project=self._project,
                location=_ORACLE_LOCATION,
            )
        return self._client

    def classify(self, drift_report: DriftReport, blast_radius: BlastRadius) -> OracleVerdict:
        from google.genai import types

        client = self._get_client()
        prompt = _build_prompt(drift_report, blast_radius)

        response = client.models.generate_content(
            model=self._model,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_GeminiClassification,
                thinking_config=types.ThinkingConfig(
                    include_thoughts=True,
                    thinking_budget=1024,
                ),
                max_output_tokens=2048,  # thinking tokens count toward this cap; 1024 thinking + ~1024 response
                temperature=1.0,
            ),
        )

        # Collect thought parts for audit. In multi-turn use, the full
        # response.candidates[0].content (all parts, including thought parts) must be
        # passed back as the prior assistant turn — stripping thought parts causes a 400.
        thought_text: str | None = None
        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                thought_text = (thought_text or "") + part.text

        # Extract structured output
        gemini_result: _GeminiClassification
        if response.parsed is not None:
            gemini_result = response.parsed
        else:
            raw_part = next(
                (p for p in reversed(response.candidates[0].content.parts)
                 if not getattr(p, "thought", False)),
                None,
            )
            if raw_part is None:
                raise RuntimeError("Oracle: no response part found")
            gemini_result = _GeminiClassification.model_validate(json.loads(raw_part.text))

        return OracleVerdict(
            classification=gemini_result.classification,
            confidence=gemini_result.confidence,
            reasoning=gemini_result.reasoning,
            affected_columns=gemini_result.affected_columns,
            recommended_action=gemini_result.recommended_action,
            blast_radius_summary=gemini_result.blast_radius_summary,
            model_used=self._model,
            baseline_fingerprint_count=drift_report.baseline_fingerprint_count,
            baseline_includes_synthetic=drift_report.baseline_includes_synthetic,
            thought_text=thought_text,
        )


    def predict_risk(self, table: str, profile: dict) -> dict:
        """Return risk score + Gemini-generated reason for a table."""
        score = _compute_risk_score(profile)
        level = _risk_level(score)

        # Short Gemini call for a human-readable reason
        reason = self._generate_risk_reason(table, profile, score, level)

        return {
            "table": table,
            "risk_score": score,
            "risk_level": level,
            "reason": reason,
            "volatile_column": profile.get("volatile_column"),
            "max_psi": profile.get("max_psi", 0.0),
            "anomaly_count": profile.get("anomaly_count", 0),
            "recent_anomaly_days": profile.get("recent_anomaly_days"),
            "fingerprint_count": profile.get("fingerprint_count", 0),
        }

    def _generate_risk_reason(
        self, table: str, profile: dict, score: int, level: str
    ) -> str:
        try:
            from google.genai import types

            client = self._get_client()
            anomaly_count = profile.get("anomaly_count", 0)
            recent_days = profile.get("recent_anomaly_days")
            volatile_col = profile.get("volatile_column")
            max_psi = profile.get("max_psi", 0.0)
            n = profile.get("fingerprint_count", 0)

            recent_str = (
                f"Most recent drift was {recent_days:.1f} days ago."
                if recent_days is not None else "No drift detected in recent history."
            )

            prompt = f"""You are Tiresias, a pre-cognitive data quality agent.

Summarise in ONE concise sentence why the table '{table}' has a {level} drift risk score of {score}/100.
Be specific — reference the actual signals below. Do not start with "The table" — vary the phrasing.

Signals:
- Drift events in last {n} fingerprints: {anomaly_count}
- Most volatile column: {volatile_col or 'none identified'}
- Highest PSI seen: {max_psi:.4f} (threshold 0.25)
- {recent_str}

One sentence only. No bullet points. No preamble."""

            response = client.models.generate_content(
                model=self._model,
                contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=200,
                ),
            )
            text = response.candidates[0].content.parts[-1].text.strip()
            return text
        except Exception:
            # Fallback: generate from components without Gemini
            if profile.get("anomaly_count", 0) > 0:
                days = profile.get("recent_anomaly_days")
                col = profile.get("volatile_column", "unknown column")
                days_str = f"{days:.0f} days ago" if days else "recently"
                return f"Column '{col}' drifted {profile['anomaly_count']} time(s) in recent history, most recently {days_str}."
            return f"No significant drift history — baseline is stable across {profile.get('fingerprint_count', 0)} fingerprints."

    def generate_fix(
        self,
        verdict: OracleVerdict,
        blast_radius: "BlastRadius",  # type: ignore[name-defined]
        models_sql: list[dict],
    ) -> list[FixSuggestion]:
        """Second Gemini pass: read affected dbt model SQL and generate corrected code."""
        from google.genai import types

        if not models_sql:
            return []

        client = self._get_client()
        prompt = _build_fix_prompt(verdict, blast_radius, models_sql)

        response = client.models.generate_content(
            model=self._model,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_GeminiFixes,
                temperature=0.2,
                max_output_tokens=2048,
            ),
        )

        if response.parsed is not None:
            return response.parsed.fixes
        raw_part = next(
            (p for p in reversed(response.candidates[0].content.parts)
             if not getattr(p, "thought", False)),
            None,
        )
        if raw_part is None:
            return []
        return _GeminiFixes.model_validate(json.loads(raw_part.text)).fixes


def _parse_dist(s: str | None) -> dict[str, float]:
    if not s:
        return {}
    try:
        result = ast.literal_eval(s)
        if isinstance(result, dict):
            return {str(k): float(v) for k, v in result.items()}
    except (ValueError, SyntaxError):
        pass
    return {}


def _format_column_drifts(dr: DriftReport) -> str:
    if not dr.column_drifts:
        return "No column drift detected."

    current_cols = {c.name: c for c in dr.current_fingerprint.columns}
    parts: list[str] = []

    for drift in dr.column_drifts:
        flag = "ANOMALOUS" if drift.is_anomalous else "watch"
        parts.append(
            f"column: {drift.column_name}  |  type: {drift.drift_type}"
            f"  |  PSI: {drift.psi_score:.6f}  |  {flag}"
        )

        if drift.drift_type == "PSI_CATEGORICAL":
            col = current_cols.get(drift.column_name)
            if col and col.top_values:
                parts.append("  current top values:")
                for tv in col.top_values[:10]:
                    parts.append(f"    {str(tv['value']):<42}  {tv['pct'] * 100:.2f}%")

            baseline_dist = _parse_dist(
                str(drift.baseline_value) if drift.baseline_value is not None else None
            )
            if baseline_dist:
                parts.append("  baseline top values:")
                for val, pct in sorted(baseline_dist.items(), key=lambda x: -x[1])[:10]:
                    parts.append(f"    {val:<42}  {pct * 100:.2f}%")

            if col and col.psi_distribution and baseline_dist:
                current_dist = col.psi_distribution
                disappeared = {
                    k: v for k, v in baseline_dist.items()
                    if current_dist.get(k, 0.0) < 0.001
                }
                appeared = {
                    k: v for k, v in current_dist.items()
                    if baseline_dist.get(k, 0.0) < 0.001
                }
                if disappeared or appeared:
                    parts.append("  Notable shifts:")
                    for val, pct in disappeared.items():
                        parts.append(
                            f"    {val:<42}  baseline {pct * 100:.2f}% → current  0.00%  [DISAPPEARED]"
                        )
                    for val, pct in appeared.items():
                        parts.append(
                            f"    {val:<42}  baseline  0.00% → current {pct * 100:.2f}%  [APPEARED]"
                        )

        elif drift.drift_type in ("PSI_NUMERIC", "NULL_PCT_CHANGE"):
            parts.append(f"  current: {drift.current_value}  baseline: {drift.baseline_value}")

    return "\n".join(parts)


def _format_blast_radius(br: BlastRadius) -> str:
    if not br.nodes:
        return f"Source: {br.source_table}\nNo downstream dependencies found."

    changed_col = f", column: {br.changed_column}" if br.changed_column else ""
    lines = [f"Source: {br.source_table}{changed_col}", "", "Downstream nodes (nearest first):"]
    for node in br.nodes:
        owner_str = f"  (owner: {node.owner})" if node.owner else ""
        col_flag = "  [references column directly]" if node.references_column else ""
        lines.append(
            f"  [{node.severity.upper()}] {node.node_type}: {node.name}{owner_str}{col_flag}"
        )
    return "\n".join(lines)


def _build_prompt(dr: DriftReport, br: BlastRadius) -> str:
    delta = dr.schema_delta
    if delta.added or delta.removed or delta.type_changed:
        delta_parts: list[str] = []
        if delta.added:
            delta_parts.append(f"added: {delta.added}")
        if delta.removed:
            delta_parts.append(f"removed: {delta.removed}")
        if delta.type_changed:
            delta_parts.append(f"type changed: {delta.type_changed}")
        schema_delta_str = "; ".join(delta_parts)
    else:
        schema_delta_str = "none"

    synthetic_note = " (includes synthetic seed data)" if dr.baseline_includes_synthetic else ""

    return f"""You are Oracle, a data quality classifier for the Tiresias monitoring system.

A Fivetran sync completed. The Memory agent detected statistical drift in a BigQuery table.
The Lineage agent traced downstream impact. Classify this drift into exactly one of four
categories and explain your reasoning.

## DRIFT REPORT

Table: {dr.dataset_id}.{dr.table_name}
Rows: {dr.current_fingerprint.row_count}  (Z-score vs baseline: {dr.row_count_z_score:.2f})
Baseline: {dr.baseline_fingerprint_count} established fingerprints{synthetic_note}
Schema delta: {schema_delta_str}
Overall drift score: {dr.overall_drift_score:.6f}

### Column Drifts

{_format_column_drifts(dr)}

## BLAST RADIUS

{_format_blast_radius(br)}

## CLASSIFICATIONS

Choose exactly one:

SILENT_SEMANTIC_FAILURE
  A semantic change in a dimension or lookup table that breaks downstream queries without
  any error. Key signature: one or more categorical values disappear from the distribution
  at the same frequency that new values appear (rename pattern); the corresponding fact
  table shows no anomaly; downstream models using string-literal equality on the old value
  silently return zero rows.

UPSTREAM_DATA_QUALITY
  The source system sent malformed, incomplete, or inconsistent data.
  Key signature: unexpected nulls, row count collapse, schema changes, out-of-range values,
  or truncation. No rename pattern present.

BENIGN_GROWTH
  Organic, expected data growth.
  Key signature: new values appearing at rates consistent with business growth; no existing
  value disappears; gradual row count increase with stable distributions.

NORMAL_SEASONAL
  Expected cyclical variation driven by time patterns.
  Key signature: metric frequency shifts that correlate with time of week, month, or quarter;
  no value disappears from the distribution; total cardinality stable.


## INSTRUCTIONS

- reasoning: cite the specific evidence for your classification — the precise pattern you
  observed in the drift data (e.g., which values appeared or disappeared, whether row count
  changed, whether the fact table is clean). Do not merely assert the label; show the inference.
- confidence: reason about how unambiguously the observed signals match your chosen category
  versus the others. High confidence when the evidence is fully consistent with one category
  and inconsistent with all others. Lower confidence when multiple explanations are plausible,
  the signal is weak, or the baseline is small.
- affected_columns: list only columns where is_anomalous is true.
- recommended_action: a specific, engineer-actionable fix — not generic advice.
- blast_radius_summary: one sentence describing downstream risk including any named owner.
"""


def _build_fix_prompt(verdict: OracleVerdict, blast_radius: "BlastRadius", models_sql: list[dict]) -> str:  # type: ignore[name-defined]
    models_block = "\n\n".join(
        f"### {m['name']}  ({m['file_path']})\n```sql\n{m['sql']}\n```"
        for m in models_sql
    )
    disappeared = []
    appeared = []
    if blast_radius.changed_column and verdict.affected_columns:
        col = blast_radius.changed_column
        disappeared = [c for c in verdict.affected_columns if "disappeared" in verdict.reasoning.lower()]

    return f"""You are Oracle, a data quality engineer for the Tiresias monitoring system.

A SILENT_SEMANTIC_FAILURE was detected:

Table: {blast_radius.source_table}
Column that drifted: {blast_radius.changed_column}
Oracle's reasoning: {verdict.reasoning}

The following dbt models are downstream of the broken table and reference the drifted column.
For EACH model, identify the exact SQL snippet that will break because of the rename, and
write the corrected replacement.

{models_block}

## INSTRUCTIONS

For each model:
- original_snippet: copy the exact lines from the SQL above that contain the broken filter or reference
- fixed_snippet: the corrected replacement lines (preserve indentation exactly)
- explanation: one sentence explaining why this fix is correct (reference the stable column or ID if applicable)

Only include models where you can identify a concrete line that breaks. If a model has no
direct string-literal reference to the renamed value, omit it.
"""


# ── Risk prediction ───────────────────────────────────────────────────────────

class _RiskPrediction(BaseModel):
    risk_score: int = Field(ge=0, le=100)
    risk_level: str   # LOW | MEDIUM | HIGH | CRITICAL
    reason: str       # one sentence, grounded in the actual history


def _compute_risk_score(profile: dict) -> int:
    """Deterministic score 0-100 from fingerprint history signals."""
    if not profile.get("sufficient_history"):
        return 5

    score = 0
    anomaly_count = profile.get("anomaly_count", 0)
    recent_days = profile.get("recent_anomaly_days")
    max_psi = profile.get("max_psi", 0.0)

    # Each past anomaly in the baseline window adds weight
    score += min(anomaly_count * 20, 50)

    # Recency — more recent drift = higher risk
    if recent_days is not None:
        if recent_days <= 3:
            score += 30
        elif recent_days <= 7:
            score += 20
        elif recent_days <= 14:
            score += 10

    # PSI magnitude of most recent comparison
    if max_psi > 2.0:
        score += 15
    elif max_psi > 0.5:
        score += 8
    elif max_psi > 0.25:
        score += 4

    return min(score, 100)


def _risk_level(score: int) -> str:
    if score >= 70:
        return "CRITICAL"
    if score >= 45:
        return "HIGH"
    if score >= 20:
        return "MEDIUM"
    return "LOW"
