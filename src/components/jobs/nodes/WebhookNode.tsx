import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "./types";
import { NODE_TYPE_CONFIG, STATUS_STYLES } from "./types";

function WebhookNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const config = NODE_TYPE_CONFIG.webhook_call;
  const statusStyle = STATUS_STYLES[d._status || "pending"] || "";

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 min-w-[180px] backdrop-blur-md",
      config.bgColor, config.borderColor, statusStyle,
      selected && "ring-2 ring-primary/40",
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-background" />

      <div className="flex items-center gap-2 mb-1">
        <Webhook className={cn("w-3.5 h-3.5", config.color)} />
        <span className="text-xs font-medium truncate">{d.label || "Webhook"}</span>
      </div>

      {d.webhook_url && (
        <p className="text-[10px] text-muted-foreground truncate">{d.webhook_method || "POST"} {d.webhook_url}</p>
      )}

      {d._status === "failed" && d._error && (
        <p className="text-[10px] text-red-400 truncate mt-1">{d._error}</p>
      )}

      <Handle type="source" position={Position.Bottom} id="success" className="!w-2.5 !h-2.5 !bg-emerald-500 !border-background !left-[35%]" />
      <Handle type="source" position={Position.Bottom} id="failure" className="!w-2.5 !h-2.5 !bg-red-500 !border-background !left-[65%]" />
    </div>
  );
}

export default memo(WebhookNode);
