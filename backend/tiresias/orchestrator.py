"""Top-level orchestrator — coordinates Memory, Lineage, Oracle, and Fivetran MCP."""

from __future__ import annotations

import logging
from typing import Any

import structlog

log = structlog.get_logger(__name__)


class TiresiasOrchestrator:
    def __init__(
        self,
        fingerprinter: Any,
        lineage_graph: Any,
        oracle: Any,
        mcp_client: Any,
        config: dict[str, Any],
    ) -> None:
        self._memory = fingerprinter
        self._lineage = lineage_graph
        self._oracle = oracle
        self._mcp = mcp_client
        self._config = config

    def handle_sync_completed(self, connector_id: str, dataset: str, table: str) -> dict:
        raise NotImplementedError

    def _audit(self, event: str, **kwargs: Any) -> None:
        log.info(event, **kwargs)
