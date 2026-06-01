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

// ── PSI trend chart ────────────────────────────────────────────────────────

const ChartTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PsiTrendPoint }[];
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-navy-900 border border-navy-700 rounded-lg px-4 py-3 text-sm font-mono shadow-xl">
      <div className="text-cream-300/50 text-xs mb-2">
        {new Date(d.timestamp).toLocaleString()}
      </div>
      <div className={`font-semibold ${d.is_anomalous ? "text-red-400" : "text-gold-400"}`}>
        PSI {d.psi.toFixed(6)}
      </div>
      {d.column && (
        <div className="text-cream-300/50 text-xs mt-1">column: {d.column}</div>
      )}
      {d.is_anomalous && (
        <div className="text-red-400/80 text-xs mt-1 font-sans">Anomalous — above threshold</div>
      )}
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
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="text-cream-300/30 text-sm font-mono">No sync history recorded yet</div>
        <div className="text-cream-300/20 text-xs font-sans">Fire a sync trigger to start recording PSI</div>
      </div>
    );
  }

  const maxY = Math.max(...data.map((d) => d.psi), threshold * 1.5);
  const yMax = Math.ceil(maxY * 10) / 10 + 0.05;

  const chartData = data.map((d) => ({
    ...d,
    time: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    psiVal: d.psi,
  }));

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-cream-100">
            PSI Trend{column ? ` — ${column}` : ""}
          </div>
          <div className="text-xs text-cream-300/40 font-mono mt-0.5">
            Population Stability Index over time
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-cream-300/40 font-mono">threshold</div>
          <div className="text-sm font-semibold text-gold-400/70 font-mono">{threshold}</div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#C9933A" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#C9933A" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="areaGradAlert" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f87171" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke="#1A2142" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#C8BFB0", fontSize: 11, fontFamily: "monospace", opacity: 0.6 }}
              tickLine={false}
              axisLine={{ stroke: "#1A2142" }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fill: "#C8BFB0", fontSize: 11, fontFamily: "monospace", opacity: 0.6 }}
              tickLine={false}
              axisLine={false}
              tickCount={5}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={44}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine
              y={threshold}
              stroke="#C9933A"
              strokeDasharray="6 4"
              strokeOpacity={0.6}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="psiVal"
              stroke="#C9933A"
              strokeWidth={2}
              fill="url(#areaGrad)"
              dot={(props) => {
                const d = props.payload as PsiTrendPoint;
                if (!d.is_anomalous) return <></>;
                return (
                  <circle
                    key={`anomaly-${props.cx}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill="#f87171"
                    stroke="#06091A"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 5, fill: "#C9933A", stroke: "#06091A", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Table health ───────────────────────────────────────────────────────────

const WATCHED = [
  { id: "hubspot.deal_pipeline_stage", label: "deal_pipeline_stage", schema: "hubspot" },
  { id: "hubspot.deal", label: "deal", schema: "hubspot" },
];

function TableHealthSection({ isAnomalous }: { isAnomalous: boolean }) {
  return (
    <div>
      <div className="text-xs text-cream-300/35 uppercase tracking-widest mb-3 font-sans">
        Table Health
      </div>
      <div className="space-y-2">
        {WATCHED.map((t) => {
          const flagged = isAnomalous && t.id === "hubspot.deal_pipeline_stage";
          return (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 rounded-lg border ${flagged ? "border-red-500/30 bg-red-500/5" : "border-navy-700 bg-navy-900/30"}`}>
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${flagged ? "bg-red-400" : "bg-emerald-500/80"}`} />
                <div>
                  <div className="text-sm font-mono text-cream-100">{t.label}</div>
                  <div className="text-xs text-cream-300/40 font-mono">{t.schema}</div>
                </div>
              </div>
              <div className={`text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded ${flagged ? "text-red-400 bg-red-500/10" : "text-emerald-400/80 bg-emerald-500/10"}`}>
                {flagged ? "Anomaly" : "Clean"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Idle state ─────────────────────────────────────────────────────────────

function IdleState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 border-t border-navy-700">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold-400" />
        </span>
        <span className="text-base font-medium text-cream-300/70">Watching for anomalies</span>
      </div>
      <p className="text-sm text-cream-300/30 text-center">
        No drift detected across monitored tables
      </p>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export default function MonitoringDataPanel({
  summary,
  trend,
}: {
  summary: MonitoringSummary | null;
  trend: PsiTrendPoint[];
}) {
  const isAnomalous = summary?.is_anomalous ?? false;
  const trendColumn = trend.length > 0 ? trend[trend.length - 1].column : null;

  return (
    <div className="flex flex-col h-full p-6 gap-6 overflow-y-auto">
      {/* PSI trend chart */}
      <div className="flex-shrink-0" style={{ height: "240px" }}>
        <PSITrendChart
          data={trend}
          threshold={summary?.psi_threshold ?? 0.25}
          column={trendColumn}
        />
      </div>

      {/* Table health */}
      <TableHealthSection isAnomalous={isAnomalous} />

      {/* Idle state indicator */}
      <IdleState />
    </div>
  );
}
