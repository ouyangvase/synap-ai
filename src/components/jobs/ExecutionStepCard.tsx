import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  Loader,
  ChevronDown,
  ChevronRight,
  Wrench,
  Clock,
} from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface StepResult {
  step?: number;
  node_id?: string;
  label?: string;
  type?: string;
  phase: string;
  action: string;
  status: "completed" | "failed" | "skipped" | "waiting";
  result?: unknown;
  error?: string;
  error_class?: string;
  healing_attempts?: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

interface ExecutionStepCardProps {
  step: StepResult;
  isActive?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  completed: {
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  failed: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  waiting: {
    icon: <Loader className="w-3.5 h-3.5 animate-spin" />,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  skipped: {
    icon: <Clock className="w-3.5 h-3.5" />,
    color: "text-muted-foreground",
    bg: "bg-secondary/50 border-border",
  },
};

const errorClassLabels: Record<string, string> = {
  element_not_found: "Element Not Found",
  navigation_timeout: "Timeout",
  login_required: "Login Required",
  session_expired: "Session Expired",
  captcha_detected: "CAPTCHA",
  modal_blocking: "Modal Blocking",
  page_error: "Page Error",
  unknown: "Unknown",
};

export default function ExecutionStepCard({ step, isActive }: ExecutionStepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[step.status] || statusConfig.skipped;

  return (
    <div
      className={`border rounded-xl transition-colors ${config.bg} ${
        isActive ? "ring-1 ring-primary/40" : ""
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {/* Step/Node identifier */}
        <span className="text-xs text-muted-foreground font-mono w-auto shrink-0">
          {step.node_id || step.label || (step.step !== undefined ? step.step + 1 : "?")}
        </span>

        {/* Status icon */}
        <span className={config.color}>{config.icon}</span>

        {/* Phase + action */}
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium truncate block">{step.phase}</span>
          <span className="text-[10px] text-muted-foreground truncate block">
            {step.action}
          </span>
        </div>

        {/* Healing indicator */}
        {(step.healing_attempts || 0) > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] text-amber-500 border-amber-500/30 px-1.5 py-0"
          >
            <Wrench className="w-2.5 h-2.5 mr-0.5" />
            {step.healing_attempts}
          </Badge>
        )}

        {/* Error class */}
        {step.error_class && step.status === "failed" && (
          <Badge
            variant="destructive"
            className="text-[10px] px-1.5 py-0"
          >
            {errorClassLabels[step.error_class] || step.error_class}
          </Badge>
        )}

        {/* Duration */}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatDuration(step.duration_ms)}
        </span>

        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50">
          {/* Time info */}
          <div className="flex gap-4 pt-2 text-[10px] text-muted-foreground">
            <span>Started: {new Date(step.started_at).toLocaleTimeString()}</span>
            <span>Ended: {new Date(step.completed_at).toLocaleTimeString()}</span>
          </div>

          {/* Error */}
          {step.error && (
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <pre className="text-[10px] text-destructive/80 whitespace-pre-wrap break-words">
                {step.error}
              </pre>
            </div>
          )}

          {/* Result */}
          {step.result && (
            <div className="p-2 rounded-lg bg-secondary/50 border border-border">
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {typeof step.result === "string"
                  ? step.result
                  : JSON.stringify(step.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
