"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { Verdict } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const CLASSIFICATION_LABEL: Record<string, string> = {
  SILENT_SEMANTIC_FAILURE: "Silent Semantic Failure",
  ORGANIC_DRIFT: "Organic Drift",
  UPSTREAM_DATA_QUALITY: "Upstream Data Quality",
  SCHEMA_CHANGE: "Schema Change",
  NO_ANOMALY: "No Anomaly",
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-amber-400",
  medium:   "text-yellow-500",
  low:      "text-cream-300",
  flagged:  "text-gold-400",
};

const WATCHED = ["hubspot.deal", "hubspot.deal_pipeline_stage"];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-navy-700 rounded px-2.5 py-1.5 text-center min-w-0">
      <div className="text-cream-300/40 text-[10px] uppercase tracking-widest whitespace-nowrap">
        {label}
      </div>
      <div className="text-cream-300/60 text-[11px] font-mono mt-0.5 whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

function MonitoringIdle() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-400" />
        </span>
        <span className="text-cream-300/70 text-sm font-medium tracking-wide">
          Monitoring
        </span>
      </div>

      <div className="space-y-1.5 text-center">
        {WATCHED.map((t) => (
          <div key={t} className="text-cream-300/50 text-xs font-mono">
            {t}
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap justify-center">
        <StatusPill label="Schema" value="MCP · wanderer_financing" />
        <StatusPill label="Memory" value="7-day baseline" />
        <StatusPill label="Oracle" value="Gemini 2.0 Flash" />
      </div>

      <p className="text-cream-300/30 text-xs tracking-wide">
        No anomalies detected
      </p>
    </div>
  );
}

// ── PSI metric row ────────────────────────────────────────────────────────────

function PsiMetric({ verdict }: { verdict: Verdict }) {
  if (!verdict.psi_column || verdict.psi_score === 0) return null;
  const multiple = verdict.psi_threshold > 0
    ? (verdict.psi_score / verdict.psi_threshold).toFixed(1)
    : "—";

  return (
    <div className="px-6 py-4 border-b border-navy-700 grid grid-cols-3 gap-4">
      <div>
        <div className="text-cream-300/40 text-[10px] uppercase tracking-widest mb-1">
          PSI score
        </div>
        <div className="text-gold-400 text-2xl font-semibold tabular-nums leading-none">
          {verdict.psi_score.toFixed(2)}
        </div>
        <div className="text-cream-300/40 text-[10px] mt-1">
          threshold {verdict.psi_threshold}
        </div>
      </div>

      <div>
        <div className="text-cream-300/40 text-[10px] uppercase tracking-widest mb-1">
          Column
        </div>
        <div className="text-cream-100 text-sm font-mono leading-snug">
          {verdict.psi_column}
        </div>
        <div className="text-amber-400/70 text-[10px] mt-1">
          {multiple}× over threshold
        </div>
      </div>

      {Math.abs(verdict.row_delta_z) >= 0.5 && (
        <div>
          <div className="text-cream-300/40 text-[10px] uppercase tracking-widest mb-1">
            Row delta
          </div>
          <div className="text-cream-100 text-sm tabular-nums leading-snug">
            {verdict.row_delta_z > 0 ? "+" : ""}
            {verdict.row_delta_z.toFixed(2)}σ
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schema delta ──────────────────────────────────────────────────────────────

function SchemaDelta({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="px-6 py-4 border-b border-navy-700">
      <div className="text-cream-300/40 text-[10px] uppercase tracking-widest mb-2">
        Schema delta
      </div>
      <div className="flex flex-wrap gap-1.5">
        {added.map((col) => (
          <span
            key={col}
            className="text-[11px] font-mono bg-navy-700 text-emerald-400 px-2 py-0.5 rounded"
          >
            +{col}
          </span>
        ))}
        {removed.map((col) => (
          <span
            key={col}
            className="text-[11px] font-mono bg-navy-700 text-red-400 px-2 py-0.5 rounded"
          >
            −{col}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Blast radius ──────────────────────────────────────────────────────────────

function BlastRadiusSection({ verdict }: { verdict: Verdict }) {
  const downstream = verdict.blast_radius_graph.nodes.filter(
    (n) => n.node_type !== "source"
  );
  if (downstream.length === 0) return null;

  return (
    <div className="px-6 py-4 border-b border-navy-700">
      <div className="text-cream-300/40 text-[10px] uppercase tracking-widest mb-3">
        Blast radius
      </div>
      <div className="space-y-3">
        {downstream.map((n) => (
          <div key={n.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {n.references_column && (
                  <span
                    className="text-gold-400 text-[10px] flex-shrink-0"
                    title="directly references the drifted column"
                  >
                    ◆
                  </span>
                )}
                <span className="text-sm font-mono text-cream-100 truncate">
                  {n.label}
                </span>
              </div>
              {n.owner && (
                <div className="text-[11px] text-cream-300/50 mt-0.5 pl-3.5">
                  → {n.owner}
                </div>
              )}
            </div>
            <div
              className={`text-[10px] font-semibold uppercase tracking-widest flex-shrink-0 mt-0.5 ${
                SEVERITY_CLASS[n.severity] ?? "text-cream-300"
              }`}
            >
              {n.severity}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Distribution shift chart ──────────────────────────────────────────────────

function DistributionChart({
  baseline,
  current,
  column,
}: {
  baseline: Record<string, number>;
  current: Record<string, number>;
  column: string | null;
}) {
  if (!column || (Object.keys(baseline).length === 0 && Object.keys(current).length === 0)) {
    return null;
  }

  const allKeys = Array.from(new Set([...Object.keys(baseline), ...Object.keys(current)]));
  // Sort: biggest movers first
  const sorted = allKeys.sort((a, b) => {
    const deltaA = Math.abs((current[a] ?? 0) - (baseline[a] ?? 0));
    const deltaB = Math.abs((current[b] ?? 0) - (baseline[b] ?? 0));
    return deltaB - deltaA;
  });

  const rows = sorted.slice(0, 8).map((k) => ({
    name: k.length > 22 ? k.slice(0, 20) + "…" : k,
    fullName: k,
    baseline: parseFloat(((baseline[k] ?? 0) * 100).toFixed(1)),
    current: parseFloat(((current[k] ?? 0) * 100).toFixed(1)),
    delta: (current[k] ?? 0) - (baseline[k] ?? 0),
  }));

  return (
    <div className="px-6 py-4 border-b border-navy-700">
      <div className="text-[10px] text-cream-300/40 uppercase tracking-widest mb-3">
        Distribution shift · {column}
      </div>
      <div className="flex items-center gap-4 mb-3 text-[10px] font-mono">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-navy-700 inline-block" />
          <span className="text-cream-300/40">baseline</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-gold-400 inline-block" />
          <span className="text-cream-300/40">current</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={rows.length * 28 + 8}>
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 0, right: 32, left: 0, bottom: 0 }}
          barCategoryGap={6}
          barGap={2}
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: "#C8BFB0", fontSize: 9, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
            tickCount={5}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#C8BFB0", fontSize: 9, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-navy-900 border border-navy-700 rounded px-3 py-2 text-xs font-mono shadow-lg">
                  <div className="text-cream-300/60 mb-1 text-[11px]">{d.fullName}</div>
                  <div className="text-cream-300/40">Baseline: {d.baseline}%</div>
                  <div className={`${d.delta > 0 ? "text-emerald-400" : d.delta < 0 ? "text-red-400" : "text-cream-300/40"}`}>
                    Current: {d.current}%
                    {d.delta !== 0 && ` (${d.delta > 0 ? "+" : ""}${(d.delta * 100).toFixed(1)}pp)`}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="baseline" name="Baseline" radius={[0, 2, 2, 0]}>
            {rows.map((r) => (
              <Cell
                key={r.fullName + "-b"}
                fill={r.delta < -0.05 ? "rgba(248,113,113,0.3)" : "#1A2142"}
              />
            ))}
          </Bar>
          <Bar dataKey="current" name="Current" radius={[0, 2, 2, 0]}>
            {rows.map((r) => (
              <Cell
                key={r.fullName + "-c"}
                fill={r.delta > 0.05 ? "#C9933A" : r.delta < -0.05 ? "rgba(248,113,113,0.2)" : "#2a3560"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  verdict: Verdict | null;
  onApprove: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
};

export default function VerdictPanel({ verdict, onApprove, onDismiss }: Props) {
  const [approveState, setApproveState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleApprove() {
    if (!verdict) return;
    setApproveState("loading");
    try {
      await onApprove(verdict.report_id);
      setApproveState("done");
    } catch {
      setApproveState("error");
      setErrorMsg("Execution failed — check backend logs");
    }
  }

  async function handleDismiss() {
    if (!verdict) return;
    setApproveState("idle");
    setErrorMsg("");
    await onDismiss(verdict.report_id);
  }

  return (
    <AnimatePresence mode="wait">
      {!verdict ? (
        <motion.div
          key="idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-full"
        >
          <MonitoringIdle />
        </motion.div>
      ) : (
        <motion.div
          key={verdict.report_id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.38, ease: "easeOut" }}
          className="flex flex-col overflow-y-auto"
        >
          {/* ── Classification + confidence ── */}
          <div className="px-6 py-5 border-b border-navy-700">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-gold-400 text-[11px] font-semibold tracking-widest uppercase mb-2">
                  {CLASSIFICATION_LABEL[verdict.classification] ??
                    verdict.classification}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {verdict.affected_columns.map((col) => (
                    <span
                      key={col}
                      className="text-xs font-mono bg-navy-700 text-cream-300 px-2 py-0.5 rounded"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-gold-200 text-2xl font-semibold tabular-nums leading-none">
                  {(verdict.confidence * 100).toFixed(0)}%
                </div>
                <div className="text-cream-300/40 text-[10px] mt-1">
                  confidence
                </div>
              </div>
            </div>
          </div>

          {/* ── PSI metric ── */}
          <PsiMetric verdict={verdict} />

          {/* ── Schema delta ── */}
          <SchemaDelta
            added={verdict.schema_added}
            removed={verdict.schema_removed}
          />

          {/* ── Distribution shift chart ── */}
          <DistributionChart
            baseline={verdict.dist_baseline}
            current={verdict.dist_current}
            column={verdict.psi_column}
          />

          {/* ── Oracle's reasoning ── */}
          <div className="px-6 py-5 border-b border-navy-700">
            <div className="text-cream-300/40 text-[10px] tracking-widest uppercase mb-3">
              Oracle&apos;s Assessment
            </div>
            <p className="font-serif italic text-cream-100 leading-relaxed text-sm">
              &ldquo;{verdict.reasoning}&rdquo;
            </p>
          </div>

          {/* ── Blast radius ── */}
          <BlastRadiusSection verdict={verdict} />

          {/* ── Proposed action ── */}
          <div className="px-6 py-4 border-b border-navy-700">
            <div className="text-cream-300/40 text-[10px] tracking-widest uppercase mb-2">
              Proposed Action
            </div>
            <p className="text-cream-300 text-xs font-mono leading-relaxed">
              {verdict.proposed_mcp_action}
            </p>
          </div>

          {/* ── CTA ── */}
          <div className="px-6 py-5">
            <AnimatePresence mode="wait">
              {approveState === "done" ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-1.5"
                >
                  <div className="text-red-400 text-sm font-semibold tracking-wide uppercase">
                    Quarantine Executed
                  </div>
                  <div className="text-cream-300/40 text-[11px] font-mono">
                    {verdict.proposed_mcp_action}
                  </div>
                </motion.div>
              ) : approveState === "error" ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  <p className="text-red-400 text-sm text-center">{errorMsg}</p>
                  <button
                    onClick={() => setApproveState("idle")}
                    className="w-full text-cream-300/50 text-xs hover:text-cream-300 transition-colors"
                  >
                    Try again
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="actions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-5"
                >
                  <button
                    onClick={handleApprove}
                    disabled={approveState === "loading"}
                    className="flex-1 bg-gold-400 hover:bg-gold-200 disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-semibold text-sm py-2.5 px-4 rounded transition-colors duration-150"
                  >
                    {approveState === "loading" ? "Executing…" : "Approve quarantine"}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="text-cream-300/50 hover:text-cream-300 text-sm transition-colors"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
