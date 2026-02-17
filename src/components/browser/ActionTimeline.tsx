import { Clock, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";

interface Action {
  id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  status: string;
  error: string | null;
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
          className="flex items-start gap-2 py-2 px-2 rounded hover:bg-muted/30 transition-colors"
        >
          <div className="mt-0.5">{statusIcons[action.status] || statusIcons.pending}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono truncate">
              {action.action_type}
              {action.parameters?.selector && (
                <span className="text-muted-foreground ml-1">
                  → {String(action.parameters.selector).slice(0, 30)}
                </span>
              )}
            </p>
            {action.error && (
              <p className="text-xs text-destructive truncate">{action.error}</p>
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
