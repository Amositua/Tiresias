"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import VerdictPanel from "@/components/VerdictPanel";
import { Verdict, GraphNode, GraphEdge } from "@/lib/types";

// React Flow must be client-only (uses browser APIs)
const LineageGraph = dynamic(() => import("@/components/LineageGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-cream-300/30 text-sm">
      Loading graph…
    </div>
  ),
});

const LINEAGE_TABLE = "deal_pipeline_stage";
const LINEAGE_COLUMN = "label";
const POLL_MS = 4000;

function HorizonChip({ horizon, value }: { horizon: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-cream-300/30 uppercase tracking-widest">{horizon}</span>
      <span className="text-cream-300/50 font-mono">{value}</span>
    </div>
  );
}

type GraphState = "monitoring" | "anomalous" | "quarantined";

export default function Home() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState>("monitoring");
  const dismissedRef = useRef<Set<string>>(new Set());
  const activeReportRef = useRef<string | null>(null);

  // Load the lineage graph on mount — always driven by real backend data
  useEffect(() => {
    fetch(`/api/lineage?table=${LINEAGE_TABLE}&column=${LINEAGE_COLUMN}`)
      .then((r) => r.json())
      .then((data) => {
        setGraphNodes(data.nodes ?? []);
        setGraphEdges(data.edges ?? []);
      })
      .catch(console.error);
  }, []);

  // Poll for verdicts every 4 seconds
  useEffect(() => {
    function poll() {
      fetch("/api/verdicts")
        .then((r) => r.json())
        .then((data) => {
          const verdicts: Verdict[] = data.verdicts ?? [];
          const active = verdicts.find(
            (v) => !dismissedRef.current.has(v.report_id)
          );

          if (active) {
            if (activeReportRef.current !== active.report_id) {
              // New verdict — update graph data from real backend response
              activeReportRef.current = active.report_id;
              if (active.blast_radius_graph.nodes.length > 0) {
                setGraphNodes(active.blast_radius_graph.nodes);
                setGraphEdges(active.blast_radius_graph.edges);
              }
              setGraphState("anomalous");
            }
            setVerdict(active);
          } else {
            if (activeReportRef.current && graphState !== "quarantined") {
              activeReportRef.current = null;
              setVerdict(null);
              setGraphState("monitoring");
            }
          }
        })
        .catch(console.error);
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [graphState]);

  const handleApprove = useCallback(async (reportId: string) => {
    const res = await fetch(`/api/approve/${reportId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `HTTP ${res.status}`);
    }
    setGraphState("quarantined");
  }, []);

  const handleDismiss = useCallback(async (reportId: string) => {
    await fetch(`/api/approve/${reportId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    dismissedRef.current.add(reportId);
    activeReportRef.current = null;
    setVerdict(null);
    setGraphState("monitoring");
  }, []);

  return (
    <div className="flex flex-col h-screen bg-navy-950 text-cream-100 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-navy-700 bg-navy-900 flex-shrink-0 h-12">
        <div className="flex items-center gap-3">
          <span className="font-serif text-base text-cream-100 tracking-wide">
            Tiresias
          </span>
          <span className="text-navy-700 select-none">·</span>
          <span className="text-cream-300/40 text-xs tracking-wide">
            pre-cognitive data quality
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/vp-dashboard"
            className="text-[11px] text-cream-300/40 hover:text-cream-300/70 transition-colors tracking-wide"
          >
            VP dashboard ↗
          </Link>
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-gold-400" />
            </span>
            <span className="text-cream-300/40 text-xs">
              {graphState === "monitoring"
                ? "monitoring hubspot"
                : graphState === "anomalous"
                  ? "anomaly detected"
                  : "quarantine active"}
            </span>
          </div>
        </div>
      </header>

      {/* Three-horizon status strip */}
      <div className="flex items-center gap-0 px-6 border-b border-navy-700 bg-navy-900/50 flex-shrink-0 h-8 text-[10px]">
        <HorizonChip horizon="Schema" value="MCP · wanderer_financing" />
        <div className="w-px h-3 bg-navy-700 mx-4" />
        <HorizonChip horizon="Memory" value="PSI threshold 0.25 · 7-day baseline" />
        <div className="w-px h-3 bg-navy-700 mx-4" />
        <HorizonChip horizon="Oracle" value="Gemini 2.0 Flash · structured output" />
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Lineage graph — 55% */}
        <div
          className="border-r border-navy-700 relative"
          style={{ flex: "0 0 55%" }}
        >
          <div className="absolute top-3 left-4 text-cream-300/30 text-xs tracking-widest uppercase z-10 pointer-events-none select-none">
            Lineage
          </div>
          <LineageGraph
            graphNodes={graphNodes}
            graphEdges={graphEdges}
            state={graphState}
          />
        </div>

        {/* Right: Oracle verdict — 45% */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ flex: "0 0 45%" }}
        >
          <div className="px-6 py-3 border-b border-navy-700 flex-shrink-0">
            <span className="text-cream-300/30 text-xs tracking-widest uppercase">
              Oracle
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <VerdictPanel
              verdict={verdict}
              onApprove={handleApprove}
              onDismiss={handleDismiss}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
