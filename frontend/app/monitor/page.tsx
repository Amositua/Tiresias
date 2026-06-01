"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import VerdictPanel from "@/components/VerdictPanel";
import MonitoringDataPanel from "@/components/MonitoringDataPanel";
import { Verdict, GraphNode, GraphEdge, MonitoringSummary, PsiTrendPoint, TableFreshness } from "@/lib/types";

const LineageGraph = dynamic(() => import("@/components/LineageGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-cream-300/40 text-sm font-mono tracking-wide">
      Loading dependency graph…
    </div>
  ),
});

const LINEAGE_TABLE = "deal_pipeline_stage";
const LINEAGE_COLUMN = "label";
const POLL_MS = 4000;

type GraphState = "monitoring" | "anomalous" | "quarantined";

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  alert,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex-1 flex flex-col justify-between px-7 py-5 border-r border-navy-700 last:border-r-0 ${alert ? "bg-red-500/5" : ""}`}>
      <div className="text-xs text-cream-300/40 uppercase tracking-widest font-sans">{label}</div>
      <div className={`text-4xl font-semibold tabular-nums leading-none mt-2 ${alert ? "text-red-400" : muted ? "text-cream-300/50" : "text-cream-100"}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs mt-2 font-mono ${alert ? "text-red-400/60" : "text-cream-300/40"}`}>{sub}</div>
      )}
    </div>
  );
}

export default function Monitor() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState>("monitoring");
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [trend, setTrend] = useState<PsiTrendPoint[]>([]);
  const [freshness, setFreshness] = useState<TableFreshness[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  const activeReportRef = useRef<string | null>(null);

  // Load lineage graph on mount
  useEffect(() => {
    fetch(`/api/lineage?table=${LINEAGE_TABLE}&column=${LINEAGE_COLUMN}`)
      .then((r) => r.json())
      .then((d) => { setGraphNodes(d.nodes ?? []); setGraphEdges(d.edges ?? []); })
      .catch(console.error);
  }, []);

  // Poll everything
  useEffect(() => {
    async function poll() {
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

      try {
        const s = await fetch("/api/monitoring/summary").then((r) => r.json());
        setSummary(s);
      } catch { /* ignore */ }

      try {
        const t = await fetch("/api/monitoring/psi-trend").then((r) => r.json());
        setTrend(t.data ?? []);
      } catch { /* ignore */ }

      try {
        const f = await fetch("/api/monitoring/freshness").then((r) => r.json());
        setFreshness(f.tables ?? []);
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

  const isAnomaly  = graphState === "anomalous";
  const isQuarantine = graphState === "quarantined";
  const dotColor = isQuarantine ? "bg-emerald-500" : isAnomaly ? "bg-red-400" : "bg-gold-400";
  const statusText = isQuarantine ? "Quarantine active" : isAnomaly ? "Anomaly detected" : "Monitoring";

  const latestPsi = summary?.latest_psi;
  const checkedAt = summary?.latest_checked_at;
  const fmtTime = (ts: string | null) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="flex flex-col h-screen bg-navy-950 text-cream-100 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 border-b border-navy-700 bg-navy-900 flex-shrink-0 h-16">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-serif text-xl text-cream-100 hover:text-gold-400 transition-colors tracking-wide">
            Tiresias
          </Link>
          <span className="text-navy-700 select-none text-lg">·</span>
          <span className="text-cream-300/40 text-sm tracking-wide">Pipeline Monitor</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6 text-sm text-cream-300/40">
            <span className="font-mono">wanderer_financing</span>
            <span>·</span>
            <span>Gemini 2.0 Flash</span>
            <span>·</span>
            <span>PSI threshold 0.25</span>
          </div>
          <Link href="/vp-dashboard" className="text-sm text-cream-300/50 hover:text-cream-100 transition-colors border border-navy-700 hover:border-cream-300/30 px-4 py-1.5 rounded">
            VP Dashboard ↗
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dotColor} opacity-60`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
            </span>
            <span className={`text-sm font-medium ${isAnomaly ? "text-red-400" : isQuarantine ? "text-emerald-400" : "text-cream-300/60"}`}>
              {statusText}
            </span>
          </div>
        </div>
      </header>

      {/* ── Full-width metric bar ───────────────────────────────────────────── */}
      <div className="flex border-b border-navy-700 bg-navy-900/50 flex-shrink-0 h-28">
        <MetricCard
          label="Tables Monitored"
          value={String(summary?.tables_watched ?? "—")}
          sub={`PSI threshold ${summary?.psi_threshold ?? 0.25} · 7-day baseline`}
        />
        <MetricCard
          label="Active Incidents"
          value={String(summary?.active_incidents ?? "—")}
          sub={(summary?.active_incidents ?? 0) > 0 ? "Pending human approval" : "All clear"}
          alert={(summary?.active_incidents ?? 0) > 0}
        />
        <MetricCard
          label="Current PSI Score"
          value={latestPsi !== null && latestPsi !== undefined ? latestPsi.toFixed(4) : "—"}
          sub={summary?.latest_psi_column ? `column: ${summary.latest_psi_column}` : "No data yet"}
          alert={summary?.is_anomalous}
          muted={!latestPsi}
        />
        <MetricCard
          label="Last Sync Checked"
          value={fmtTime(checkedAt ?? null)}
          sub={checkedAt ? new Date(checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Awaiting first sync"}
          muted={!checkedAt}
        />
      </div>

      {/* ── Two-panel body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Lineage / dependency graph */}
        <div className="border-r border-navy-700 relative" style={{ flex: "0 0 57%" }}>
          <div className="absolute top-4 left-5 z-10 pointer-events-none select-none">
            <span className="text-xs text-cream-300/30 uppercase tracking-widest">Dependency Graph</span>
          </div>
          <div className="absolute top-4 right-5 z-10 pointer-events-none select-none flex items-center gap-3 text-xs text-cream-300/25 font-mono">
            <span className="flex items-center gap-1.5"><span className="w-2 h-px bg-gold-400/40 inline-block" /> source</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-px bg-cream-300/20 inline-block" /> model</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-px bg-cream-300/20 inline-block" /> exposure</span>
          </div>
          <LineageGraph graphNodes={graphNodes} graphEdges={graphEdges} state={graphState} />
        </div>

        {/* Right: Oracle panel */}
        <div className="flex flex-col overflow-hidden" style={{ flex: "0 0 43%" }}>
          {/* Panel label */}
          <div className="px-6 py-3 border-b border-navy-700 flex-shrink-0 flex items-center justify-between bg-navy-900/30">
            <span className="text-xs text-cream-300/35 uppercase tracking-widest">Oracle · AI Verdict Engine</span>
            {verdict && (
              <span className="text-xs font-mono text-red-400/80 bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 rounded">
                Incident · {verdict.report_id.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {verdict ? (
              <VerdictPanel verdict={verdict} onApprove={handleApprove} onDismiss={handleDismiss} />
            ) : (
              <MonitoringDataPanel summary={summary} trend={trend} freshness={freshness} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
