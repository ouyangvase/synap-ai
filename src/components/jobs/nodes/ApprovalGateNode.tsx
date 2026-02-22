import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "./types";
import { NODE_TYPE_CONFIG, STATUS_STYLES } from "./types";

function ApprovalGateNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const config = NODE_TYPE_CONFIG.approval_gate;
  const statusStyle = STATUS_STYLES[d._status || "pending"] || "";

  return (
    <div className={cn(
      "rounded-xl border-2 border-dashed px-3 py-2 min-w-[180px] backdrop-blur-md",
      config.bgColor, config.borderColor, statusStyle,
      selected && "ring-2 ring-primary/40",
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-background" />

      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className={cn("w-3.5 h-3.5", config.color)} />
        <span className="text-xs font-medium truncate">{d.label || "Approval Gate"}</span>
      </div>

      <p className="text-[10px] text-amber-400/70">Requires human approval</p>

      {d._status === "waiting" && (
        <p className="text-[10px] text-amber-400 mt-1 animate-pulse">Waiting for approval...</p>
      )}

      <Handle type="source" position={Position.Bottom} id="approved" className="!w-2.5 !h-2.5 !bg-emerald-500 !border-background !left-[35%]" />
      <Handle type="source" position={Position.Bottom} id="rejected" className="!w-2.5 !h-2.5 !bg-red-500 !border-background !left-[65%]" />
    </div>
  );
}

export default memo(ApprovalGateNode);
