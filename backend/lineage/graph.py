"""Downstream blast-radius tracing via dbt manifest."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class BlastRadiusNode:
    node_type: str  # source | model | exposure | dashboard
    name: str
    severity: str   # critical | high | medium | low
    owner: str | None = None


@dataclass
class BlastRadius:
    source_table: str
    changed_column: str
    nodes: list[BlastRadiusNode] = field(default_factory=list)

    def as_summary(self) -> str:
        if not self.nodes:
            return f"No downstream dependencies found for {self.source_table}.{self.changed_column}"
        lines = [f"Blast radius for {self.source_table}.{self.changed_column}:"]
        for node in self.nodes:
            owner_str = f" (owner: {node.owner})" if node.owner else ""
            lines.append(f"  [{node.severity.upper()}] {node.node_type}: {node.name}{owner_str}")
        return "\n".join(lines)


class LineageGraph:
    def __init__(self, manifest_path: str) -> None:
        self._manifest_path = manifest_path
        self._graph: Any = None

    def load(self) -> None:
        raise NotImplementedError

    def blast_radius(self, source_table: str, changed_column: str) -> BlastRadius:
        raise NotImplementedError
