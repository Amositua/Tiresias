export type GraphNode = {
  id: string;
  label: string;
  node_type: "source" | "model" | "exposure";
  severity: "flagged" | "critical" | "high" | "medium" | "low";
  owner?: string | null;
  references_column?: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type BlastRadiusGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Verdict = {
  report_id: string;
  status: string;
  classification: string;
  confidence: number;
  reasoning: string;
  affected_columns: string[];
  recommended_action: string;
  proposed_mcp_action: string;
  blast_radius_summary: string;
  blast_radius_graph: BlastRadiusGraph;
  created_at: string;
};
