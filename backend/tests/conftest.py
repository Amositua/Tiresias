"""Shared fixtures for fingerprint tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from memory.fingerprint import (
    ColumnFingerprint,
    TableFingerprint,
    _compute_entropy,
)


def _make_col(
    name: str,
    dist: dict[str, float] | None = None,
    mean: float | None = None,
    stddev: float | None = None,
    null_pct: float = 0.0,
    data_type: str | None = None,
) -> ColumnFingerprint:
    if dist is not None:
        return ColumnFingerprint(
            name=name,
            data_type=data_type or "STRING",
            null_pct=null_pct,
            distinct_count=len(dist),
            top_values=[{"value": k, "count": int(v * 100), "pct": v} for k, v in dist.items()],
            entropy=_compute_entropy(dist),
            psi_distribution=dist,
        )
    else:
        return ColumnFingerprint(
            name=name,
            data_type=data_type or "FLOAT64",
            null_pct=null_pct,
            distinct_count=80,
            mean=mean,
            stddev=stddev,
            min_val=0.0,
            max_val=280000.0,
            p1=0.0, p25=55000.0, p50=95000.0, p75=150000.0, p99=275000.0,
        )


BASELINE_STAGE_ID_DIST = {
    "qualifiedtobuy":         0.20,
    "contractsent":           0.18,
    "presentationscheduled":  0.18,
    "appointmentscheduled":   0.15,
    "decisionmakerboughtin":  0.14,
    "closedwon":              0.10,
    "closedlost":             0.05,
}

POST_RENAME_STAGE_ID_DIST = BASELINE_STAGE_ID_DIST

BASELINE_LABEL_DIST = {
    "Appointment Scheduled":    1 / 7,
    "Qualified To Buy":         1 / 7,
    "Presentation Scheduled":   1 / 7,
    "Decision Maker Bought-In": 1 / 7,
    "Contract Sent":            1 / 7,
    "Closed Won":               1 / 7,
    "Closed Lost":              1 / 7,
}

POST_RENAME_LABEL_DIST = {
    "Appointment Scheduled":    1 / 7,
    "Qualified To Buy":         1 / 7,
    "Presentation Scheduled":   1 / 7,
    "Decision Maker Bought-In": 1 / 7,
    "Contract Under Review":    1 / 7,
    "Closed Won":               1 / 7,
    "Closed Lost":              1 / 7,
}

@pytest.fixture
def baseline_deal_fingerprints() -> list[TableFingerprint]:
    fps = []
    for i in range(5):
        ts = datetime(2026, 5, i + 10, 0, 0, 0, tzinfo=timezone.utc)
        fps.append(TableFingerprint(
            fingerprint_id=str(uuid.uuid4()),
            connection_id="demo_connector",
            project_id="tiresias-496915",
            dataset_id="hubspot",
            table_name="deal",
            row_count=100 + i,
            computed_at=ts,
            schema_hash="deal_abc123",
            columns=[
                _make_col("deal_pipeline_stage_id", dist=BASELINE_STAGE_ID_DIST),
                _make_col("deal_pipeline_id", dist={"default": 1.0}),
                _make_col("property_amount", mean=106180.0, stddev=73500.0),
            ],
            is_synthetic=True,
        ))
    return fps


@pytest.fixture
def baseline_stage_fingerprints() -> list[TableFingerprint]:
    fps = []
    for i in range(5):
        ts = datetime(2026, 5, i + 10, 0, 0, 0, tzinfo=timezone.utc)
        fps.append(TableFingerprint(
            fingerprint_id=str(uuid.uuid4()),
            connection_id="demo_connector",
            project_id="tiresias-496915",
            dataset_id="hubspot",
            table_name="deal_pipeline_stage",
            row_count=7,
            computed_at=ts,
            schema_hash="stage_def456",
            columns=[
                _make_col("label", dist=BASELINE_LABEL_DIST),
                _make_col("is_closed", dist={"False": 5/7, "True": 2/7}, data_type="BOOL"),
                _make_col("probability", mean=0.557, stddev=0.349,
                          data_type="FLOAT64"),
            ],
            is_synthetic=True,
        ))
    return fps


@pytest.fixture
def post_rename_stage_fingerprint() -> TableFingerprint:
    return TableFingerprint(
        fingerprint_id=str(uuid.uuid4()),
        connection_id="demo_connector",
        project_id="tiresias-496915",
        dataset_id="hubspot",
        table_name="deal_pipeline_stage",
        row_count=7,
        computed_at=datetime(2026, 5, 22, 12, 0, 0, tzinfo=timezone.utc),
        schema_hash="stage_def456",
        columns=[
            _make_col("label", dist=POST_RENAME_LABEL_DIST),
            _make_col("is_closed", dist={"False": 5/7, "True": 2/7}, data_type="BOOL"),
            _make_col("probability", mean=0.557, stddev=0.349, data_type="FLOAT64"),
        ],
        is_synthetic=False,
    )


@pytest.fixture
def post_rename_deal_fingerprint() -> TableFingerprint:
    return TableFingerprint(
        fingerprint_id=str(uuid.uuid4()),
        connection_id="demo_connector",
        project_id="tiresias-496915",
        dataset_id="hubspot",
        table_name="deal",
        row_count=100,
        computed_at=datetime(2026, 5, 22, 12, 0, 0, tzinfo=timezone.utc),
        schema_hash="deal_abc123",
        columns=[
            _make_col("deal_pipeline_stage_id", dist=POST_RENAME_STAGE_ID_DIST),
            _make_col("deal_pipeline_id", dist={"default": 1.0}),
            _make_col("property_amount", mean=106180.0, stddev=73500.0),
        ],
        is_synthetic=False,
    )


baseline_fingerprints = baseline_deal_fingerprints
post_rename_fingerprint = post_rename_stage_fingerprint
