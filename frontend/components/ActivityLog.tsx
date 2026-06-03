"use client";

import { useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type ActivityEntry = {
  timestamp: string;
  agent: string;
  event: string;
  message: string;
  status: "running" | "done" | "error";
  report_id?: string | null;
};

// ── Agent colour config ────────────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  Memory:  "#3B82F6",   // blue
  Lineage: "#14B8A6",   // teal
  Oracle:  "#C9933A",   // gold
  Fix:     "#A78BFA",   // purple
  MCP:     "#F87171",   // red
  GitHub:  "#22C55E",   // green
};

const AGENT_BG: Record<string, string> = {
  Memory:  "rgba(59,130,246,0.10)",
  Lineage: "rgba(20,184,166,0.10)",
  Oracle:  "rgba(201,147,58,0.10)",
  Fix:     "rgba(167,139,250,0.10)",
  MCP:     "rgba(248,113,113,0.10)",
  GitHub:  "rgba(34,197,94,0.10)",
};

const STATUS_DOT: Record<string, string> = {
  running: "#F59E0B",
  done:    "#22C55E",
  error:   "#EF4444",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function EventLabel({ event }: { event: string }) {
  const label = event
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span style={{ fontSize: 11, color: "#6B7280", fontFamily: "monospace", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

function ActivityRow({ entry, index }: { entry: ActivityEntry; index: number }) {
  const color  = AGENT_COLOR[entry.agent] ?? "#6B7280";
  const bg     = AGENT_BG[entry.agent]    ?? "rgba(255,255,255,0.04)";
  const dotClr = STATUS_DOT[entry.status] ?? "#6B7280";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        animation: "fadeSlideIn 0.3s ease",
        animationDelay: `${index * 0.03}s`,
        animationFillMode: "both",
      }}
    >
      {/* Time */}
      <span style={{
        fontSize: 10,
        fontFamily: "monospace",
        color: "#374151",
        whiteSpace: "nowrap",
        marginTop: 2,
        flexShrink: 0,
        minWidth: 68,
      }}>
        {fmtTime(entry.timestamp)}
      </span>

      {/* Agent badge */}
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 4,
        padding: "1px 6px",
        whiteSpace: "nowrap",
        flexShrink: 0,
        minWidth: 56,
        textAlign: "center",
        letterSpacing: "0.04em",
      }}>
        {entry.agent}
      </span>

      {/* Status dot */}
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: dotClr,
        flexShrink: 0,
        marginTop: 5,
        boxShadow: `0 0 4px ${dotClr}88`,
      }} />

      {/* Event + message */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <EventLabel event={entry.event} />
        <div style={{
          fontSize: 12,
          color: entry.status === "running" ? "#9CA3AF" : "#C8BFB0",
          fontFamily: "monospace",
          marginTop: 1,
          wordBreak: "break-word",
          fontStyle: entry.status === "running" ? "italic" : "normal",
        }}>
          {entry.message}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Props = {
  entries: ActivityEntry[];
  maxHeight?: number;
};

export default function ActivityLog({ entries, maxHeight = 300 }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: 80,
        gap: 6,
      }}>
        <div style={{ fontSize: 12, color: "#374151", fontFamily: "monospace" }}>
          Waiting for next sync…
        </div>
        <div style={{ fontSize: 11, color: "#1F2937", fontFamily: "sans-serif" }}>
          Activity will appear here as each agent fires
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxHeight,
      overflowY: "auto",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(6,9,26,0.6)",
    }}>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {entries.map((e, i) => (
        <ActivityRow key={`${e.timestamp}-${i}`} entry={e} index={i} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
