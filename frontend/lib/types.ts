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
  // drift metrics
  psi_score: number;
  psi_column: string | null;
  psi_threshold: number;
  row_delta_z: number;
  anomaly_reason: string | null;
  schema_added: string[];
  schema_removed: string[];
  dist_baseline: Record<string, number>;
  dist_current: Record<string, number>;
  suggested_fixes: FixSuggestion[];
  github_pr_url: string | null;
  github_pr_number: number | null;
  impact: ImpactScore | null;
};

export type ImpactScore = {
  pipeline_value_at_risk: number;
  time_to_detect_seconds: number;
  industry_avg_ttd_seconds: number;
  hours_saved_this_incident: number;
  incidents_caught_total: number;
  total_hours_saved: number;
};

export type FixSuggestion = {
  model_name: string;
  file_path: string;
  original_snippet: string;
  fixed_snippet: string;
  explanation: string;
};

export type MonitoringSummary = {
  tables_watched: number;
  active_incidents: number;
  psi_threshold: number;
  baseline_age_days: number;
  latest_psi: number | null;
  latest_psi_column: string | null;
  latest_checked_at: string | null;
  is_anomalous: boolean;
};

export type PsiTrendPoint = {
  timestamp: string;
  psi: number;
  column: string | null;
  table: string;
  is_anomalous: boolean;
};

export type ConnectorTable = {
  schema: string;
  table: string;
  enabled: boolean;
  has_baseline: boolean;
};

export type ConnectorHealth = {
  connector_id: string;
  total_tables: number;
  monitored_tables: number;
  coverage_pct: number;
  tables: ConnectorTable[];
};

export type PrStatus = {
  status: "pr_open" | "reenabled" | "no_pr" | "not_found" | "check_failed" | "no_github_config";
  pr_url?: string;
  pr_number?: number;
  pr_state?: string;
  pr_merged_at?: string;
  quarantined?: string;
};

export type TableFreshness = {
  table: string;
  last_modified_at: string | null;
  age_seconds: number | null;
  row_count: number | null;
  is_stale: boolean;
  threshold_seconds: number;
};
