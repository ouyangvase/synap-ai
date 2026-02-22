import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "./types";
import { NODE_TYPE_CONFIG, STATUS_STYLES } from "./types";

function DelayNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const config = NODE_TYPE_CONFIG.delay;
  const statusStyle = STATUS_STYLES[d._status || "pending"] || "";

  const seconds = d.delay_seconds || 0;
  const displayDuration = seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 min-w-[140px] backdrop-blur-md",
      config.bgColor, config.borderColor, statusStyle,
      selected && "ring-2 ring-primary/40",
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-background" />

      <div className="flex items-center gap-2 mb-1">
        <Clock className={cn("w-3.5 h-3.5", config.color)} />
        <span className="text-xs font-medium truncate">{d.label || "Delay"}</span>
      </div>

      <p className="text-[10px] text-muted-foreground">Wait {displayDuration}</p>

      {d._status === "waiting" && (
        <p className="text-[10px] text-amber-400 mt-1 animate-pulse">Waiting...</p>
      )}

      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-slate-400 !border-background" />
    </div>
  );
}

export default memo(DelayNode);
