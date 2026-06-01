"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import VerdictPanel from "@/components/VerdictPanel";
import MonitoringDataPanel from "@/components/MonitoringDataPanel";
import { Verdict, GraphNode, GraphEdge, MonitoringSummary, PsiTrendPoint } from "@/lib/types";

const LineageGraph = dynamic(() => import("@/components/LineageGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-cream-300/30 text-sm font-mono">
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
      <span className="text-cream-300/25 text-[10px] uppercase tracking-widest">{horizon}</span>
      <span className="text-cream-300/45 text-[10px] font-mono">{value}</span>
    </div>
  );
}

type GraphState = "monitoring" | "anomalous" | "quarantined";

export default function Monitor() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState>("monitoring");
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [trend, setTrend] = useState<PsiTrendPoint[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  const activeReportRef = useRef<string | null>(null);

  // Load lineage graph on mount
  useEffect(() => {
    fetch(`/api/lineage?table=${LINEAGE_TABLE}&column=${LINEAGE_COLUMN}`)
      .then((r) => r.json())
      .then((d) => { setGraphNodes(d.nodes ?? []); setGraphEdges(d.edges ?? []); })
      .catch(console.error);
  }, []);

  // Poll verdicts + monitoring data
  useEffect(() => {
    async function poll() {
      // Verdicts
      try {
        const data = await fetch("/api/verdicts").then((r) => r.json());
        const verdicts: Verdict[] = data.verdicts ?? [];
        const active = verdicts.find((v) => !dismissedRef.current.has(v.report_id));
        if (active) {
          if (activeReportRef.current !== active.report_id) {
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
      } catch { /* ignore */ }

      // Monitoring summary
      try {
        const s = await fetch("/api/monitoring/summary").then((r) => r.json());
        setSummary(s);
      } catch { /* ignore */ }

      // PSI trend
      try {
        const t = await fetch("/api/monitoring/psi-trend").then((r) => r.json());
        setTrend(t.data ?? []);
      } catch { /* ignore */ }
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

  const stateColor = graphState === "monitoring"
    ? "bg-gold-400"
    : graphState === "anomalous"
      ? "bg-red-400"
      : "bg-emerald-500";

  const stateLabel = graphState === "monitoring"
    ? "monitoring hubspot"
    : graphState === "anomalous"
      ? "anomaly detected"
      : "quarantine active";

  return (
    <div className="flex flex-col h-screen bg-navy-950 text-cream-100 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 border-b border-navy-700 bg-navy-900 flex-shrink-0 h-12">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-serif text-base text-cream-100 hover:text-gold-400 transition-colors">
            Tiresias
          </Link>
          <span className="text-navy-700 select-none">·</span>
          <span className="text-cream-300/35 text-xs tracking-wide">pre-cognitive data quality</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/vp-dashboard" className="text-[11px] text-cream-300/35 hover:text-cream-300/70 transition-colors">
            VP dashboard ↗
          </Link>
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${stateColor} opacity-60`} />
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${stateColor}`} />
            </span>
            <span className="text-cream-300/40 text-xs">{stateLabel}</span>
          </div>
        </div>
      </header>

      {/* Three-horizon strip */}
      <div className="flex items-center gap-0 px-6 border-b border-navy-700 bg-navy-900/40 flex-shrink-0 h-7">
        <HorizonChip horizon="Schema" value="MCP · wanderer_financing" />
        <div className="w-px h-3 bg-navy-700 mx-4" />
        <HorizonChip horizon="Memory" value="PSI 0.25 · 7-day baseline" />
        <div className="w-px h-3 bg-navy-700 mx-4" />
        <HorizonChip horizon="Oracle" value="Gemini 2.0 Flash" />
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Lineage graph */}
        <div className="border-r border-navy-700 relative" style={{ flex: "0 0 55%" }}>
          <div className="absolute top-3 left-4 text-cream-300/25 text-[10px] tracking-widest uppercase z-10 pointer-events-none select-none">
            Dependency graph
          </div>
          <LineageGraph graphNodes={graphNodes} graphEdges={graphEdges} state={graphState} />
        </div>

        {/* Right: Data panel + Oracle verdict */}
        <div className="flex flex-col overflow-hidden" style={{ flex: "0 0 45%" }}>
          {/* Panel header */}
          <div className="px-4 py-2 border-b border-navy-700 flex-shrink-0 flex items-center justify-between">
            <span className="text-cream-300/25 text-[10px] tracking-widest uppercase">Oracle</span>
            {verdict && (
              <span className="text-[10px] font-mono text-red-400/70">
                incident active · {verdict.report_id.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">
            {verdict ? (
              /* Verdict view: full verdict with charts */
              <VerdictPanel
                verdict={verdict}
                onApprove={handleApprove}
                onDismiss={handleDismiss}
              />
            ) : (
              /* Idle view: live monitoring data */
              <MonitoringDataPanel summary={summary} trend={trend} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
