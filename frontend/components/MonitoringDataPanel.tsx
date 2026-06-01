"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { MonitoringSummary, PsiTrendPoint } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Metric cards ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 px-4 py-3 rounded border ${alert ? "border-red-500/30 bg-red-500/5" : "border-navy-700 bg-navy-900/40"}`}>
      <div className="text-[10px] text-cream-300/40 uppercase tracking-widest font-sans">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-none ${alert ? "text-red-400" : "text-cream-100"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-cream-300/35 font-mono">{sub}</div>}
    </div>
  );
}

// ── PSI trend chart ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: PsiTrendPoint; value: number }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-navy-900 border border-navy-700 rounded px-3 py-2 text-xs font-mono shadow-lg">
      <div className="text-cream-300/50 mb-1">{new Date(d.timestamp).toLocaleString()}</div>
      <div className={d.is_anomalous ? "text-red-400" : "text-gold-400"}>
        PSI {d.psi.toFixed(4)}
        {d.is_anomalous && "  ⚑ anomalous"}
      </div>
      {d.column && <div className="text-cream-300/40 mt-0.5">column: {d.column}</div>}
    </div>
  );
};

function PSITrendChart({
  data,
  threshold,
  column,
}: {
  data: PsiTrendPoint[];
  threshold: number;
  column: string | null;
}) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-cream-300/20 text-xs font-mono">No sync history yet</div>
        <div className="text-cream-300/15 text-[10px]">Fire a sync to begin recording PSI</div>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    time: fmt(d.timestamp),
    date: fmtDate(d.timestamp),
    psiDisplay: d.psi,
  }));

  const maxPsi = Math.max(...data.map((d) => d.psi), threshold * 1.2);
  const yDomain: [number, number] = [0, Math.ceil(maxPsi * 10) / 10 + 0.1];

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="text-[10px] text-cream-300/35 uppercase tracking-widest font-sans">
          PSI trend{column ? ` · ${column}` : ""}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-cream-300/30">threshold</span>
          <span className="text-gold-400/60">{threshold}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="psiGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#C9933A" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#C9933A" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="psiGradAlert" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1A2142" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#C8BFB0", fontSize: 9, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: "#C8BFB0", fontSize: 9, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              tickCount={4}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={threshold}
              stroke="#C9933A"
              strokeDasharray="4 3"
              strokeOpacity={0.5}
              label={{ value: "threshold", position: "right", fill: "#C9933A", fontSize: 9, fontFamily: "monospace", opacity: 0.6 }}
            />
            <Area
              type="monotone"
              dataKey="psiDisplay"
              stroke="#C9933A"
              strokeWidth={1.5}
              fill="url(#psiGrad)"
              dot={(props) => {
                const d = props.payload as PsiTrendPoint;
                if (!d.is_anomalous) return <></>;
                return (
                  <circle
                    key={`dot-${props.cx}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={3}
                    fill="#f87171"
                    stroke="#1A2142"
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{ r: 4, fill: "#C9933A", stroke: "#06091A", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Table health ──────────────────────────────────────────────────────────────

const WATCHED_TABLES = [
  { id: "hubspot.deal", label: "hubspot.deal" },
  { id: "hubspot.deal_pipeline_stage", label: "hubspot.deal_pipeline_stage" },
];

function TableHealthRow({
  table,
  isAnomalous,
  isWatched,
}: {
  table: string;
  isAnomalous: boolean;
  isWatched: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-navy-700 last:border-0">
      <div className="flex items-center gap-2.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAnomalous ? "bg-red-400" : "bg-emerald-500/70"}`} />
        <span className="text-xs font-mono text-cream-300/70">{table}</span>
      </div>
      <div className="flex items-center gap-2">
        {isWatched && (
          <span className="text-[10px] text-cream-300/30 uppercase tracking-widest">watched</span>
        )}
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${isAnomalous ? "text-red-400" : "text-emerald-400/80"}`}>
          {isAnomalous ? "anomaly" : "clean"}
        </span>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MonitoringDataPanel({
  summary,
  trend,
}: {
  summary: MonitoringSummary | null;
  trend: PsiTrendPoint[];
}) {
  const hasIncidents = (summary?.active_incidents ?? 0) > 0;
  const latestPsi = summary?.latest_psi ?? null;
  const anomalous = summary?.is_anomalous ?? false;
  const checkedAt = summary?.latest_checked_at ?? null;
  const trendColumn = trend.length > 0 ? trend[trend.length - 1].column : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Metric cards */}
      <div className="px-4 py-3 border-b border-navy-700 flex-shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            label="Tables watched"
            value={String(summary?.tables_watched ?? "—")}
            sub={`PSI threshold ${summary?.psi_threshold ?? 0.25}`}
          />
          <MetricCard
            label="Active incidents"
            value={String(summary?.active_incidents ?? "—")}
            sub={hasIncidents ? "pending approval" : "all clear"}
            alert={hasIncidents}
          />
          <MetricCard
            label="Current PSI"
            value={latestPsi !== null ? latestPsi.toFixed(4) : "—"}
            sub={summary?.latest_psi_column ?? "no data yet"}
            alert={anomalous}
          />
          <MetricCard
            label="Last checked"
            value={checkedAt ? fmt(checkedAt) : "—"}
            sub={`${summary?.baseline_age_days ?? 7}-day baseline`}
          />
        </div>
      </div>

      {/* PSI trend chart */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0" style={{ height: "180px" }}>
        <PSITrendChart
          data={trend}
          threshold={summary?.psi_threshold ?? 0.25}
          column={trendColumn}
        />
      </div>

      {/* Table health */}
      <div className="px-4 py-2 border-t border-navy-700 flex-shrink-0">
        <div className="text-[10px] text-cream-300/30 uppercase tracking-widest mb-2 font-sans">
          Table health
        </div>
        {WATCHED_TABLES.map((t) => (
          <TableHealthRow
            key={t.id}
            table={t.label}
            isAnomalous={anomalous && t.id === "hubspot.deal_pipeline_stage"}
            isWatched
          />
        ))}
      </div>

      {/* Idle state */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-400" />
          </span>
          <span className="text-cream-300/60 text-sm font-medium">Monitoring</span>
        </div>
        <p className="text-cream-300/25 text-xs tracking-wide">No anomalies detected</p>
        <div className="flex gap-2 flex-wrap justify-center mt-1">
          {[
            ["MCP", "wanderer_financing"],
            ["Memory", "7-day baseline"],
            ["Oracle", "Gemini 2.0 Flash"],
          ].map(([l, v]) => (
            <div key={l} className="border border-navy-700 rounded px-2.5 py-1.5 text-center">
              <div className="text-[10px] text-cream-300/30 uppercase tracking-widest">{l}</div>
              <div className="text-[11px] text-cream-300/55 font-mono mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
