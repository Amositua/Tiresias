"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
} from "recharts";
import { Verdict, FixSuggestion, PrStatus, ImpactScore } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────

const CLASSIFICATION_LABEL: Record<string, string> = {
  SILENT_SEMANTIC_FAILURE: "Silent Semantic Failure",
  ORGANIC_DRIFT: "Organic Drift",
  UPSTREAM_DATA_QUALITY: "Upstream Data Quality",
  SCHEMA_CHANGE: "Schema Change",
  NO_ANOMALY: "No Anomaly",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-yellow-500",
  low: "text-cream-300/60",
  flagged: "text-gold-400",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "bg-red-500/10 border-red-500/20",
  high: "bg-amber-500/10 border-amber-500/20",
  medium: "bg-yellow-500/10 border-yellow-500/20",
  low: "bg-navy-700 border-navy-700",
  flagged: "bg-gold-400/10 border-gold-400/20",
};

// ── Impact card ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtSeconds(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

function ImpactCard({ impact }: { impact: ImpactScore }) {
  const industryH = (impact.industry_avg_ttd_seconds / 3600).toFixed(1);
  return (
    <div className="px-6 py-5 border-b border-navy-700 bg-navy-900/60">
      <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-4 font-sans">
        Business Impact
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* Pipeline at risk */}
        <div className="col-span-2 rounded-lg border border-red-500/25 bg-red-500/6 px-4 py-3">
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Pipeline value at risk</div>
          <div className="text-3xl font-bold text-red-400 tabular-nums leading-none">
            {fmt(impact.pipeline_value_at_risk)}
          </div>
          <div className="text-xs text-cream-300/30 font-mono mt-1">hubspot.deal · Contract Sent stage</div>
        </div>

        {/* TTD */}
        <div className="rounded-lg border border-navy-700 bg-navy-900/40 px-4 py-3">
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Detected in</div>
          <div className="text-2xl font-bold text-emerald-400 tabular-nums leading-none">
            {fmtSeconds(impact.time_to_detect_seconds)}
          </div>
          <div className="text-xs text-cream-300/30 font-mono mt-1">from sync to verdict</div>
        </div>

        {/* Industry avg */}
        <div className="rounded-lg border border-navy-700 bg-navy-900/40 px-4 py-3">
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Industry avg TTD</div>
          <div className="text-2xl font-bold text-cream-300/50 tabular-nums leading-none">
            ~{industryH}h
          </div>
          <div className="text-xs text-cream-300/25 font-mono mt-1">benchmark estimate</div>
        </div>

        {/* Hours saved */}
        <div className="rounded-lg border border-gold-400/20 bg-gold-400/5 px-4 py-3">
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Eng. hours saved</div>
          <div className="text-2xl font-bold text-gold-400 tabular-nums leading-none">
            {impact.hours_saved_this_incident.toFixed(1)}h
          </div>
          <div className="text-xs text-cream-300/30 font-mono mt-1">this incident</div>
        </div>

        {/* Cumulative */}
        <div className="rounded-lg border border-navy-700 bg-navy-900/40 px-4 py-3">
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Total incidents caught</div>
          <div className="text-2xl font-bold text-cream-100 tabular-nums leading-none">
            {impact.incidents_caught_total}
          </div>
          <div className="text-xs text-cream-300/30 font-mono mt-1">{impact.total_hours_saved.toFixed(1)}h saved total</div>
        </div>
      </div>
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-cream-300/35 uppercase tracking-widest font-sans mb-3">
      {children}
    </div>
  );
}

// ── PSI metric row ─────────────────────────────────────────────────────────

function PsiMetric({ verdict }: { verdict: Verdict }) {
  if (!verdict.psi_column || verdict.psi_score === 0) return null;
  const multiple = verdict.psi_threshold > 0
    ? (verdict.psi_score / verdict.psi_threshold).toFixed(1)
    : "—";

  return (
    <div className="px-6 py-5 border-b border-navy-700 grid grid-cols-3 gap-6">
      <div>
        <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-2">PSI Score</div>
        <div className="text-3xl font-bold text-gold-400 tabular-nums leading-none">
          {verdict.psi_score.toFixed(4)}
        </div>
        <div className="text-xs text-cream-300/40 font-mono mt-1.5">
          threshold {verdict.psi_threshold}
        </div>
      </div>
      <div>
        <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-2">Column</div>
        <div className="text-lg font-mono text-cream-100 leading-tight">{verdict.psi_column}</div>
        <div className="text-xs text-amber-400/70 font-mono mt-1.5">{multiple}× over threshold</div>
      </div>
      {Math.abs(verdict.row_delta_z) >= 0.5 && (
        <div>
          <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-2">Row Δ</div>
          <div className="text-lg font-mono text-cream-100 leading-tight">
            {verdict.row_delta_z > 0 ? "+" : ""}{verdict.row_delta_z.toFixed(2)}σ
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schema delta ───────────────────────────────────────────────────────────

function SchemaDelta({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="px-6 py-5 border-b border-navy-700">
      <SectionLabel>Schema Delta</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {added.map((col) => (
          <span key={col} className="text-sm font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded">
            + {col}
          </span>
        ))}
        {removed.map((col) => (
          <span key={col} className="text-sm font-mono bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded">
            − {col}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Distribution chart ─────────────────────────────────────────────────────

function DistributionChart({
  baseline,
  current,
  column,
}: {
  baseline: Record<string, number>;
  current: Record<string, number>;
  column: string | null;
}) {
  if (!column || (Object.keys(baseline).length === 0 && Object.keys(current).length === 0)) return null;

  const allKeys = Array.from(new Set([...Object.keys(baseline), ...Object.keys(current)]));
  const sorted = allKeys.sort((a, b) => {
    const dA = Math.abs((current[a] ?? 0) - (baseline[a] ?? 0));
    const dB = Math.abs((current[b] ?? 0) - (baseline[b] ?? 0));
    return dB - dA;
  });

  const rows = sorted.slice(0, 7).map((k) => ({
    name: k.length > 20 ? k.slice(0, 18) + "…" : k,
    fullName: k,
    baseline: parseFloat(((baseline[k] ?? 0) * 100).toFixed(1)),
    current: parseFloat(((current[k] ?? 0) * 100).toFixed(1)),
    delta: (current[k] ?? 0) - (baseline[k] ?? 0),
  }));

  const rowH = 30;

  return (
    <div className="px-6 py-5 border-b border-navy-700">
      <SectionLabel>Distribution Shift · {column}</SectionLabel>
      <div className="flex items-center gap-5 mb-4 text-xs font-mono">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-navy-700 inline-block border border-navy-700" />
          <span className="text-cream-300/50">Baseline (7-day avg)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-gold-400 inline-block" />
          <span className="text-cream-300/50">Current sync</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={rows.length * rowH + 16}>
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
          barCategoryGap={8}
          barGap={2}
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: "#C8BFB0", fontSize: 11, fontFamily: "monospace", opacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
            tickCount={5}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#C8BFB0", fontSize: 11, fontFamily: "monospace", opacity: 0.7 }}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-navy-900 border border-navy-700 rounded-lg px-4 py-3 text-sm font-mono shadow-xl">
                  <div className="text-cream-100 font-semibold mb-2">{d.fullName}</div>
                  <div className="text-cream-300/50">Baseline: {d.baseline}%</div>
                  <div className={d.delta > 0 ? "text-emerald-400" : d.delta < 0 ? "text-red-400" : "text-cream-300/50"}>
                    Current: {d.current}%
                    {d.delta !== 0 && ` (${d.delta > 0 ? "+" : ""}${(d.delta * 100).toFixed(1)}pp)`}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="baseline" radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell key={`b-${r.fullName}`}
                fill={r.delta < -0.05 ? "rgba(248,113,113,0.25)" : "#1A2142"}
              />
            ))}
          </Bar>
          <Bar dataKey="current" radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell key={`c-${r.fullName}`}
                fill={r.delta > 0.05 ? "#C9933A" : r.delta < -0.05 ? "rgba(248,113,113,0.15)" : "#2a3560"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Blast radius ───────────────────────────────────────────────────────────

function BlastRadiusSection({ verdict }: { verdict: Verdict }) {
  const downstream = verdict.blast_radius_graph.nodes.filter((n) => n.node_type !== "source");
  if (!downstream.length) return null;

  return (
    <div className="px-6 py-5 border-b border-navy-700">
      <SectionLabel>Blast Radius — {downstream.length} downstream assets affected</SectionLabel>
      <div className="space-y-3">
        {downstream.map((n) => (
          <div key={n.id} className={`flex items-start justify-between gap-4 px-4 py-3 rounded-lg border ${SEVERITY_BG[n.severity] ?? "bg-navy-900/30 border-navy-700"}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {n.references_column && (
                  <span className="text-gold-400 text-sm flex-shrink-0" title="Directly references the drifted column">◆</span>
                )}
                <span className="text-sm font-mono text-cream-100 font-medium">{n.label}</span>
                <span className="text-xs text-cream-300/35 capitalize">{n.node_type}</span>
              </div>
              {n.owner && (
                <div className="text-xs text-cream-300/50 mt-1 ml-5 font-sans">
                  Owner: {n.owner}
                </div>
              )}
            </div>
            <div className={`text-xs font-bold uppercase tracking-wider flex-shrink-0 mt-0.5 ${SEVERITY_COLOR[n.severity] ?? "text-cream-300"}`}>
              {n.severity}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Suggested fixes ────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs text-cream-300/40 hover:text-cream-300/80 transition-colors font-mono"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function SuggestedFixes({ fixes }: { fixes: FixSuggestion[] }) {
  if (!fixes || fixes.length === 0) return null;
  return (
    <div className="px-6 py-5 border-b border-navy-700 bg-emerald-500/3">
      <div className="flex items-center gap-3 mb-4">
        <SectionLabel>Suggested Fix{fixes.length > 1 ? "es" : ""} — generated by Oracle</SectionLabel>
        <span className="text-xs text-emerald-400/70 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-mono mb-3">
          {fixes.length} model{fixes.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-5">
        {fixes.map((fix, i) => (
          <div key={i} className="rounded-lg border border-navy-700 overflow-hidden">
            {/* Model header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-navy-900 border-b border-navy-700">
              <div>
                <span className="text-sm font-mono font-semibold text-cream-100">{fix.model_name}</span>
                <span className="text-xs text-cream-300/35 font-mono ml-2">{fix.file_path}</span>
              </div>
            </div>

            {/* Before */}
            <div className="border-b border-navy-700">
              <div className="flex items-center justify-between px-4 py-1.5 bg-red-500/5 border-b border-red-500/15">
                <span className="text-xs text-red-400/70 uppercase tracking-widest">Before (breaks)</span>
                <CopyButton text={fix.original_snippet} />
              </div>
              <pre className="px-4 py-3 text-sm font-mono text-red-300/80 bg-red-500/5 leading-relaxed whitespace-pre-wrap overflow-x-auto">
                {fix.original_snippet}
              </pre>
            </div>

            {/* After */}
            <div>
              <div className="flex items-center justify-between px-4 py-1.5 bg-emerald-500/5 border-b border-emerald-500/15">
                <span className="text-xs text-emerald-400/70 uppercase tracking-widest">After (fix)</span>
                <CopyButton text={fix.fixed_snippet} />
              </div>
              <pre className="px-4 py-3 text-sm font-mono text-emerald-300/90 bg-emerald-500/5 leading-relaxed whitespace-pre-wrap overflow-x-auto">
                {fix.fixed_snippet}
              </pre>
            </div>

            {/* Explanation */}
            <div className="px-4 py-3 bg-navy-900/40 border-t border-navy-700">
              <p className="text-xs text-cream-300/55 font-sans leading-relaxed">{fix.explanation}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Proposed action ────────────────────────────────────────────────────────

function ProposedAction({ verdict }: { verdict: Verdict }) {
  return (
    <div className="px-6 py-5 border-b border-navy-700">
      <SectionLabel>Proposed MCP Action</SectionLabel>
      <div className="bg-navy-900 border border-navy-700 rounded-lg px-4 py-3 font-mono text-sm text-cream-300/80 leading-relaxed">
        {verdict.proposed_mcp_action}
      </div>
    </div>
  );
}

// ── CTA ────────────────────────────────────────────────────────────────────

type ApproveState =
  | "idle"
  | "loading"
  | "quarantined"       // quarantined, PR being created
  | "pr_open"           // PR exists, waiting for merge
  | "pr_merged"         // PR merged, re-enabling
  | "loop_closed"       // fully done
  | "error";

function ApproveButton({
  verdict,
  onApprove,
  onDismiss,
}: {
  verdict: Verdict;
  onApprove: (id: string) => Promise<{ github_pr_url?: string; github_pr_number?: number }>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const [state, setState] = useState<ApproveState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [prUrl, setPrUrl] = useState<string | null>(verdict.github_pr_url);
  const [prNumber, setPrNumber] = useState<number | null>(verdict.github_pr_number);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start polling when PR is open
  useEffect(() => {
    if (state !== "pr_open" || !prNumber) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/monitoring/pr-status?report_id=${verdict.report_id}`);
        const data: PrStatus = await res.json();
        if (data.status === "reenabled" || data.pr_merged_at) {
          clearInterval(pollRef.current!);
          setState("loop_closed");
        }
      } catch { /* ignore */ }
    }, 12000); // poll every 12 seconds
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state, prNumber, verdict.report_id]);

  async function handleApprove() {
    setState("loading");
    try {
      const result = await onApprove(verdict.report_id);
      if (result.github_pr_url) {
        setPrUrl(result.github_pr_url);
        setPrNumber(result.github_pr_number ?? null);
        setState("pr_open");
      } else {
        setState("quarantined");
      }
    } catch {
      setState("error");
      setErrMsg("Execution failed — check backend logs");
    }
  }

  if (state === "loop_closed") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <div className="text-xl font-serif text-gold-400">Loop Closed</div>
        <div className="text-sm text-cream-300/60 leading-relaxed">
          PR merged · Table re-enabled at Fivetran source ·
          Next sync will run with the deployed fix
        </div>
      </motion.div>
    );
  }

  if (state === "pr_open" && prUrl) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {/* PR card */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-400 mb-1">
                GitHub PR #{prNumber} opened
              </div>
              <div className="text-xs text-cream-300/50 leading-relaxed">
                Fix committed to branch · Tiresias is watching for merge
              </div>
              <div className="text-xs text-cream-300/30 font-mono mt-1.5">
                Auto-re-enable fires when PR is merged
              </div>
            </div>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 px-3 py-2 rounded transition-colors font-semibold"
            >
              View PR →
            </a>
          </div>
        </div>

        {/* Autonomous status */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-400" />
          </span>
          <span className="text-sm text-cream-300/50">
            Monitoring PR · will re-enable automatically on merge
          </span>
        </div>
      </motion.div>
    );
  }

  if (state === "quarantined") {
    return (
      <div className="text-center space-y-2">
        <div className="text-base font-semibold text-emerald-400">Table Quarantined</div>
        <div className="text-xs font-mono text-cream-300/40">{verdict.proposed_mcp_action}</div>
        <div className="text-sm text-cream-300/35 mt-1">No GitHub token configured — apply fix manually</div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-3">
        <p className="text-red-400 text-sm text-center">{errMsg}</p>
        <button onClick={() => setState("idle")} className="w-full text-sm text-cream-300/50 hover:text-cream-300 transition-colors underline">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handleApprove}
        disabled={state === "loading"}
        className="flex-1 bg-gold-400 hover:bg-gold-200 disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-bold text-base py-3.5 px-6 rounded-lg transition-colors tracking-wide"
      >
        {state === "loading" ? "Executing quarantine…" : "Approve Quarantine"}
      </button>
      <button
        onClick={() => onDismiss(verdict.report_id)}
        className="text-sm text-cream-300/40 hover:text-cream-300 transition-colors px-4 py-3.5"
      >
        Dismiss
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  verdict: Verdict | null;
  onApprove: (id: string) => Promise<{ github_pr_url?: string; github_pr_number?: number }>;
  onDismiss: (id: string) => Promise<void>;
};

export default function VerdictPanel({ verdict, onApprove, onDismiss }: Props) {
  if (!verdict) return null;

  return (
    <motion.div
      key={verdict.report_id}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col"
    >
      {/* Classification header */}
      <div className="px-6 py-6 border-b border-navy-700 bg-navy-900/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-semibold uppercase tracking-widest mb-3 ${verdict.classification === "SILENT_SEMANTIC_FAILURE" ? "text-red-400" : "text-gold-400"}`}>
              {CLASSIFICATION_LABEL[verdict.classification] ?? verdict.classification}
            </div>
            <div className="font-serif text-2xl text-cream-100 leading-snug mb-3">
              Anomaly detected on
              <br />
              <span className="font-mono text-xl text-gold-400">deal_pipeline_stage.label</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {verdict.affected_columns.map((col) => (
                <span key={col} className="text-sm font-mono bg-navy-700 border border-navy-700 text-cream-300 px-3 py-1 rounded-md">
                  {col}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-5xl font-bold tabular-nums text-cream-100 leading-none">
              {(verdict.confidence * 100).toFixed(0)}
              <span className="text-2xl text-cream-300/40">%</span>
            </div>
            <div className="text-xs text-cream-300/40 mt-2 uppercase tracking-widest">Confidence</div>
          </div>
        </div>
      </div>

      {/* Business impact */}
      {verdict.impact && <ImpactCard impact={verdict.impact} />}

      {/* PSI metric */}
      <PsiMetric verdict={verdict} />

      {/* Distribution chart */}
      <DistributionChart
        baseline={verdict.dist_baseline}
        current={verdict.dist_current}
        column={verdict.psi_column}
      />

      {/* Schema delta */}
      <SchemaDelta added={verdict.schema_added} removed={verdict.schema_removed} />

      {/* Oracle reasoning */}
      <div className="px-6 py-5 border-b border-navy-700">
        <SectionLabel>Oracle&apos;s Assessment</SectionLabel>
        <p className="font-serif italic text-cream-100 text-base leading-relaxed">
          &ldquo;{verdict.reasoning}&rdquo;
        </p>
      </div>

      {/* Blast radius */}
      <BlastRadiusSection verdict={verdict} />

      {/* Suggested dbt fixes — generated by second Oracle pass */}
      <SuggestedFixes fixes={verdict.suggested_fixes} />

      {/* Proposed action */}
      <ProposedAction verdict={verdict} />

      {/* Approve CTA */}
      <div className="px-6 py-6">
        <ApproveButton verdict={verdict} onApprove={onApprove} onDismiss={onDismiss} />
      </div>
    </motion.div>
  );
}
