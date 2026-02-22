import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Wrench, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Play, Save, Calendar
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import type { Json } from "@/integrations/supabase/types";

interface ToolRun {
  id: string;
  tool_id: string;
  tool_call_id: string;
  status: string;
  input: Json;
  output: Json | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ToolApproval {
  id: string;
  tool_run_id: string;
  status: string;
  reason: string | null;
}

interface Props {
  toolRun: ToolRun;
  conversationId: string;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-tool-pending", label: "Awaiting approval" },
  approved: { icon: CheckCircle2, color: "text-tool-approved", label: "Approved" },
  rejected: { icon: XCircle, color: "text-tool-rejected", label: "Rejected" },
  running: { icon: Loader2, color: "text-tool-running", label: "Running" },
  completed: { icon: CheckCircle2, color: "text-tool-completed", label: "Completed" },
  failed: { icon: AlertTriangle, color: "text-tool-failed", label: "Failed" },
  timed_out: { icon: AlertTriangle, color: "text-tool-failed", label: "Timed out" },
};

const errorClassDescriptions: Record<string, string> = {
  element_not_found: "Element not found on page. The agent will inspect the DOM and retry with corrected selectors.",
  login_required: "Login is required. The agent will attempt to log in automatically.",
  captcha_detected: "A CAPTCHA was detected. You may need to solve it manually.",
  page_load_error: "The page failed to load. The agent will retry navigation.",
  timeout: "The action timed out. The agent will wait and retry.",
  navigation_error: "Navigation failed. The agent will try an alternative approach.",
  permission_denied: "Access was denied. The page may require different credentials.",
  session_expired: "The browser session expired. The agent will start a new session.",
};

const stepStatusIcon: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
  failed: <XCircle className="w-3 h-3 text-destructive" />,
  healed: <Wrench className="w-3 h-3 text-amber-500" />,
  running: <Loader2 className="w-3 h-3 text-primary animate-spin" />,
  queued: <Clock className="w-3 h-3 text-muted-foreground" />,
};

export function ToolCard({ toolRun, conversationId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [toolName, setToolName] = useState<string>("");
  const [approval, setApproval] = useState<ToolApproval | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showSaveJob, setShowSaveJob] = useState(false);
  const [jobName, setJobName] = useState("");
  const [jobTime, setJobTime] = useState("09:00");
  const [savingJob, setSavingJob] = useState(false);

  useEffect(() => {
    supabase.from("tools").select("name").eq("id", toolRun.tool_id).single()
      .then(({ data }) => { if (data) setToolName(data.name); });
    supabase.from("tool_approvals").select("*").eq("tool_run_id", toolRun.id).maybeSingle()
      .then(({ data }) => { if (data) setApproval(data); });
  }, [toolRun.id, toolRun.tool_id, toolRun.status]);

  const handleApproval = async (decision: "approved" | "rejected") => {
    if (!user) return;
    setApproving(true);
    try {
      if (approval) {
        await supabase
          .from("tool_approvals")
          .update({ status: decision, approver_id: user.id, resolved_at: new Date().toISOString() })
          .eq("id", approval.id);
      }
      await supabase.from("tool_runs").update({ status: decision === "approved" ? "approved" : "rejected" }).eq("id", toolRun.id);
      if (decision === "approved") {
        await supabase.functions.invoke("execute-tool", {
          body: { tool_run_id: toolRun.id, conversation_id: conversationId },
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  // Parse browser_do step results from output
  const stepResults = useMemo(() => {
    if (toolName !== "browser_do") return null;
    const output = toolRun.output as Record<string, unknown> | null;
    if (!output?.step_results) return null;
    return output.step_results as Array<{
      step: number;
      action: string;
      status: string;
      error?: string;
      selector?: string;
      url?: string;
      value?: string;
    }>;
  }, [toolRun.output, toolName]);

  const inputSteps = useMemo(() => {
    if (toolName !== "browser_do") return null;
    const input = toolRun.input as Record<string, unknown> | null;
    return (input?.steps || []) as Array<Record<string, unknown>>;
  }, [toolRun.input, toolName]);

  const handleSaveAsJob = async () => {
    if (!user || !jobName.trim()) return;
    setSavingJob(true);
    try {
      const input = toolRun.input as Record<string, unknown>;
      const steps = input?.steps || [];
      const url = input?.url || "";

      await supabase.from("jobs").insert({
        user_id: user.id,
        name: jobName.trim(),
        task_type: "browser_flow",
        config: { url, steps },
        steps: steps,
        schedule_type: "daily",
        daily_time: jobTime,
        timezone: "Asia/Kuala_Lumpur",
        is_active: true,
      });

      toast({ title: "Job saved", description: `"${jobName}" scheduled daily at ${jobTime}` });
      setShowSaveJob(false);
      setJobName("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingJob(false);
    }
  };

  const config = statusConfig[toolRun.status] || statusConfig.pending;
  const StatusIcon = config.icon;
  const output = toolRun.output as Record<string, unknown> | null;
  const isBrowserDo = toolName === "browser_do";
  const isCompleted = toolRun.status === "completed";

  return (
    <div className="max-w-3xl mx-auto px-2 py-2">
      <div className="glass rounded-2xl overflow-hidden elevation-1">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Wrench className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-xs font-medium">{toolName || "tool"}</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 rounded-lg", config.color)}>
              <StatusIcon className={cn("w-3 h-3 mr-1", toolRun.status === "running" && "animate-spin")} />
              {config.label}
            </Badge>
            {stepResults && (
              <span className="text-[10px] text-muted-foreground">
                {stepResults.filter(s => s.status === "success").length}/{stepResults.length} steps
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(toolRun.created_at), { addSuffix: true })}
            </span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </button>

        {/* Step Timeline (always visible for browser_do when running or completed) */}
        {isBrowserDo && (stepResults || toolRun.status === "running") && (
          <div className="border-t border-border/50 px-4 py-2.5">
            <div className="space-y-1">
              {(stepResults || []).map((step, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5">
                  <div className="w-5 text-right">
                    <span className="text-[9px] text-muted-foreground font-mono">{i + 1}</span>
                  </div>
                  <div className="shrink-0">{stepStatusIcon[step.status] || stepStatusIcon.queued}</div>
                  <span className="text-[11px] font-mono truncate flex-1">
                    {step.action}
                    {step.selector && <span className="text-muted-foreground ml-1">({step.selector.slice(0, 25)})</span>}
                    {step.url && <span className="text-muted-foreground ml-1">→ {step.url.slice(0, 30)}</span>}
                    {step.value && <span className="text-primary/60 ml-1">"{step.value.slice(0, 20)}"</span>}
                  </span>
                  {step.error && <span className="text-[9px] text-destructive truncate max-w-[120px]">{step.error}</span>}
                </div>
              ))}
              {/* Show queued steps that haven't executed yet */}
              {toolRun.status === "running" && inputSteps && stepResults && inputSteps.length > stepResults.length && (
                inputSteps.slice(stepResults.length).map((step, i) => (
                  <div key={`q-${i}`} className="flex items-center gap-2 py-0.5 opacity-40">
                    <div className="w-5 text-right">
                      <span className="text-[9px] text-muted-foreground font-mono">{(stepResults?.length || 0) + i + 1}</span>
                    </div>
                    <div className="shrink-0">{stepStatusIcon.queued}</div>
                    <span className="text-[11px] font-mono truncate">{step.action as string}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {expanded && (
          <div className="border-t border-border/50 px-4 py-3 space-y-3">
            {/* Inputs */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Input</p>
              <pre className="text-xs font-mono bg-secondary/50 rounded-xl p-2 overflow-x-auto max-h-40">
                {JSON.stringify(toolRun.input, null, 2)}
              </pre>
            </div>

            {/* Output */}
            {output && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Output</p>
                {(output as any).markdown_content ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs bg-secondary/50 rounded-xl p-2">
                    {(output as any).markdown_content}
                  </div>
                ) : (
                  <pre className="text-xs font-mono bg-secondary/50 rounded-xl p-2 overflow-x-auto max-h-40">
                    {JSON.stringify(output, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Error */}
            {toolRun.error && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-destructive mb-1">Error</p>
                <pre className="text-xs font-mono bg-destructive/10 text-destructive rounded-xl p-2">{toolRun.error}</pre>
              </div>
            )}

            {/* Error Classification + Healing */}
            {output && (output as any).error_class && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-amber-500 mb-1">Error Classification</p>
                <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                  {(output as any).error_class}
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {errorClassDescriptions[(output as any).error_class] || "The agent will attempt to resolve this automatically."}
                </p>
              </div>
            )}
            {output && (output as any).has_failures && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-amber-500 mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Steps Failed
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {(output as any).failed_step_count || 0} step(s) failed. The agent will read DOM hints and retry.
                </p>
              </div>
            )}
            {output && (output as any).healing_applied && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-amber-500 mb-1 flex items-center gap-1">
                  <Wrench className="w-3 h-3" /> Self-Healing Applied
                </p>
                <div className="text-xs bg-amber-500/5 rounded-xl p-2 border border-amber-500/10">
                  {((output as any).healing_log || []).map((entry: Record<string, unknown>, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="text-muted-foreground">Strategy: {(entry.strategy as string) || "diagnosis"}</span>
                      {entry.new_selector && (
                        <code className="text-amber-600">{entry.original_selector as string} → {entry.new_selector as string}</code>
                      )}
                      <Badge variant="outline" className={cn("text-[10px]", entry.healed ? "text-emerald-500 border-emerald-500/30" : "text-red-400 border-red-400/30")}>
                        {entry.healed ? "Healed" : "Failed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              {toolRun.started_at && <span>Started: {new Date(toolRun.started_at).toLocaleTimeString()}</span>}
              {toolRun.completed_at && <span>Completed: {new Date(toolRun.completed_at).toLocaleTimeString()}</span>}
            </div>
          </div>
        )}

        {/* Approval bar */}
        {toolRun.status === "pending" && approval?.status === "pending" && (
          <div className="border-t border-border/50 px-4 py-3 flex items-center justify-between glass-subtle">
            <span className="text-xs text-tool-pending font-medium">This tool requires your approval</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleApproval("rejected")} disabled={approving}
                className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 rounded-xl">
                Reject
              </Button>
              <Button size="sm" onClick={() => handleApproval("approved")} disabled={approving} className="h-8 text-xs rounded-xl">
                {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
              </Button>
            </div>
          </div>
        )}

        {/* Save as Job bar (for completed browser_do) */}
        {isBrowserDo && isCompleted && !showSaveJob && (
          <div className="border-t border-border/50 px-4 py-2 flex items-center justify-between glass-subtle">
            <span className="text-[11px] text-muted-foreground">Save this as a reusable job?</span>
            <Button size="sm" variant="outline" onClick={() => setShowSaveJob(true)} className="h-7 text-xs gap-1 rounded-xl">
              <Save className="w-3 h-3" /> Save as Job
            </Button>
          </div>
        )}

        {/* Save Job form */}
        {showSaveJob && (
          <div className="border-t border-border/50 px-4 py-3 space-y-2 glass-subtle">
            <p className="text-xs font-medium">Save as Scheduled Job</p>
            <Input
              placeholder="Job name (e.g. 'Check Ready Sales')"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className="h-8 text-xs rounded-xl"
            />
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Daily at</span>
              <Input
                type="time"
                value={jobTime}
                onChange={(e) => setJobTime(e.target.value)}
                className="h-7 w-28 text-xs rounded-lg"
              />
              <span className="text-[11px] text-muted-foreground">Asia/KL</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowSaveJob(false)} className="h-7 text-xs rounded-xl">
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveAsJob} disabled={savingJob || !jobName.trim()} className="h-7 text-xs gap-1 rounded-xl">
                {savingJob ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Save Job
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
