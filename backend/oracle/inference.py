"""Gemini inference layer — classifies DriftReports into one of four categories."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class DriftClassification(str, Enum):
    NORMAL_SEASONAL = "NORMAL_SEASONAL"
    BENIGN_GROWTH = "BENIGN_GROWTH"
    SILENT_SEMANTIC_FAILURE = "SILENT_SEMANTIC_FAILURE"
    UPSTREAM_DATA_QUALITY = "UPSTREAM_DATA_QUALITY"


class OracleVerdict(BaseModel):
    classification: DriftClassification
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    affected_columns: list[str]
    recommended_action: str
    blast_radius_summary: str
    # Metadata
    model_used: str
    baseline_fingerprint_count: int
    baseline_includes_synthetic: bool


class OracleAgent:
    def __init__(self, model: str, project: str, location: str) -> None:
        self._model = model
        self._project = project
        self._location = location
        self._client: Any = None

    def classify(self, drift_report: Any, blast_radius: Any) -> OracleVerdict:
        raise NotImplementedError
