"""Tests for Lineage blast-radius tracing.

Fixture: backend/tests/fixtures/manifest.json
Graph under test:
  source:hubspot.deal_pipeline_stage
  source:hubspot.deal
    -> model:stg_deals          (hop 1, references label in SQL)
       -> model:fct_pipeline_by_stage  (hop 2)
          -> exposure:late_stage_pipeline_dashboard  (hop 3, owner: VP of Sales)
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lineage.graph import BlastRadius, BlastRadiusNode, LineageGraph

FIXTURE = str(Path(__file__).parent / "fixtures" / "manifest.json")


@pytest.fixture
def graph() -> LineageGraph:
    g = LineageGraph(FIXTURE)
    g.load()
    return g


class TestLoad:
    def test_nodes_loaded(self, graph: LineageGraph) -> None:
        assert graph._graph is not None
        assert len(graph._graph.nodes) == 5  # 2 sources + 2 models + 1 exposure

    def test_edges_direction(self, graph: LineageGraph) -> None:
        # stg_deals should be downstream of deal_pipeline_stage
        assert graph._graph.has_edge(
            "source.tiresias.hubspot.deal_pipeline_stage",
            "model.tiresias.stg_deals",
        )
        assert graph._graph.has_edge(
            "model.tiresias.stg_deals",
            "model.tiresias.fct_pipeline_by_stage",
        )
        assert graph._graph.has_edge(
            "model.tiresias.fct_pipeline_by_stage",
            "exposure.tiresias.late_stage_pipeline_dashboard",
        )

    def test_load_required_before_blast_radius(self) -> None:
        g = LineageGraph(FIXTURE)
        with pytest.raises(RuntimeError, match="load()"):
            g.blast_radius("deal_pipeline_stage", "label")


class TestBlastRadius:
    def test_full_chain_order(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage", "label")
        names = [n.name for n in br.nodes]
        assert names == [
            "stg_deals",
            "fct_pipeline_by_stage",
            "late_stage_pipeline_dashboard",
        ]

    def test_severities(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage", "label")
        by_name = {n.name: n for n in br.nodes}
        assert by_name["stg_deals"].severity == "critical"
        assert by_name["fct_pipeline_by_stage"].severity == "high"
        assert by_name["late_stage_pipeline_dashboard"].severity == "medium"

    def test_column_reference_detection(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage", "label")
        by_name = {n.name: n for n in br.nodes}
        # stg_deals SQL contains "s.label = 'Contract Sent'" — should flag True
        assert by_name["stg_deals"].references_column is True
        # fct_pipeline_by_stage aggregates stage_label (alias) — no "label" literal
        assert by_name["fct_pipeline_by_stage"].references_column is False
        # exposure has no SQL
        assert by_name["late_stage_pipeline_dashboard"].references_column is False

    def test_exposure_owner(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage", "label")
        exposure = next(n for n in br.nodes if n.node_type == "exposure")
        assert exposure.owner == "VP of Sales"

    def test_schema_qualified_lookup(self, graph: LineageGraph) -> None:
        br_short = graph.blast_radius("deal_pipeline_stage", "label")
        br_long = graph.blast_radius("hubspot.deal_pipeline_stage", "label")
        assert [n.name for n in br_short.nodes] == [n.name for n in br_long.nodes]

    def test_unknown_source_returns_empty(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("nonexistent_table", "label")
        assert br.nodes == []
        assert br.source_table == "nonexistent_table"

    def test_no_column_arg_skips_detection(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage")
        assert all(not n.references_column for n in br.nodes)

    def test_deal_source_blast_radius(self, graph: LineageGraph) -> None:
        # deal source is also upstream of stg_deals — should produce the same chain
        br = graph.blast_radius("deal")
        names = [n.name for n in br.nodes]
        assert "stg_deals" in names
        assert "fct_pipeline_by_stage" in names
        assert "late_stage_pipeline_dashboard" in names


class TestSummary:
    def test_summary_format(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("deal_pipeline_stage", "label")
        summary = br.as_summary()
        assert "deal_pipeline_stage.label" in summary
        assert "[CRITICAL] model: stg_deals" in summary
        assert "[references column]" in summary
        assert "VP of Sales" in summary

    def test_empty_summary(self, graph: LineageGraph) -> None:
        br = graph.blast_radius("unknown_table")
        assert "No downstream" in br.as_summary()
