import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Code } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "./types";
import { NODE_TYPE_CONFIG, STATUS_STYLES } from "./types";

function DataTransformNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const config = NODE_TYPE_CONFIG.data_transform;
  const statusStyle = STATUS_STYLES[d._status || "pending"] || "";

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 min-w-[180px] backdrop-blur-md",
      config.bgColor, config.borderColor, statusStyle,
      selected && "ring-2 ring-primary/40",
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-background" />

      <div className="flex items-center gap-2 mb-1">
        <Code className={cn("w-3.5 h-3.5", config.color)} />
        <span className="text-xs font-medium truncate">{d.label || "Transform"}</span>
      </div>

      {d.transform_expression && (
        <code className="text-[10px] text-muted-foreground block truncate bg-secondary/50 rounded px-1 py-0.5">
          {d.transform_expression}
        </code>
      )}

      {d._status === "failed" && d._error && (
        <p className="text-[10px] text-red-400 truncate mt-1">{d._error}</p>
      )}

      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-cyan-500 !border-background" />
    </div>
  );
}

export default memo(DataTransformNode);
