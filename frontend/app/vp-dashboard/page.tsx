'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type PipelineData = {
  pipeline_value: number;
  deal_count: number;
  queried_at: string;
  query_sql: string;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

export default function VPDashboard() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQuery, setShowQuery] = useState(false);
  const [hasAlert, setHasAlert] = useState(false);
  const prevValue = useRef<number | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/vp-pipeline');
        if (res.ok) {
          const json: PipelineData = await res.json();
          prevValue.current = data?.pipeline_value ?? null;
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for active Tiresias incidents
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/verdicts');
        if (res.ok) {
          const json = await res.json();
          setHasAlert((json.verdicts ?? []).length > 0);
        }
      } catch { /* ignore */ }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const isZero = data !== null && data.pipeline_value === 0;

  return (
    <div className="min-h-screen bg-navy-950 text-cream-100 flex flex-col font-sans">

      {/* Tiresias alert banner */}
      {hasAlert && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" />
            </span>
            <span className="text-sm text-red-400 font-medium">
              Tiresias has raised a data quality alert on this pipeline
            </span>
          </div>
          <Link href="/monitor" className="text-sm text-red-400 hover:text-red-300 transition-colors font-medium underline underline-offset-2">
            View incident →
          </Link>
        </div>
      )}

      {/* Header */}
      <header className="px-10 py-7 border-b border-navy-700 flex items-center justify-between">
        <div>
          <p className="text-xs text-cream-300/40 uppercase tracking-widest font-sans mb-1">wanderer_financing · HubSpot CRM</p>
          <h1 className="font-serif text-2xl text-cream-100 tracking-tight">Late-Stage Pipeline</h1>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="text-xs text-cream-300/40 uppercase tracking-widest mb-1">Status</div>
            <div className="flex items-center gap-2 justify-end">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-400" />
              </span>
              <span className="text-sm text-cream-300/70">Live query</span>
            </div>
          </div>
          <Link
            href="/monitor"
            className="text-sm text-cream-300/50 hover:text-cream-100 transition-colors border border-navy-700 hover:border-cream-300/30 px-4 py-2 rounded"
          >
            ← Monitoring
          </Link>
        </div>
      </header>

      {/* Main metric */}
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <p className="text-sm text-cream-300/40 uppercase tracking-[0.25em] font-sans">
          Late-Stage Pipeline Value
        </p>

        {loading ? (
          <div className="text-8xl font-serif text-cream-300/30 animate-pulse">—</div>
        ) : data ? (
          <>
            <div className={[
              'font-serif tabular-nums transition-colors duration-700 leading-none',
              isZero
                ? 'text-red-400 text-8xl animate-pulse'
                : 'text-gold-400 text-8xl md:text-9xl',
            ].join(' ')}>
              {formatCurrency(data.pipeline_value)}
            </div>

            {isZero && (
              <div className="flex items-center gap-3 mt-2">
                <span className="text-base text-red-400/80 font-sans">
                  Filter returned no results — pipeline stage label may have changed
                </span>
              </div>
            )}

            <p className="text-base text-cream-300/60 font-sans">
              {data.deal_count} {data.deal_count === 1 ? 'deal' : 'deals'} in late-stage pipeline
            </p>
          </>
        ) : (
          <div className="text-base text-red-400">Query failed — check backend connection</div>
        )}
      </main>

      {/* Query panel */}
      {showQuery && data && (
        <div className="mx-10 mb-6 rounded-lg border border-navy-700 bg-navy-900 overflow-hidden">
          <div className="px-5 py-3 border-b border-navy-700 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
            <span className="ml-2 text-xs text-cream-300/30 font-mono">live BigQuery query</span>
          </div>
          <pre className="text-sm font-mono text-cream-300/70 leading-relaxed whitespace-pre-wrap px-5 py-4">
            {data.query_sql}
          </pre>
        </div>
      )}

      {/* Footer */}
      <footer className="px-10 py-5 border-t border-navy-700 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-cream-300/40 font-mono">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-40" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-gold-400" />
          </span>
          {data ? `Last queried ${formatTimestamp(data.queried_at)}` : 'Querying…'}
        </div>

        <button
          onClick={() => setShowQuery((v) => !v)}
          className="text-sm text-cream-300/40 hover:text-cream-100 transition-colors underline underline-offset-2"
        >
          {showQuery ? 'Hide query' : 'View live query'}
        </button>
      </footer>
    </div>
  );
}
