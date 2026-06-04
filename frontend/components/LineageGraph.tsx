"use client";

import React, { useEffect } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  NodeProps,
  MarkerType,
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNode, GraphEdge } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeState = "monitoring" | "anomalous" | "quarantined";
type TNodeData = GraphNode & { nodeState: NodeState; psiScore?: number; psiThreshold?: number };

// ── Palette ────────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  flagged:  "#C9933A",
  critical: "#F87171",
  high:     "#FBBF24",
  medium:   "#FDE68A",
  low:      "#4B5563",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function PsiBar({ score, threshold }: { score: number; threshold: number }) {
  const pct   = Math.min((score / (threshold * 9)) * 100, 100);
  const over  = score > threshold;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "#4B5563", letterSpacing: "0.08em", textTransform: "uppercase" }}>PSI</span>
        <span style={{ fontSize: 15, fontFamily: "monospace", fontWeight: 700, color: over ? "#C9933A" : "#4B5563" }}>
          {score.toFixed(3)}&nbsp;/&nbsp;{threshold}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "#060918", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: 3,
          background: over
            ? "linear-gradient(90deg, #C9933A 0%, #F59E0B 100%)"
            : "linear-gradient(90deg, #1E2D5A 0%, #2B4090 100%)",
          transition: "width 1s ease, background 0.6s ease",
          boxShadow: over ? "0 0 8px rgba(201,147,58,0.5)" : "none",
        }} />
      </div>
      {over && (
        <div style={{ marginTop: 6, fontSize: 13, color: "#C9933A", fontWeight: 700, letterSpacing: "0.08em" }}>
          {(score / threshold).toFixed(1)}× ABOVE THRESHOLD
        </div>
      )}
    </div>
  );
}

function ColumnChip({ name, drifted }: { name: string; drifted: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: 13,
      fontFamily: "monospace",
      padding: "4px 10px",
      borderRadius: 4,
      border: `1px solid ${drifted ? "rgba(201,147,58,0.5)" : "rgba(255,255,255,0.07)"}`,
      background: drifted ? "rgba(201,147,58,0.12)" : "rgba(255,255,255,0.03)",
      color: drifted ? "#E8C87A" : "#374151",
      fontWeight: drifted ? 700 : 400,
      whiteSpace: "nowrap",
    }}>
      {drifted && <span style={{ color: "#C9933A" }}>◆</span>}
      {name}
    </span>
  );
}

function NodeDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
      {active && (
        <span style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          opacity: 0.4,
          animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
        }} />
      )}
      <span style={{
        position: "relative",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }} />
    </span>
  );
}

// ── Node component ─────────────────────────────────────────────────────────────

function TiresiasNode({ data }: NodeProps) {
  const d = data as TNodeData;
  const { node_type: type, nodeState, severity, label, owner, references_column } = d;

  const isSource   = type === "source";
  const isExposure = type === "exposure";
  const anomalous  = nodeState === "anomalous";
  const quarantined = nodeState === "quarantined";

  const accentColor =
    quarantined && isSource ? "#F87171" :
    anomalous && isSource   ? "#C9933A" :
    SEV_COLOR[severity] ?? "#1E2D5A";

  const bgGrad =
    quarantined && isSource
      ? "linear-gradient(145deg, #1A0808 0%, #0D0606 100%)"
      : anomalous && isSource
        ? "linear-gradient(145deg, #1C1305 0%, #0D0A03 100%)"
        : "linear-gradient(145deg, #0D1229 0%, #080D1E 100%)";

  const boxShadow =
    quarantined && isSource
      ? "0 0 32px rgba(248,113,113,0.25), 0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)"
      : anomalous && isSource
        ? "0 0 32px rgba(201,147,58,0.3), 0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)"
        : "0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)";

  const SOURCE_COLS = ["label", "stage_id", "probability", "is_closed"];

  const typeLabel =
    isSource   ? "Fivetran Source" :
    isExposure ? "Exposure · Dashboard" : "dbt Model";

  const subLabel =
    isSource   ? "hubspot  ·  7 rows" :
    isExposure ? "" :
    label === "stg_deals" ? "staging layer" : "marts layer";

  const dotColor =
    quarantined && isSource ? "#F87171" :
    anomalous && isSource   ? "#C9933A" : "#22C55E";

  return (
    <div
      className={anomalous && isSource ? "node-anomalous" : ""}
      style={{
        minWidth: isSource ? 300 : 260,
        maxWidth: isSource ? 330 : 285,
        borderRadius: 14,
        border: `1.5px solid ${accentColor}${anomalous || quarantined ? "" : "44"}`,
        background: bgGrad,
        boxShadow,
        overflow: "hidden",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        transition: "box-shadow 0.6s ease, border-color 0.6s ease",
      }}
    >
      {/* Top accent bar */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${accentColor} 0%, ${accentColor}44 100%)`,
      }} />

      <div style={{ padding: "22px 24px" }}>
        {/* Handle — target */}
        {!isSource && (
          <Handle
            type="target"
            position={Position.Left}
            style={{
              width: 12, height: 12,
              background: accentColor,
              border: "3px solid #080D1E",
              boxShadow: `0 0 8px ${accentColor}88`,
              left: -7,
            }}
          />
        )}

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: `${accentColor}CC`,
          }}>
            {typeLabel}
          </span>
          <NodeDot active={anomalous || nodeState === "monitoring"} color={dotColor} />
        </div>

        {/* Node name */}
        <div style={{
          fontSize: 24,
          fontWeight: 700,
          color: "#F2EDE4",
          lineHeight: 1.25,
          wordBreak: "break-word",
          marginBottom: subLabel ? 6 : 12,
        }}>
          {label}
        </div>

        {/* Sub-label */}
        {subLabel && (
          <div style={{
            fontSize: 14,
            fontFamily: "monospace",
            color: "#374151",
            marginBottom: 14,
            letterSpacing: "0.04em",
          }}>
            {subLabel}
          </div>
        )}

        {/* Source: column chips */}
        {isSource && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            {SOURCE_COLS.map((col) => (
              <ColumnChip key={col} name={col} drifted={anomalous && col === "label"} />
            ))}
          </div>
        )}

        {/* Source: PSI bar */}
        {isSource && (d.psiScore ?? 0) > 0 && (
          <PsiBar score={d.psiScore!} threshold={d.psiThreshold ?? 0.25} />
        )}

        {/* Model: references-column badge */}
        {references_column && !isSource && (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 13,
            fontWeight: 700,
            color: anomalous ? "#C9933A" : "#374151",
            background: anomalous ? "rgba(201,147,58,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${anomalous ? "rgba(201,147,58,0.3)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 6,
            padding: "5px 12px",
            marginBottom: 12,
            letterSpacing: "0.06em",
          }}>
            <span style={{ color: anomalous ? "#C9933A" : "#374151" }}>◆</span>
            joins on label column
          </div>
        )}

        {/* Exposure: owner */}
        {isExposure && owner && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#374151", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
              Owner
            </div>
            <div style={{ fontSize: 16, color: "#9CA3AF", fontWeight: 600 }}>
              {owner}
            </div>
          </div>
        )}

        {/* Exposure: impact note */}
        {isExposure && anomalous && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#FBBF24",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: 6,
            padding: "6px 12px",
            marginBottom: 12,
            fontWeight: 700,
            letterSpacing: "0.06em",
          }}>
            <span>⚠</span> Revenue at risk · $0
          </div>
        )}

        {/* Severity badge (non-source) */}
        {!isSource && (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            marginTop: 6,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: SEV_COLOR[severity] ?? "#4B5563",
          }}>
            <span style={{
              width: 6, height: 6,
              borderRadius: "50%",
              background: SEV_COLOR[severity] ?? "#4B5563",
              display: "inline-block",
              boxShadow: `0 0 6px ${SEV_COLOR[severity] ?? "#4B5563"}88`,
            }} />
            {severity} impact
          </div>
        )}

        {/* Source: quarantined state */}
        {isSource && quarantined && (
          <div style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            fontSize: 13,
            fontWeight: 700,
            color: "#FCA5A5",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F87171", display: "inline-block" }} />
            Sync Disabled
          </div>
        )}

        {/* Source: anomalous state */}
        {isSource && anomalous && !quarantined && (
          <div style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            background: "rgba(201,147,58,0.1)",
            border: "1px solid rgba(201,147,58,0.3)",
            fontSize: 13,
            fontWeight: 700,
            color: "#C9933A",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9933A", display: "inline-block", animation: "ping 1.4s infinite" }} />
            Drift Detected
          </div>
        )}

        {/* Handle — source */}
        {!isExposure && (
          <Handle
            type="source"
            position={Position.Right}
            style={{
              width: 12, height: 12,
              background: accentColor,
              border: "3px solid #080D1E",
              boxShadow: `0 0 8px ${accentColor}88`,
              right: -7,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Custom edge ────────────────────────────────────────────────────────────────

function TiresiasEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data,
}: EdgeProps & { data?: { animated?: boolean } }) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 16,
  });

  const animated = style?.stroke === "#C9933A";

  return (
    <>
      <defs>
        <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={animated ? "#C9933A" : "#1E2D5A"} stopOpacity="1" />
          <stop offset="100%" stopColor={animated ? "#F59E0B" : "#243060"} stopOpacity="0.8" />
        </linearGradient>
        {animated && (
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>

      {/* Glow layer when animated */}
      {animated && (
        <path
          d={path}
          fill="none"
          stroke="#C9933A"
          strokeWidth={6}
          strokeOpacity={0.15}
          filter={`url(#glow-${id})`}
        />
      )}

      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: `url(#grad-${id})`,
          strokeWidth: animated ? 2.5 : 2,
          filter: animated ? `url(#glow-${id})` : undefined,
        }}
      />

      {/* Edge label */}
      {label && (
        <g transform={`translate(${labelX},${labelY})`}>
          <rect
            x={-28} y={-10}
            width={56} height={20}
            rx={4} ry={4}
            fill="#060918"
            fillOpacity={0.95}
            stroke={animated ? "rgba(201,147,58,0.3)" : "rgba(255,255,255,0.07)"}
            strokeWidth={1}
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: 9,
              fontFamily: "monospace",
              fill: animated ? "#C9933A" : "#374151",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </text>
        </g>
      )}
    </>
  );
}

const nodeTypes = { tiresiasNode: TiresiasNode as React.ComponentType<NodeProps> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: any = { tiresiasEdge: TiresiasEdge };

// ── Layout ────────────────────────────────────────────────────────────────────

function buildLayout(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  state: NodeState,
  psiScore?: number,
  psiThreshold?: number
): [Node[], Edge[]] {
  if (graphNodes.length === 0) return [[], []];

  const source = graphNodes.find((n) => n.node_type === "source");
  if (!source) return [[], []];

  const hopMap: Record<string, number> = { [source.id]: 0 };
  const queue = [source.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of graphEdges.filter((e) => e.source === cur)) {
      if (hopMap[e.target] === undefined) {
        hopMap[e.target] = (hopMap[cur] ?? 0) + 1;
        queue.push(e.target);
      }
    }
  }

  const byHop: Record<number, GraphNode[]> = {};
  for (const n of graphNodes) {
    const h = hopMap[n.id] ?? 0;
    byHop[h] = [...(byHop[h] ?? []), n];
  }

  const HORIZ = 370;
  const VERT  = 190;

  const flowNodes: Node[] = graphNodes.map((n) => {
    const hop      = hopMap[n.id] ?? 0;
    const siblings = byHop[hop] ?? [n];
    const idx      = siblings.findIndex((s) => s.id === n.id);
    const nodeState: NodeState = n.node_type === "source" ? state : "monitoring";

    return {
      id: n.id,
      position: {
        x: hop * HORIZ,
        y: (idx - (siblings.length - 1) / 2) * VERT,
      },
      data: {
        ...n,
        nodeState,
        psiScore:     n.node_type === "source" ? (psiScore ?? 0) : undefined,
        psiThreshold: n.node_type === "source" ? (psiThreshold ?? 0.25) : undefined,
      },
      type: "tiresiasNode",
      draggable: false,
    };
  });

  const referencingTargets = new Set(
    graphNodes.filter((n) => n.references_column).map((n) => n.id)
  );

  const anomalous = state === "anomalous";
  const quarantined = state === "quarantined";

  const flowEdges: Edge[] = graphEdges.map((e, i) => {
    const isHot = referencingTargets.has(e.target);
    return {
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "tiresiasEdge",
      animated: false,
      label: isHot && anomalous ? "via label" : undefined,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#243060",
        width: 14,
        height: 14,
      },
      style: { stroke: "#243060", strokeWidth: 2 },
    };
  });

  return [flowNodes, flowEdges];
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  state: NodeState;
  psiScore?: number;
  psiThreshold?: number;
};

export default function LineageGraph({ graphNodes, graphEdges, state, psiScore, psiThreshold }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    const [fn, fe] = buildLayout(graphNodes, graphEdges, state, psiScore, psiThreshold);
    setNodes(fn);

    const base = fe.map((e) => ({
      ...e,
      animated: false,
      style: { stroke: "#1E2D5A", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#1E2D5A", width: 14, height: 14 },
    }));
    setEdges(base);

    if (state !== "anomalous") return;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    fe.forEach((_, i) => {
      const t = setTimeout(() => {
        setEdges((prev) =>
          prev.map((e, idx) =>
            idx <= i
              ? {
                  ...e,
                  animated: true,
                  style: { stroke: "#C9933A", strokeWidth: 2.5 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: "#C9933A", width: 14, height: 14 },
                }
              : e
          )
        );
      }, 800 + i * 900);
      timeouts.push(t);
    });

    return () => timeouts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges, state, psiScore]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.25}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          color="#0A0F24"
          gap={40}
          size={1}
          style={{ opacity: 0.8 }}
        />
        <Controls
          style={{
            background: "#080D1E",
            border: "1px solid #1E2D5A",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
}
