// Shared types and utilities for DAG workflow nodes
import type { Node, Edge } from "@xyflow/react";

export type WorkflowNodeType =
  | "browser_action"
  | "webhook_call"
  | "data_transform"
  | "approval_gate"
  | "conditional_branch"
  | "delay";

export interface WorkflowNodeData {
  label: string;
  action?: string;
  parameters?: Record<string, unknown>;
  phase?: string;
  max_retries?: number;
  timeout_ms?: number;
  condition?: string;
  delay_seconds?: number;
  webhook_url?: string;
  webhook_method?: string;
  webhook_headers?: Record<string, string>;
  transform_expression?: string;
  // Execution state overlay
  _status?: "pending" | "running" | "completed" | "failed" | "waiting" | "skipped";
  _error?: string;
  _error_class?: string;
  _duration_ms?: number;
}

export type WorkflowNode = Node<WorkflowNodeData, WorkflowNodeType>;
export type WorkflowEdge = Edge;

export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export const NODE_TYPE_CONFIG: Record<WorkflowNodeType, { label: string; color: string; borderColor: string; bgColor: string }> = {
  browser_action: { label: "Browser Action", color: "text-blue-400", borderColor: "border-blue-500/30", bgColor: "bg-blue-500/5" },
  webhook_call: { label: "Webhook", color: "text-purple-400", borderColor: "border-purple-500/30", bgColor: "bg-purple-500/5" },
  data_transform: { label: "Transform", color: "text-cyan-400", borderColor: "border-cyan-500/30", bgColor: "bg-cyan-500/5" },
  approval_gate: { label: "Approval Gate", color: "text-amber-400", borderColor: "border-amber-500/30", bgColor: "bg-amber-500/5" },
  conditional_branch: { label: "Condition", color: "text-orange-400", borderColor: "border-orange-500/30", bgColor: "bg-orange-500/5" },
  delay: { label: "Delay", color: "text-slate-400", borderColor: "border-slate-500/30", bgColor: "bg-slate-500/5" },
};

export const STATUS_STYLES: Record<string, string> = {
  pending: "border-border/50 opacity-60",
  running: "border-blue-500/50 ring-2 ring-blue-500/20 animate-pulse",
  completed: "border-emerald-500/50",
  failed: "border-red-500/50",
  waiting: "border-amber-500/50 ring-2 ring-amber-500/20",
  skipped: "border-border/30 opacity-40",
};
