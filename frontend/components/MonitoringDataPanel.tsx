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
import { MonitoringSummary, PsiTrendPoint, TableFreshness, ConnectorHealth, RiskForecast } from "@/lib/types";
import RiskForecastPanel from "@/components/RiskForecast";

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

// ── Connector health inline ───────────────────────────────────────────────

import ConnectorHealthPanel from "@/components/ConnectorHealthPanel";

function ConnectorHealthPanelInline({ data }: { data: ConnectorHealth }) {
  return (
    <div>
      <div className="text-xs text-cream-300/35 uppercase tracking-widest mb-4 font-sans">
        Connector Coverage · {data.connector_id}
      </div>
      <ConnectorHealthPanel data={data} />
    </div>
  );
}

// ── Freshness section ─────────────────────────────────────────────────────

function fmtAge(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

function FreshnessBar({ age, threshold }: { age: number | null; threshold: number }) {
  if (age === null) return <div className="h-1.5 bg-navy-700 rounded-full w-full" />;
  const pct = Math.min((age / threshold) * 100, 100);
  const color = pct >= 100 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="h-1.5 bg-navy-700 rounded-full w-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function FreshnessSection({ tables }: { tables: TableFreshness[] }) {
  if (tables.length === 0) {
    return (
      <div>
        <div className="text-xs text-cream-300/35 uppercase tracking-widest mb-3 font-sans">
          Sync Freshness
        </div>
        <div className="text-sm text-cream-300/30 font-mono py-2">
          Freshness data unavailable — BigQuery not connected
        </div>
      </div>
    );
  }

  const anyStale = tables.some((t) => t.is_stale);
  const thresholdH = tables[0]
    ? Math.round(tables[0].threshold_seconds / 3600)
    : 6;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-cream-300/35 uppercase tracking-widest font-sans">
          Sync Freshness
        </div>
        <div className="text-xs text-cream-300/25 font-mono">
          stale after {thresholdH}h
        </div>
      </div>

      {anyStale && (
        <div className="flex items-center gap-2.5 mb-4 px-4 py-3 rounded-lg border border-amber-400/30 bg-amber-400/5">
          <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-400/90">
            One or more tables have not synced within the freshness threshold
          </span>
        </div>
      )}

      <div className="space-y-4">
        {tables.map((t) => (
          <div key={t.table}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.is_stale ? "bg-red-400" : t.age_seconds !== null && t.age_seconds > t.threshold_seconds * 0.75 ? "bg-amber-400" : "bg-emerald-500/80"}`} />
                <span className="text-sm font-mono text-cream-100">{t.table}</span>
              </div>
              <div className="flex items-center gap-3">
                {t.row_count !== null && (
                  <span className="text-xs text-cream-300/35 font-mono">
                    {t.row_count.toLocaleString()} rows
                  </span>
                )}
                <span className={`text-sm font-mono font-medium ${t.is_stale ? "text-red-400" : "text-cream-300/60"}`}>
                  {fmtAge(t.age_seconds)}
                </span>
              </div>
            </div>
            <FreshnessBar age={t.age_seconds} threshold={t.threshold_seconds} />
            {t.last_modified_at && (
              <div className="text-xs text-cream-300/25 font-mono mt-1">
                Last sync: {new Date(t.last_modified_at).toLocaleString()}
              </div>
            )}
          </div>
        ))}
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
  freshness,
  connectorHealth,
  riskForecast,
}: {
  summary: MonitoringSummary | null;
  trend: PsiTrendPoint[];
  freshness: TableFreshness[];
  connectorHealth: ConnectorHealth | null;
  riskForecast: RiskForecast | null;
}) {
  const isAnomalous = summary?.is_anomalous ?? false;
  const trendColumn = trend.length > 0 ? trend[trend.length - 1].column : null;

  return (
    <div className="flex flex-col h-full p-6 gap-7 overflow-y-auto">


      {/* PSI trend chart */}
      <div className="border-t border-navy-700 pt-6 flex-shrink-0" style={{ height: "260px" }}>
        <PSITrendChart
          data={trend}
          threshold={summary?.psi_threshold ?? 0.25}
          column={trendColumn}
        />
      </div>

      {/* Proactive risk forecast */}
      <div className="border-t border-navy-700 pt-6">
        <div className="text-xs text-cream-300/35 uppercase tracking-widest mb-4 font-sans">
          Proactive Risk Forecast
        </div>
        <RiskForecastPanel forecast={riskForecast} />
      </div>

      {/* Sync freshness */}
      <div className="border-t border-navy-700 pt-6">
        <FreshnessSection tables={freshness} />
      </div>

      {/* Table health */}
      <div className="border-t border-navy-700 pt-6">
        <TableHealthSection isAnomalous={isAnomalous} />
      </div>

      {/* Connector health */}
      {connectorHealth && (
        <div className="border-t border-navy-700 pt-6">
          <ConnectorHealthPanelInline data={connectorHealth} />
        </div>
      )}

      {/* Idle state indicator */}
      <IdleState />
    </div>
  );
}
