import { Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, Wrench, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Action {
  id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  status: string;
  error: string | null;
  error_class?: string | null;
  healing_attempts?: number;
  healing_log?: Array<Record<string, unknown>>;
  original_parameters?: Record<string, unknown> | null;
  created_at: string;
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3 h-3 text-muted-foreground" />,
  awaiting_approval: <AlertTriangle className="w-3 h-3 text-yellow-500" />,
  executing: <Loader2 className="w-3 h-3 text-primary animate-spin" />,
  completed: <CheckCircle2 className="w-3 h-3 text-green-500" />,
  failed: <XCircle className="w-3 h-3 text-destructive" />,
  rejected: <XCircle className="w-3 h-3 text-muted-foreground" />,
};

const errorClassLabels: Record<string, string> = {
  element_not_found: "Element Not Found",
  navigation_timeout: "Timeout",
  login_required: "Login Required",
  session_expired: "Session Expired",
  captcha_detected: "CAPTCHA",
  modal_blocking: "Modal Blocking",
  page_error: "Page Error",
};

export function ActionTimeline({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground text-xs">No actions yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Actions
      </h3>
      {actions.map((action) => (
        <div
          key={action.id}
          className="flex items-start gap-2 py-2 px-2 rounded-xl hover:bg-muted/30 transition-colors"
        >
          <div className="mt-0.5">{statusIcons[action.status] || statusIcons.pending}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs font-mono truncate">
                {action.action_type}
                {action.parameters?.selector && (
                  <span className="text-muted-foreground ml-1">
                    → {String(action.parameters.selector).slice(0, 30)}
                  </span>
                )}
              </p>
              {/* Healing indicator */}
              {(action.healing_attempts || 0) > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-amber-500 border-amber-500/30 px-1 py-0 h-4"
                >
                  <Wrench className="w-2.5 h-2.5 mr-0.5" />
                  Healed
                </Badge>
              )}
              {/* Error class badge */}
              {action.error_class && action.status === "failed" && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-destructive border-destructive/30 px-1 py-0 h-4"
                >
                  {errorClassLabels[action.error_class] || action.error_class}
                </Badge>
              )}
            </div>
            {action.error && (
              <p className="text-xs text-destructive truncate">{action.error}</p>
            )}
            {/* Healing details when healed */}
            {(action.healing_attempts || 0) > 0 && action.healing_log && action.healing_log.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {action.healing_log.map((entry, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-amber-500/80">
                    <Shield className="w-2.5 h-2.5" />
                    <span>{(entry.strategy as string) || "diagnosis"}</span>
                    {entry.new_selector && (
                      <code className="text-amber-600/60 ml-1">→ {String(entry.new_selector).slice(0, 30)}</code>
                    )}
                    {entry.healed && <span className="text-emerald-500">ok</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {new Date(action.created_at).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
