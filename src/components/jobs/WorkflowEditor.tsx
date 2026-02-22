import { useState, useCallback, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Save, Plus, Trash2, Globe, Webhook, Code,
  ShieldCheck, GitBranch, Clock, X, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import BrowserActionNode from "./nodes/BrowserActionNode";
import WebhookNode from "./nodes/WebhookNode";
import DataTransformNode from "./nodes/DataTransformNode";
import ApprovalGateNode from "./nodes/ApprovalGateNode";
import ConditionalBranchNode from "./nodes/ConditionalBranchNode";
import DelayNode from "./nodes/DelayNode";
import { NODE_TYPE_CONFIG, type WorkflowNodeType, type WorkflowNodeData } from "./nodes/types";

const nodeTypes: NodeTypes = {
  browser_action: BrowserActionNode,
  webhook_call: WebhookNode,
  data_transform: DataTransformNode,
  approval_gate: ApprovalGateNode,
  conditional_branch: ConditionalBranchNode,
  delay: DelayNode,
};

const NODE_PALETTE: { type: WorkflowNodeType; icon: React.ReactNode }[] = [
  { type: "browser_action", icon: <Globe className="w-3.5 h-3.5" /> },
  { type: "webhook_call", icon: <Webhook className="w-3.5 h-3.5" /> },
  { type: "data_transform", icon: <Code className="w-3.5 h-3.5" /> },
  { type: "approval_gate", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  { type: "conditional_branch", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { type: "delay", icon: <Clock className="w-3.5 h-3.5" /> },
];

interface WorkflowEditorProps {
  initialNodes: Node[];
  initialEdges: Edge[];
  onSave: (nodes: Node[], edges: Edge[]) => Promise<void>;
}

function WorkflowEditorInner({ initialNodes, initialEdges, onSave }: WorkflowEditorProps) {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const nodeIdCounter = useRef(
    Math.max(0, ...initialNodes.map((n) => {
      const match = n.id.match(/node-(\d+)/);
      return match ? parseInt(match[1]) : 0;
    })) + 1
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: `e-${connection.source}-${connection.target}-${Date.now()}` }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const addNode = useCallback((type: WorkflowNodeType) => {
    const id = `node-${nodeIdCounter.current++}`;
    const config = NODE_TYPE_CONFIG[type];
    const newNode: Node = {
      id,
      type,
      position: { x: 250, y: nodes.length * 120 },
      data: { label: config.label } as WorkflowNodeData,
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodes.length, setNodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const updateNodeData = useCallback((field: string, value: unknown) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, [field]: value } }
          : n
      )
    );
    setSelectedNode((prev) =>
      prev ? { ...prev, data: { ...prev.data, [field]: value } } : null
    );
  }, [selectedNode, setNodes]);

  // Validate DAG (cycle detection via Kahn's algorithm)
  const validateDAG = useCallback((): boolean => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of nodeIds) { inDegree.set(id, 0); adj.set(id, []); }
    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
      adj.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const nb of adj.get(node) || []) {
        const nd = (inDegree.get(nb) || 1) - 1;
        inDegree.set(nb, nd);
        if (nd === 0) queue.push(nb);
      }
    }
    return visited === nodeIds.size;
  }, [nodes, edges]);

  const handleSave = useCallback(async () => {
    if (!validateDAG()) {
      toast({ title: "Invalid Workflow", description: "Cycle detected in the graph. Remove circular dependencies.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await onSave(nodes, edges);
      toast({ title: "Workflow saved" });
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, onSave, toast, validateDAG]);

  const selectedNodeData = selectedNode?.data as WorkflowNodeData | undefined;

  return (
    <div className="flex h-full gap-2">
      {/* Node palette sidebar */}
      <div className="w-48 shrink-0 space-y-2 p-2 border-r border-border/50">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Add Nodes</p>
        {NODE_PALETTE.map(({ type, icon }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 text-xs rounded-lg h-8"
            onClick={() => addNode(type)}
          >
            {icon}
            {NODE_TYPE_CONFIG[type].label}
          </Button>
        ))}
        <div className="border-t border-border/50 pt-2 mt-3">
          <Button size="sm" className="w-full gap-1.5 rounded-lg" onClick={handleSave} disabled={saving}>
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save Workflow"}
          </Button>
        </div>
        {nodes.length > 0 && !validateDAG() && (
          <div className="flex items-center gap-1 text-[10px] text-destructive">
            <AlertTriangle className="w-3 h-3" /> Cycle detected
          </div>
        )}
      </div>

      {/* React Flow canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          className="rounded-xl"
          defaultEdgeOptions={{ animated: true, style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5 } }}
        >
          <Background color="hsl(var(--muted-foreground))" gap={20} size={1} style={{ opacity: 0.15 }} />
          <Controls className="!bg-background/80 !border-border/50 !rounded-lg" />
          <MiniMap className="!bg-background/80 !border-border/50 !rounded-lg" nodeStrokeWidth={3} />
        </ReactFlow>
      </div>

      {/* Node config panel */}
      {selectedNode && selectedNodeData && (
        <div className="w-64 shrink-0 border-l border-border/50 p-3 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px]">
              {NODE_TYPE_CONFIG[selectedNode.type as WorkflowNodeType]?.label || selectedNode.type}
            </Badge>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={deleteSelectedNode}>
                <Trash2 className="w-3 h-3 text-destructive" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedNode(null)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-[10px]">Label</Label>
              <Input
                value={selectedNodeData.label || ""}
                onChange={(e) => updateNodeData("label", e.target.value)}
                className="h-7 text-xs rounded-lg"
              />
            </div>

            {selectedNode.type === "browser_action" && (
              <>
                <div>
                  <Label className="text-[10px]">Action</Label>
                  <Input
                    value={selectedNodeData.action || ""}
                    onChange={(e) => updateNodeData("action", e.target.value)}
                    className="h-7 text-xs rounded-lg"
                    placeholder="navigate, click, type..."
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Phase</Label>
                  <Input
                    value={selectedNodeData.phase || ""}
                    onChange={(e) => updateNodeData("phase", e.target.value)}
                    className="h-7 text-xs rounded-lg"
                    placeholder="login, extraction..."
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Parameters (JSON)</Label>
                  <Textarea
                    value={selectedNodeData.parameters ? JSON.stringify(selectedNodeData.parameters, null, 2) : ""}
                    onChange={(e) => {
                      try { updateNodeData("parameters", JSON.parse(e.target.value)); } catch {}
                    }}
                    className="text-[10px] font-mono rounded-lg min-h-[60px]"
                    placeholder='{"url": "..."}'
                  />
                </div>
              </>
            )}

            {selectedNode.type === "webhook_call" && (
              <>
                <div>
                  <Label className="text-[10px]">Webhook URL</Label>
                  <Input
                    value={selectedNodeData.webhook_url || ""}
                    onChange={(e) => updateNodeData("webhook_url", e.target.value)}
                    className="h-7 text-xs rounded-lg"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Method</Label>
                  <Select value={selectedNodeData.webhook_method || "POST"} onValueChange={(v) => updateNodeData("webhook_method", v)}>
                    <SelectTrigger className="h-7 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {selectedNode.type === "data_transform" && (
              <div>
                <Label className="text-[10px]">Expression</Label>
                <Textarea
                  value={selectedNodeData.transform_expression || ""}
                  onChange={(e) => updateNodeData("transform_expression", e.target.value)}
                  className="text-[10px] font-mono rounded-lg min-h-[60px]"
                  placeholder="results['node-1'].value * 2"
                />
              </div>
            )}

            {selectedNode.type === "conditional_branch" && (
              <div>
                <Label className="text-[10px]">Condition</Label>
                <Textarea
                  value={selectedNodeData.condition || ""}
                  onChange={(e) => updateNodeData("condition", e.target.value)}
                  className="text-[10px] font-mono rounded-lg min-h-[60px]"
                  placeholder="results['node-1'].value > 100"
                />
              </div>
            )}

            {selectedNode.type === "delay" && (
              <div>
                <Label className="text-[10px]">Delay (seconds)</Label>
                <Input
                  type="number"
                  value={selectedNodeData.delay_seconds || 0}
                  onChange={(e) => updateNodeData("delay_seconds", parseInt(e.target.value) || 0)}
                  className="h-7 text-xs rounded-lg"
                />
              </div>
            )}

            <div>
              <Label className="text-[10px]">Max Retries</Label>
              <Input
                type="number"
                value={selectedNodeData.max_retries ?? ""}
                onChange={(e) => updateNodeData("max_retries", parseInt(e.target.value) || undefined)}
                className="h-7 text-xs rounded-lg"
                placeholder="Default: 3"
              />
            </div>
          </div>

          <p className="text-[9px] text-muted-foreground/50 mt-2">
            ID: {selectedNode.id}
          </p>
        </div>
      )}
    </div>
  );
}

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
