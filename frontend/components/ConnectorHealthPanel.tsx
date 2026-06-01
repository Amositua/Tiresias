"use client";

import { ConnectorHealth } from "@/lib/types";

export default function ConnectorHealthPanel({ data }: { data: ConnectorHealth | null }) {
  if (!data) {
    return (
      <div className="flex items-center justify-center h-32 text-cream-300/30 text-sm font-mono">
        Loading connector data…
      </div>
    );
  }

  const { tables, connector_id, total_tables, monitored_tables, coverage_pct } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-cream-300/35 uppercase tracking-widest mb-1">Connector Coverage</div>
          <div className="text-sm font-mono text-cream-100">{connector_id}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums text-cream-100 leading-none">{coverage_pct}%</div>
          <div className="text-xs text-cream-300/35 font-mono mt-1">{monitored_tables} of {total_tables} tables monitored</div>
        </div>
      </div>

      {/* Coverage bar */}
      <div>
        <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gold-400/70 transition-all duration-700"
            style={{ width: `${coverage_pct}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs font-mono">
          <span className="flex items-center gap-1.5 text-cream-300/40">
            <span className="w-2 h-2 rounded-sm bg-gold-400/60 inline-block" />monitored
          </span>
          <span className="flex items-center gap-1.5 text-cream-300/25">
            <span className="w-2 h-2 rounded-sm bg-navy-700 inline-block" />unmonitored
          </span>
        </div>
      </div>

      {/* Table list */}
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {tables.map((t) => (
          <div
            key={`${t.schema}.${t.table}`}
            className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${
              !t.enabled
                ? "border-red-500/20 bg-red-500/5"
                : t.has_baseline
                  ? "border-navy-700 bg-navy-900/30"
                  : "border-navy-700/50 bg-navy-900/10 opacity-60"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                !t.enabled ? "bg-red-400" : t.has_baseline ? "bg-emerald-500/80" : "bg-cream-300/20"
              }`} />
              <span className="font-mono text-cream-100 truncate">{t.table}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              {!t.enabled && (
                <span className="text-red-400/80 uppercase tracking-wider font-semibold">quarantined</span>
              )}
              {t.enabled && t.has_baseline && (
                <span className="text-emerald-400/70 uppercase tracking-wider">monitored</span>
              )}
              {t.enabled && !t.has_baseline && (
                <span className="text-cream-300/25 uppercase tracking-wider">no baseline</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
