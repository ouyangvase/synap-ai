import { useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Ban, Loader, Play,
} from "lucide-react";

import BrowserActionNode from "./nodes/BrowserActionNode";
import WebhookNode from "./nodes/WebhookNode";
import DataTransformNode from "./nodes/DataTransformNode";
import ApprovalGateNode from "./nodes/ApprovalGateNode";
import ConditionalBranchNode from "./nodes/ConditionalBranchNode";
import DelayNode from "./nodes/DelayNode";
import type { WorkflowNodeData } from "./nodes/types";

const nodeTypes: NodeTypes = {
  browser_action: BrowserActionNode,
  webhook_call: WebhookNode,
  data_transform: DataTransformNode,
  approval_gate: ApprovalGateNode,
  conditional_branch: ConditionalBranchNode,
  delay: DelayNode,
};

interface NodeResultData {
  node_id: string;
  type: string;
  label: string;
  status: string;
  result?: unknown;
  error?: string;
  error_class?: string;
  duration_ms?: number;
}

interface WorkflowExecutionViewProps {
  workflowNodes: Node[];
  workflowEdges: Edge[];
  executionState: Record<string, unknown> | null;
  onResume?: () => void;
  onCancel?: () => void;
  onRerunNode?: (nodeId: string) => void;
  resuming?: boolean;
}

function WorkflowExecutionViewInner({
  workflowNodes,
  workflowEdges,
  executionState,
  onResume,
  onCancel,
  onRerunNode,
  resuming,
}: WorkflowExecutionViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodeResults = (executionState?.node_results as Record<string, NodeResultData>) || {};
  const completedNodes = (executionState?.completed_nodes as string[]) || [];
  const failedNodes = (executionState?.failed_nodes as string[]) || [];
  const currentNodeId = executionState?.current_node_id as string | null;
  const status = executionState?.status as string || "pending";

  // Overlay execution status onto nodes
  const nodesWithStatus: Node[] = useMemo(() => {
    return workflowNodes.map((node) => {
      const nr = nodeResults[node.id];
      let _status: WorkflowNodeData["_status"] = "pending";

      if (nr) {
        _status = nr.status as WorkflowNodeData["_status"];
      } else if (currentNodeId === node.id && status === "running") {
        _status = "running";
      } else if (completedNodes.includes(node.id)) {
        _status = "completed";
      } else if (failedNodes.includes(node.id)) {
        _status = "failed";
      }

      return {
        ...node,
        data: {
          ...node.data,
          _status,
          _error: nr?.error,
          _error_class: nr?.error_class,
          _duration_ms: nr?.duration_ms,
        },
      };
    });
  }, [workflowNodes, nodeResults, completedNodes, failedNodes, currentNodeId, status]);

  // Edges with color based on status
  const edgesWithStatus: Edge[] = useMemo(() => {
    return workflowEdges.map((edge) => {
      const sourceComplete = completedNodes.includes(edge.source);
      const sourceFailed = failedNodes.includes(edge.source);

      return {
        ...edge,
        animated: currentNodeId === edge.source,
        style: {
          stroke: sourceComplete
            ? "hsl(142 76% 36%)" // emerald
            : sourceFailed
            ? "hsl(0 84% 60%)"   // red
            : "hsl(var(--muted-foreground))",
          strokeWidth: sourceComplete || sourceFailed ? 2 : 1.5,
        },
      };
    });
  }, [workflowEdges, completedNodes, failedNodes, currentNodeId]);

  const totalNodes = workflowNodes.length;
  const completedCount = completedNodes.length;
  const progressPercent = totalNodes > 0 ? (completedCount / totalNodes) * 100 : 0;

  const selectedNr = selectedNodeId ? nodeResults[selectedNodeId] : null;

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const isResumable = ["paused", "failed", "waiting_for_login", "waiting_for_approval", "waiting_for_delay"].includes(status);
  const isCancellable = ["running", "retrying", "queued"].includes(status);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header: status + progress */}
      <div className="flex items-center gap-3 flex-wrap px-1">
        <Badge
          variant={status === "success" ? "default" : status === "failed" ? "destructive" : "secondary"}
          className="text-xs"
        >
          {status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {completedCount} / {totalNodes} nodes
        </span>
        {executionState?.execution_phase && (
          <span className="text-xs text-muted-foreground">
            Phase: <span className="font-medium">{executionState.execution_phase as string}</span>
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden mx-1">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-1">
        {isResumable && onResume && (
          <Button size="sm" className="gap-1.5 rounded-xl" onClick={onResume} disabled={resuming}>
            {resuming ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Resume
          </Button>
        )}
        {isCancellable && onCancel && (
          <Button size="sm" variant="destructive" className="gap-1.5 rounded-xl" onClick={onCancel}>
            <Ban className="w-3.5 h-3.5" /> Cancel
          </Button>
        )}
      </div>

      {/* DAG canvas */}
      <div className="flex-1 flex gap-2 min-h-[300px]">
        <div className="flex-1 rounded-xl overflow-hidden border border-border/30">
          <ReactFlow
            nodes={nodesWithStatus}
            edges={edgesWithStatus}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            defaultEdgeOptions={{ animated: false }}
          >
            <Background color="hsl(var(--muted-foreground))" gap={20} size={1} style={{ opacity: 0.1 }} />
            <Controls className="!bg-background/80 !border-border/50 !rounded-lg" showInteractive={false} />
            <MiniMap className="!bg-background/80 !border-border/50 !rounded-lg" nodeStrokeWidth={3} />
          </ReactFlow>
        </div>

        {/* Node detail panel */}
        {selectedNr && (
          <div className="w-56 shrink-0 border-l border-border/50 p-3 space-y-2 overflow-y-auto">
            <p className="text-xs font-medium">{selectedNr.label}</p>
            <Badge
              variant={selectedNr.status === "completed" ? "default" : selectedNr.status === "failed" ? "destructive" : "secondary"}
              className="text-[10px]"
            >
              {selectedNr.status}
            </Badge>

            {selectedNr.duration_ms !== undefined && (
              <p className="text-[10px] text-muted-foreground">
                Duration: {selectedNr.duration_ms < 1000 ? `${selectedNr.duration_ms}ms` : `${(selectedNr.duration_ms / 1000).toFixed(1)}s`}
              </p>
            )}

            {selectedNr.error && (
              <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
                {selectedNr.error_class && (
                  <Badge variant="destructive" className="text-[10px] mb-1">{selectedNr.error_class}</Badge>
                )}
                <pre className="text-[10px] text-destructive/80 whitespace-pre-wrap break-words">
                  {selectedNr.error}
                </pre>
              </div>
            )}

            {selectedNr.result && (
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-auto">
                  {typeof selectedNr.result === "string"
                    ? selectedNr.result
                    : JSON.stringify(selectedNr.result, null, 2)}
                </pre>
              </div>
            )}

            {selectedNr.status === "failed" && onRerunNode && (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 rounded-lg text-xs"
                onClick={() => onRerunNode(selectedNodeId!)}
              >
                <Play className="w-3 h-3" /> Re-run Node
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkflowExecutionView(props: WorkflowExecutionViewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowExecutionViewInner {...props} />
    </ReactFlowProvider>
  );
}
