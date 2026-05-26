"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Verdict } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const CLASSIFICATION_LABEL: Record<string, string> = {
  SILENT_SEMANTIC_FAILURE: "Silent Semantic Failure",
  ORGANIC_DRIFT: "Organic Drift",
  SCHEMA_CHANGE: "Schema Change",
  NO_ANOMALY: "No Anomaly",
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-yellow-500",
  low: "text-cream-300",
};

// ── Monitoring state ──────────────────────────────────────────────────────────

const WATCHED = ["hubspot.deal", "hubspot.deal_pipeline_stage"];

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

      <p className="text-cream-300/30 text-xs tracking-wide">
        No anomalies detected
      </p>
    </div>
  );
}

// ── Verdict card ──────────────────────────────────────────────────────────────

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
          className="flex flex-col h-full overflow-y-auto"
        >
          {/* Classification + confidence */}
          <div className="px-6 py-5 border-b border-navy-700">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-gold-400 text-xs font-semibold tracking-widest uppercase mb-2">
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
                <div className="text-gold-200 text-2xl font-semibold tabular-nums">
                  {(verdict.confidence * 100).toFixed(0)}%
                </div>
                <div className="text-cream-300/40 text-xs mt-0.5">
                  confidence
                </div>
              </div>
            </div>
          </div>

          {/* Oracle's reasoning */}
          <div className="px-6 py-5 border-b border-navy-700">
            <div className="text-cream-300/40 text-xs tracking-widest uppercase mb-3">
              Oracle&apos;s Assessment
            </div>
            <p className="font-serif italic text-cream-100 leading-relaxed text-sm">
              &ldquo;{verdict.reasoning}&rdquo;
            </p>
          </div>

          {/* Blast radius table */}
          {verdict.blast_radius_graph.nodes.filter(
            (n) => n.node_type !== "source"
          ).length > 0 && (
            <div className="px-6 py-5 border-b border-navy-700">
              <div className="text-cream-300/40 text-xs tracking-widest uppercase mb-3">
                Blast Radius
              </div>
              <div className="space-y-2">
                {verdict.blast_radius_graph.nodes
                  .filter((n) => n.node_type !== "source")
                  .map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center justify-between"
                    >
                      <div className="text-sm font-mono text-cream-100">
                        {n.label}
                      </div>
                      <div
                        className={`text-xs font-semibold uppercase tracking-widest ${SEVERITY_CLASS[n.severity] ?? "text-cream-300"}`}
                      >
                        {n.severity}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Proposed action */}
          <div className="px-6 py-5 border-b border-navy-700">
            <div className="text-cream-300/40 text-xs tracking-widest uppercase mb-3">
              Proposed Action
            </div>
            <p className="text-cream-300 text-sm leading-relaxed">
              {verdict.proposed_mcp_action}
            </p>
          </div>

          {/* CTA */}
          <div className="px-6 py-6 mt-auto">
            <AnimatePresence mode="wait">
              {approveState === "done" ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-1"
                >
                  <div className="text-red-400 text-sm font-semibold tracking-wide uppercase">
                    Quarantine Executed
                  </div>
                  <div className="text-cream-300/40 text-xs font-mono">
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
                    {approveState === "loading"
                      ? "Executing…"
                      : "Approve quarantine"}
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
