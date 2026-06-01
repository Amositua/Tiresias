"use client";

import React, { useEffect } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  NodeProps,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNode, GraphEdge } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeState = "monitoring" | "anomalous" | "quarantined";
type TNodeData = GraphNode & { nodeState: NodeState };

// ── Colour config ──────────────────────────────────────────────────────────────

const SEVERITY_ACCENT: Record<string, string> = {
  flagged:  "#C9933A",
  critical: "#EF4444",
  high:     "#F59E0B",
  medium:   "#EAB308",
  low:      "#4A5568",
};

const SEVERITY_TEXT: Record<string, string> = {
  flagged:  "#C9933A",
  critical: "#FCA5A5",
  high:     "#FCD34D",
  medium:   "#FEF08A",
  low:      "#6B7280",
};

const TYPE_LABEL: Record<string, string> = {
  source:   "Source Table",
  model:    "dbt Model",
  exposure: "Exposure",
};

const TYPE_ICON: Record<string, string> = {
  source:   "⬡",   // hexagon = data store
  model:    "⬡",
  exposure: "▣",
};

// ── Node component ─────────────────────────────────────────────────────────────

function TiresiasNode({ data }: NodeProps) {
  const d = data as TNodeData;
  const isSource   = d.node_type === "source";
  const isExposure = d.node_type === "exposure";
  const isModel    = d.node_type === "model";

  const anomalous    = d.nodeState === "anomalous";
  const quarantined  = d.nodeState === "quarantined";

  const accentColor = quarantined && isSource
    ? "#EF4444"
    : anomalous && isSource
      ? "#C9933A"
      : SEVERITY_ACCENT[d.severity] ?? "#1A2142";

  const borderColor = quarantined && isSource
    ? "#EF4444"
    : anomalous && isSource
      ? "#C9933A"
      : "#243060";

  const bgColor = quarantined && isSource
    ? "#1A0808"
    : anomalous && isSource
      ? "#1C1508"
      : "#0D1229";

  const glowStyle: React.CSSProperties = anomalous && isSource
    ? { boxShadow: "0 0 24px rgba(201,147,58,0.35), 0 0 8px rgba(201,147,58,0.2)" }
    : quarantined && isSource
      ? { boxShadow: "0 0 24px rgba(239,68,68,0.3)" }
      : {};

  return (
    <div
      style={{
        display: "flex",
        minWidth: "210px",
        maxWidth: "240px",
        borderRadius: "10px",
        border: `1.5px solid ${borderColor}`,
        overflow: "hidden",
        background: bgColor,
        transition: "all 0.5s ease",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        ...glowStyle,
      }}
    >
      {/* Left accent strip */}
      <div
        style={{
          width: "4px",
          background: accentColor,
          flexShrink: 0,
          transition: "background 0.5s ease",
        }}
      />

      {/* Main content */}
      <div style={{ padding: "12px 14px", flex: 1, minWidth: 0 }}>
        {/* Handles */}
        {!isSource && (
          <Handle
            type="target"
            position={Position.Left}
            style={{
              background: accentColor,
              border: `2px solid ${bgColor}`,
              width: 10,
              height: 10,
              left: -7,
            }}
          />
        )}

        {/* Type badge row */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
          <span style={{ fontSize: "11px", color: accentColor, opacity: 0.8 }}>
            {TYPE_ICON[d.node_type]}
          </span>
          <span
            style={{
              fontSize: "10px",
              color: accentColor,
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          >
            {TYPE_LABEL[d.node_type] ?? d.node_type}
          </span>
        </div>

        {/* Node name */}
        <div
          style={{
            fontSize: "13.5px",
            fontWeight: 600,
            color: quarantined || anomalous ? "#F2EDE4" : "#C8BFB0",
            wordBreak: "break-word",
            lineHeight: 1.3,
            marginBottom: "4px",
            transition: "color 0.5s ease",
          }}
        >
          {d.label}
        </div>

        {/* Schema context */}
        {isSource && (
          <div style={{ fontSize: "11px", color: "#4A5568", fontFamily: "monospace", marginBottom: "6px" }}>
            hubspot.{d.label}
          </div>
        )}

        {/* Column reference indicator */}
        {d.references_column && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "10px",
              color: anomalous ? "#C9933A" : "#6B7280",
              background: anomalous ? "rgba(201,147,58,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${anomalous ? "rgba(201,147,58,0.2)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: "4px",
              padding: "2px 6px",
              marginBottom: "6px",
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            <span style={{ color: anomalous ? "#C9933A" : "#6B7280" }}>◆</span>
            references label
          </div>
        )}

        {/* Owner */}
        {d.owner && (
          <div
            style={{
              fontSize: "11px",
              color: "#7C8BAD",
              marginBottom: "4px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ opacity: 0.6 }}>→</span>
            {d.owner}
          </div>
        )}

        {/* Severity badge */}
        {!isSource && (
          <div
            style={{
              marginTop: "6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: SEVERITY_TEXT[d.severity] ?? "#6B7280",
            }}
          >
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: SEVERITY_ACCENT[d.severity] ?? "#6B7280",
                display: "inline-block",
              }}
            />
            {d.severity}
          </div>
        )}

        {/* Anomaly indicator on source */}
        {anomalous && isSource && (
          <div
            style={{
              marginTop: "8px",
              padding: "4px 8px",
              background: "rgba(201,147,58,0.12)",
              border: "1px solid rgba(201,147,58,0.25)",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              color: "#C9933A",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            PSI drift detected
          </div>
        )}

        {/* Quarantine badge */}
        {quarantined && isSource && (
          <div
            style={{
              marginTop: "8px",
              padding: "4px 8px",
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              color: "#FCA5A5",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Sync disabled
          </div>
        )}

        {!isExposure && (
          <Handle
            type="source"
            position={Position.Right}
            style={{
              background: accentColor,
              border: `2px solid ${bgColor}`,
              width: 10,
              height: 10,
              right: -7,
            }}
          />
        )}
      </div>
    </div>
  );
}

const nodeTypes = { tiresiasNode: TiresiasNode as React.ComponentType<NodeProps> };

// ── Layout ────────────────────────────────────────────────────────────────────

function buildLayout(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  state: NodeState
): [Node[], Edge[]] {
  if (graphNodes.length === 0) return [[], []];

  const source = graphNodes.find((n) => n.node_type === "source");
  if (!source) return [[], []];

  // BFS hop distances
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

  const HORIZ = 290;
  const VERT  = 160;

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
      data: { ...n, nodeState },
      type: "tiresiasNode",
      draggable: false,
    };
  });

  // Edges — find which edges connect to nodes that reference the column
  const referencingTargets = new Set(
    graphNodes.filter((n) => n.references_column).map((n) => n.id)
  );

  const flowEdges: Edge[] = graphEdges.map((e) => {
    const isColumnEdge = referencingTargets.has(e.target);
    return {
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      label: isColumnEdge ? "via label" : undefined,
      labelStyle: {
        fill: "#6B7280",
        fontSize: 10,
        fontFamily: "monospace",
        fontWeight: 600,
      },
      labelBgStyle: { fill: "#0D1229", fillOpacity: 0.9 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 3,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#243060",
        width: 16,
        height: 16,
      },
      style: { stroke: "#243060", strokeWidth: 2 },
    };
  });

  return [flowNodes, flowEdges];
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  state: NodeState;
};

export default function LineageGraph({ graphNodes, graphEdges, state }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    const [fn, fe] = buildLayout(graphNodes, graphEdges, state);
    setNodes(fn);

    const baseEdges = fe.map((e) => ({
      ...e,
      animated: false,
      style: { stroke: "#243060", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#243060", width: 16, height: 16 },
    }));
    setEdges(baseEdges);

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
                  markerEnd: { type: MarkerType.ArrowClosed, color: "#C9933A", width: 16, height: 16 },
                }
              : e
          )
        );
      }, 800 + i * 900);
      timeouts.push(t);
    });

    return () => timeouts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphNodes, graphEdges, state]);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.3}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          color="#0F1830"
          gap={32}
          size={1}
          style={{ opacity: 0.6 }}
        />
        <Controls
          style={{
            background: "#0D1229",
            border: "1px solid #243060",
            borderRadius: "8px",
            overflow: "hidden",
          }}
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as TNodeData;
            if (d.nodeState === "quarantined") return "#EF4444";
            if (d.nodeState === "anomalous" && d.node_type === "source") return "#C9933A";
            return SEVERITY_ACCENT[d.severity] ?? "#243060";
          }}
          maskColor="rgba(6,9,26,0.7)"
          style={{
            background: "#06091A",
            border: "1px solid #243060",
            borderRadius: "8px",
          }}
        />
      </ReactFlow>
    </div>
  );
}
