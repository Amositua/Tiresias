"use client";

import React, { useEffect } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNode, GraphEdge } from "@/lib/types";

// ── Node visual config ────────────────────────────────────────────────────────

type NodeState = "monitoring" | "anomalous" | "quarantined";

const SEVERITY_COLOR: Record<string, string> = {
  flagged: "#C9933A",
  critical: "#C0392B",
  high: "#D97706",
  medium: "#92774A",
  low: "#4A5568",
};

const TYPE_LABEL: Record<string, string> = {
  source: "source table",
  model: "dbt model",
  exposure: "dashboard",
};

type TNodeData = GraphNode & { nodeState: NodeState };

function TiresiasNode({ data }: NodeProps) {
  const d = data as TNodeData;
  const isSource = d.node_type === "source";
  const isExposure = d.node_type === "exposure";
  const severityColor = SEVERITY_COLOR[d.severity] ?? "#4A5568";

  const borderColor =
    d.nodeState === "anomalous" && isSource
      ? "#C9933A"
      : d.nodeState === "quarantined" && isSource
        ? "#C0392B"
        : "#1A2142";

  const bgColor =
    d.nodeState === "quarantined" && isSource ? "#1A0606" : "#0D1229";

  const glowClass =
    d.nodeState === "anomalous" && isSource ? "node-anomalous" : "";

  return (
    <div
      className={glowClass}
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: "6px",
        padding: "10px 14px",
        minWidth: "172px",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        transition: "border-color 0.5s ease, background 0.5s ease",
      }}
    >
      {!isSource && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#1A2142", border: "none", width: 6, height: 6 }}
        />
      )}

      <div
        style={{
          fontSize: "10px",
          color: severityColor,
          fontWeight: 600,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          marginBottom: "4px",
        }}
      >
        {TYPE_LABEL[d.node_type] ?? d.node_type}
      </div>

      <div
        style={{
          fontSize: "12.5px",
          fontWeight: 500,
          color: d.nodeState === "monitoring" ? "#C8BFB0" : "#F2EDE4",
          wordBreak: "break-word",
          transition: "color 0.5s ease",
        }}
      >
        {d.label}
      </div>

      {d.owner && (
        <div style={{ fontSize: "10px", color: "#C8BFB0", marginTop: "3px" }}>
          {d.owner}
        </div>
      )}

      {d.nodeState === "quarantined" && isSource && (
        <div
          style={{
            fontSize: "10px",
            color: "#C0392B",
            marginTop: "4px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          sync disabled
        </div>
      )}

      {!isExposure && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: "#1A2142", border: "none", width: 6, height: 6 }}
        />
      )}
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

  // BFS from source to assign hop distances
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

  // Group by hop for vertical centering
  const byHop: Record<number, GraphNode[]> = {};
  for (const n of graphNodes) {
    const h = hopMap[n.id] ?? 0;
    byHop[h] = [...(byHop[h] ?? []), n];
  }

  const HORIZ = 260;
  const VERT = 130;

  const flowNodes: Node[] = graphNodes.map((n) => {
    const hop = hopMap[n.id] ?? 0;
    const siblings = byHop[hop] ?? [n];
    const idx = siblings.findIndex((s) => s.id === n.id);
    const nodeState: NodeState =
      n.node_type === "source" ? state : "monitoring";

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

  const flowEdges: Edge[] = graphEdges.map((e) => ({
    id: `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    animated: false,
    style: { stroke: "#1A2142", strokeWidth: 2 },
  }));

  return [flowNodes, flowEdges];
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  state: NodeState;
};

export default function LineageGraph({ graphNodes, graphEdges, state }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const [fn, fe] = buildLayout(graphNodes, graphEdges, state);
    setNodes(fn);

    // Always start edges non-animated
    const baseEdges = fe.map((e) => ({
      ...e,
      animated: false,
      style: { stroke: "#1A2142", strokeWidth: 2 },
    }));
    setEdges(baseEdges);

    if (state !== "anomalous") return;

    // Staggered gold sweep: 800ms initial delay + 900ms per hop
    // Deliberately slow for video readability
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    fe.forEach((_, i) => {
      const t = setTimeout(() => {
        setEdges((prev) =>
          prev.map((e, idx) =>
            idx <= i
              ? { ...e, animated: true, style: { stroke: "#C9933A", strokeWidth: 2 } }
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
        fitViewOptions={{ padding: 0.35 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#1A2142"
          gap={28}
          size={1}
        />
      </ReactFlow>
    </div>
  );
}
