"use client";

import { RiskForecast, RiskPrediction } from "@/lib/types";

// ── Colour config ──────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  LOW:      "#22C55E",
  MEDIUM:   "#F59E0B",
  HIGH:     "#F97316",
  CRITICAL: "#EF4444",
  UNKNOWN:  "#6B7280",
};

const LEVEL_BG: Record<string, string> = {
  LOW:      "rgba(34,197,94,0.08)",
  MEDIUM:   "rgba(245,158,11,0.08)",
  HIGH:     "rgba(249,115,22,0.10)",
  CRITICAL: "rgba(239,68,68,0.10)",
  UNKNOWN:  "rgba(107,114,128,0.06)",
};

const LEVEL_BORDER: Record<string, string> = {
  LOW:      "rgba(34,197,94,0.20)",
  MEDIUM:   "rgba(245,158,11,0.25)",
  HIGH:     "rgba(249,115,22,0.30)",
  CRITICAL: "rgba(239,68,68,0.35)",
  UNKNOWN:  "rgba(107,114,128,0.15)",
};

// ── Risk bar ───────────────────────────────────────────────────────────────

function RiskBar({ score, level }: { score: number; level: string }) {
  const color = LEVEL_COLOR[level] ?? "#6B7280";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-navy-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, ${color}88 0%, ${color} 100%)`,
            boxShadow: score >= 45 ? `0 0 8px ${color}55` : "none",
          }}
        />
      </div>
      <span
        className="text-sm font-bold tabular-nums w-8 text-right"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}

// ── Single table card ──────────────────────────────────────────────────────

function RiskCard({ prediction }: { prediction: RiskPrediction }) {
  const {
    table, risk_score, risk_level, reason,
    volatile_column, max_psi, anomaly_count, recent_anomaly_days, fingerprint_count,
  } = prediction;

  const color  = LEVEL_COLOR[risk_level]  ?? "#6B7280";
  const bg     = LEVEL_BG[risk_level]     ?? "rgba(107,114,128,0.06)";
  const border = LEVEL_BORDER[risk_level] ?? "rgba(107,114,128,0.15)";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: `1.5px solid ${border}`, background: bg }}
    >
      {/* Top bar */}
      <div
        className="h-1"
        style={{ background: `linear-gradient(90deg, ${color} 0%, ${color}44 100%)` }}
      />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-widest font-sans mb-0.5" style={{ color: `${color}BB` }}>
              hubspot
            </div>
            <div className="text-base font-semibold font-mono text-cream-100">
              {table}
            </div>
          </div>
          <div
            className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
            style={{ color, background: `${color}18`, border: `1px solid ${color}44` }}
          >
            {risk_level}
          </div>
        </div>

        {/* Risk bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-cream-300/40 uppercase tracking-widest">Drift Risk</span>
            <span className="text-xs text-cream-300/30 font-mono">{fingerprint_count} fingerprints analysed</span>
          </div>
          <RiskBar score={risk_score} level={risk_level} />
        </div>

        {/* Gemini reason */}
        <p className="text-sm font-serif italic text-cream-300/70 leading-relaxed mb-4">
          &ldquo;{reason}&rdquo;
        </p>

        {/* Signal pills */}
        <div className="flex flex-wrap gap-2">
          {anomaly_count > 0 && (
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-navy-700 text-cream-300/60">
              {anomaly_count} past drift{anomaly_count !== 1 ? "s" : ""}
            </span>
          )}
          {recent_anomaly_days !== null && (
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-navy-700 text-cream-300/60">
              last drift {recent_anomaly_days.toFixed(0)}d ago
            </span>
          )}
          {volatile_column && (
            <span
              className="text-xs font-mono px-2.5 py-1 rounded-md"
              style={{ background: `${color}12`, border: `1px solid ${color}33`, color: `${color}CC` }}
            >
              ◆ {volatile_column}
            </span>
          )}
          {max_psi > 0 && (
            <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-navy-700 text-cream-300/60">
              max PSI {max_psi.toFixed(3)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function RiskForecastPanel({ forecast }: { forecast: RiskForecast | null }) {
  if (!forecast) {
    return (
      <div className="flex items-center justify-center h-24 text-cream-300/25 text-sm font-mono">
        Loading risk forecast…
      </div>
    );
  }

  const generatedAt = new Date(forecast.generated_at).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  // Sort: highest risk first
  const sorted = [...forecast.tables].sort((a, b) => b.risk_score - a.risk_score);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-cream-300/25 font-mono">
          Next-sync drift forecast · computed {generatedAt}
        </div>
      </div>
      {sorted.map((p) => (
        <RiskCard key={p.table} prediction={p} />
      ))}
    </div>
  );
}
