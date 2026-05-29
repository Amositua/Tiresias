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

  const isZero = data !== null && data.pipeline_value === 0;
  const hasDropped = prevValue.current !== null && prevValue.current > 0 && isZero;
  void hasDropped; // used for future transition hook

  return (
    <div className="min-h-screen bg-navy-950 text-cream-100 flex flex-col font-sans">

      {/* ── header ── */}
      <header className="px-8 py-5 border-b border-navy-700 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-xl tracking-tight">Late-Stage Pipeline</h1>
          <p className="text-xs text-cream-300 mt-0.5 font-mono tracking-wide">
            wanderer_financing · hubspot.deal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-400" />
          </span>
          <span className="text-xs text-cream-300 tracking-wide">live</span>
        </div>
      </header>

      {/* ── main metric ── */}
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-xs text-cream-300 uppercase tracking-[0.2em]">
          Late-Stage Pipeline Value
        </p>

        {loading ? (
          <div className="text-5xl font-serif text-cream-300 animate-pulse">—</div>
        ) : data ? (
          <>
            <div
              className={[
                'font-serif text-8xl font-semibold tabular-nums transition-colors duration-700',
                isZero
                  ? 'text-red-400 animate-pulse'
                  : 'text-gold-400',
              ].join(' ')}
            >
              {formatCurrency(data.pipeline_value)}
            </div>

            <p className="text-sm text-cream-300">
              {data.deal_count}{' '}
              {data.deal_count === 1 ? 'deal' : 'deals'} in stage
            </p>
          </>
        ) : (
          <div className="text-sm text-red-400">Query failed — check backend</div>
        )}
      </main>

      {/* ── query panel (hidden by default) ── */}
      {showQuery && data && (
        <div className="mx-8 mb-4 rounded border border-navy-700 bg-navy-900 px-5 py-4">
          <p className="text-xs text-cream-300 uppercase tracking-widest mb-2">Live query</p>
          <pre className="text-xs font-mono text-cream-100 leading-relaxed whitespace-pre-wrap">
            {data.query_sql}
          </pre>
        </div>
      )}

      {/* ── footer ── */}
      <footer className="px-8 py-4 border-t border-navy-700 flex items-center justify-between">
        <Link
          href="/monitor"
          className="text-xs text-cream-300 hover:text-cream-100 transition-colors"
        >
          ← Tiresias monitoring
        </Link>

        <div className="flex items-center gap-5">
          {data && (
            <span className="text-xs font-mono text-cream-300">
              last queried {formatTimestamp(data.queried_at)}
            </span>
          )}
          <button
            onClick={() => setShowQuery(v => !v)}
            className="text-xs text-cream-300 hover:text-cream-100 transition-colors underline underline-offset-2"
          >
            {showQuery ? 'hide query' : 'view query'}
          </button>
        </div>
      </footer>
    </div>
  );
}
