import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "./types";
import { NODE_TYPE_CONFIG, STATUS_STYLES } from "./types";

function ConditionalBranchNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const config = NODE_TYPE_CONFIG.conditional_branch;
  const statusStyle = STATUS_STYLES[d._status || "pending"] || "";

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 min-w-[180px] backdrop-blur-md",
      config.bgColor, config.borderColor, statusStyle,
      selected && "ring-2 ring-primary/40",
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-background" />

      <div className="flex items-center gap-2 mb-1">
        <GitBranch className={cn("w-3.5 h-3.5", config.color)} />
        <span className="text-xs font-medium truncate">{d.label || "Condition"}</span>
      </div>

      {d.condition && (
        <code className="text-[10px] text-muted-foreground block truncate bg-secondary/50 rounded px-1 py-0.5">
          {d.condition}
        </code>
      )}

      <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/60 px-2">
        <span className="text-emerald-400">True</span>
        <span className="text-red-400">False</span>
      </div>

      <Handle type="source" position={Position.Bottom} id="true" className="!w-2.5 !h-2.5 !bg-emerald-500 !border-background !left-[35%]" />
      <Handle type="source" position={Position.Bottom} id="false" className="!w-2.5 !h-2.5 !bg-red-500 !border-background !left-[65%]" />
    </div>
  );
}

export default memo(ConditionalBranchNode);
