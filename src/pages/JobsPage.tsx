import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  ArrowLeft,
  Play,
  Plus,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Loader,
  Trash2,
  Save,
  SkipForward,
  Settings,
  History,
  Webhook,
  Globe,
  Wrench,
  RefreshCw,
  Ban,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ExecutionStepCard from "@/components/jobs/ExecutionStepCard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  name: string;
  description: string | null;
  schedule: string | null;
  is_active: boolean;
  last_run_at: string | null;
  workflow_name: string | null;
  workflow_payload: Record<string, unknown> | null;
  task_type: string;
  task_config: Record<string, unknown>;
  schedule_type: string;
  daily_time: string;
  timezone: string;
  cron_expr: string | null;
  created_at: string;
  updated_at: string | null;
  user_id: string | null;
}

interface JobRun {
  id: string;
  job_id: string;
  run_date: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: unknown;
  error: string | null;
  input: unknown;
  duration_ms: number | null;
  artifacts: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleString();
}

function formatDuration(ms: number | null, startedAt: string | null, completedAt: string | null): string {
  if (ms) return `${(ms / 1000).toFixed(1)}s`;
  if (startedAt && completedAt) {
    return `${((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000).toFixed(1)}s`;
  }
  return "-";
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "success": case "completed": return "default";
    case "running": case "retrying": return "secondary";
    case "failed": case "cancelled": return "destructive";
    case "waiting_for_login": case "waiting_for_approval": case "paused": return "outline";
    default: return "outline";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success": case "completed": return <CheckCircle className="w-3.5 h-3.5" />;
    case "running": case "retrying": return <Loader className="w-3.5 h-3.5 animate-spin" />;
    case "failed": case "cancelled": return <XCircle className="w-3.5 h-3.5" />;
    case "skipped": return <SkipForward className="w-3.5 h-3.5" />;
    case "waiting_for_login": case "waiting_for_approval": return <Clock className="w-3.5 h-3.5 animate-pulse" />;
    case "paused": return <Ban className="w-3.5 h-3.5" />;
    default: return <Clock className="w-3.5 h-3.5" />;
  }
}

function TaskTypeIcon({ type }: { type: string }) {
  if (type === "browser_flow") return <Globe className="w-3.5 h-3.5" />;
  return <Webhook className="w-3.5 h-3.5" />;
}

const TIMEZONES = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Pacific/Auckland",
  "Australia/Sydney",
  "UTC",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JobsPage() {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runningJob, setRunningJob] = useState<string | null>(null); // job id being run
  const [savingJob, setSavingJob] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("settings");

  // Execution state for browser_flow jobs
  const [executionState, setExecutionState] = useState<Record<string, unknown> | null>(null);
  const [resumingJob, setResumingJob] = useState(false);

  // Editable fields for selected job
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editScheduleType, setEditScheduleType] = useState("daily");
  const [editDailyTime, setEditDailyTime] = useState("08:00");
  const [editTimezone, setEditTimezone] = useState("Asia/Kuala_Lumpur");
  const [editCronExpr, setEditCronExpr] = useState("");
  const [editTaskType, setEditTaskType] = useState("n8n_webhook");
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [editWebhookMethod, setEditWebhookMethod] = useState("POST");
  const [editWebhookPayload, setEditWebhookPayload] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // Create dialog fields
  const [newName, setNewName] = useState("");
  const [newTaskType, setNewTaskType] = useState("n8n_webhook");

  // ---------- Fetch all jobs ----------
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    const { data, error } = await (supabase as any)
      .from("jobs")
      .select("*")
      .order("name", { ascending: true });

    if (!error && data) {
      setJobs(data as Job[]);
    }
    setLoadingJobs(false);
  }, []);

  // ---------- Fetch runs for a specific job ----------
  const fetchJobRuns = useCallback(async (jobId: string) => {
    setLoadingRuns(true);
    const { data, error } = await (supabase as any)
      .from("job_runs")
      .select("*")
      .eq("job_id", jobId)
      .order("run_date", { ascending: false })
      .limit(50);

    if (!error && data) {
      setJobRuns(data as JobRun[]);
    }
    setLoadingRuns(false);
  }, []);

  // ---------- Initial load ----------
  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ---------- Fetch runs when a job is selected ----------
  useEffect(() => {
    if (selectedJob) {
      fetchJobRuns(selectedJob.id);
    } else {
      setJobRuns([]);
      setExecutionState(null);
    }
  }, [selectedJob, fetchJobRuns]);

  // ---------- Fetch execution state for latest run ----------
  useEffect(() => {
    if (jobRuns.length === 0) {
      setExecutionState(null);
      return;
    }
    const latestRun = jobRuns[0];
    (supabase as any)
      .from("execution_state")
      .select("*")
      .eq("job_run_id", latestRun.id)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        setExecutionState(data);
      });
  }, [jobRuns]);

  // ---------- Real-time subscription for execution_state ----------
  useEffect(() => {
    if (!selectedJob) return;

    const channel = supabase
      .channel(`exec-state-${selectedJob.id}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "execution_state" },
        (payload: { new: Record<string, unknown> }) => {
          const newState = payload.new;
          // Check if this execution_state belongs to one of our job_runs
          if (newState && jobRuns.some((r) => r.id === newState.job_run_id)) {
            setExecutionState(newState);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedJob, jobRuns]);

  // ---------- Resume a paused/failed execution ----------
  const handleResumeExecution = async (jobRunId: string) => {
    if (!session) return;
    setResumingJob(true);
    try {
      const RESUME_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jobs-resume`;
      const resp = await fetch(RESUME_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ job_run_id: jobRunId }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Resume failed");
      toast({ title: "Job resumed", description: `Resuming from step ${(executionState?.current_step as number || 0) + 1}` });
      if (selectedJob) fetchJobRuns(selectedJob.id);
    } catch (err: any) {
      toast({ title: "Resume failed", description: err.message, variant: "destructive" });
    } finally {
      setResumingJob(false);
    }
  };

  // ---------- Cancel execution ----------
  const handleCancelExecution = async (executionStateId: string) => {
    await (supabase as any).from("execution_state").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", executionStateId);
    toast({ title: "Execution cancelled" });
    if (selectedJob) fetchJobRuns(selectedJob.id);
  };

  // ---------- Populate edit fields when a job is selected ----------
  useEffect(() => {
    if (!selectedJob) return;
    setEditName(selectedJob.name || "");
    setEditDescription(selectedJob.description || "");
    setEditScheduleType(selectedJob.schedule_type || "daily");
    setEditDailyTime(selectedJob.daily_time || "08:00");
    setEditTimezone(selectedJob.timezone || "Asia/Kuala_Lumpur");
    setEditCronExpr(selectedJob.cron_expr || "");
    setEditTaskType(selectedJob.task_type || "n8n_webhook");
    setEditIsActive(selectedJob.is_active);

    const cfg = selectedJob.task_config || {};
    setEditWebhookUrl((cfg.webhook_url as string) || "");
    setEditWebhookMethod((cfg.method as string) || "POST");
    try {
      setEditWebhookPayload(
        cfg.payload ? JSON.stringify(cfg.payload, null, 2) : ""
      );
    } catch {
      setEditWebhookPayload("");
    }
  }, [selectedJob]);

  // ---------- Real-time subscription ----------
  useEffect(() => {
    const channel = supabase
      .channel("job-runs-realtime")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "job_runs" },
        (payload: any) => {
          const updatedRun = payload.new as JobRun;
          if (selectedJob && updatedRun.job_id === selectedJob.id) {
            setJobRuns((prev) => {
              const idx = prev.findIndex((r) => r.id === updatedRun.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = updatedRun;
                return updated;
              }
              return [updatedRun, ...prev];
            });
          }
          fetchJobs();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedJob, fetchJobs]);

  // ---------- Create a new job ----------
  const handleCreate = async () => {
    if (!newName.trim() || !user) return;
    const { data, error } = await (supabase as any)
      .from("jobs")
      .insert({
        name: newName.trim(),
        user_id: user.id,
        task_type: newTaskType,
        schedule_type: "daily",
        daily_time: "08:00",
        timezone: "Asia/Kuala_Lumpur",
        is_active: false,
        task_config: {},
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setCreateDialogOpen(false);
    setNewName("");
    await fetchJobs();
    if (data) {
      setSelectedJob(data as Job);
      setActiveTab("settings");
    }
  };

  // ---------- Save job settings ----------
  const handleSave = async () => {
    if (!selectedJob) return;
    setSavingJob(true);

    let payload: Record<string, unknown> | undefined;
    if (editWebhookPayload.trim()) {
      try {
        payload = JSON.parse(editWebhookPayload);
      } catch {
        toast({ title: "Invalid JSON", description: "Payload must be valid JSON.", variant: "destructive" });
        setSavingJob(false);
        return;
      }
    }

    const taskConfig: Record<string, unknown> = {};
    if (editTaskType === "n8n_webhook") {
      if (editWebhookUrl) taskConfig.webhook_url = editWebhookUrl;
      taskConfig.method = editWebhookMethod;
      if (payload) taskConfig.payload = payload;
    }

    const { error } = await (supabase as any)
      .from("jobs")
      .update({
        name: editName.trim() || selectedJob.name,
        description: editDescription.trim() || null,
        schedule_type: editScheduleType,
        daily_time: editDailyTime,
        timezone: editTimezone,
        cron_expr: editCronExpr || null,
        task_type: editTaskType,
        task_config: taskConfig,
        is_active: editIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedJob.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: "Job settings updated." });
      await fetchJobs();
      // Refresh the selected job data
      const { data: refreshed } = await (supabase as any)
        .from("jobs")
        .select("*")
        .eq("id", selectedJob.id)
        .single();
      if (refreshed) setSelectedJob(refreshed as Job);
    }
    setSavingJob(false);
  };

  // ---------- Run a single job now ----------
  const handleRunSingleJob = async (jobId: string) => {
    setRunningJob(jobId);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${supabaseUrl}/functions/v1/jobs-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || resp.statusText);

      const result = data.results?.[0];
      if (result?.status === "success") {
        toast({ title: "Job completed", description: `${result.job_name} finished in ${((result.duration_ms || 0) / 1000).toFixed(1)}s` });
      } else if (result?.status === "skipped") {
        toast({ title: "Job skipped", description: result.reason || "Already run today" });
      } else if (result?.status === "failed") {
        toast({ title: "Job failed", description: result.error, variant: "destructive" });
      }

      await fetchJobs();
      if (selectedJob?.id === jobId) await fetchJobRuns(jobId);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRunningJob(null);
    }
  };

  // ---------- Delete a job ----------
  const handleDelete = async (jobId: string) => {
    const { error } = await (supabase as any)
      .from("jobs")
      .delete()
      .eq("id", jobId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deleted", description: "Job removed." });
      if (selectedJob?.id === jobId) setSelectedJob(null);
      await fetchJobs();
    }
    setDeleteConfirmId(null);
  };

  // ---------- Toggle active inline ----------
  const handleToggleActive = async (job: Job) => {
    const { error } = await (supabase as any)
      .from("jobs")
      .update({ is_active: !job.is_active, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    if (!error) {
      await fetchJobs();
      if (selectedJob?.id === job.id) {
        setSelectedJob({ ...job, is_active: !job.is_active });
        setEditIsActive(!job.is_active);
      }
    }
  };

  // ---------- Select a job ----------
  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
    setActiveTab("settings");
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* ---- Left panel: Jobs list ---- */}
      <div className="w-80 border-r border-border glass-subtle flex flex-col">
        <div className="p-4 border-b border-border glass-subtle flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-sm font-bold tracking-wide uppercase text-muted-foreground flex-1">
            Jobs
          </h1>
          <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingJobs ? (
            <div className="flex items-center justify-center p-8">
              <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
              <div className="glass elevation-1 rounded-2xl p-6">
                <Settings className="w-10 h-10 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
              <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Create your first job
              </Button>
            </div>
          ) : (
            <div>
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => handleSelectJob(job)}
                  className={`w-full text-left p-3 hover:bg-secondary/30 rounded-xl mx-1 mb-0.5 transition-colors ${
                    selectedJob?.id === job.id ? "bg-secondary/50 elevation-1" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate pr-2">
                      {job.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <TaskTypeIcon type={job.task_type} />
                      <Badge
                        variant={job.is_active ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {job.is_active ? "Active" : "Off"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                    <Calendar className="w-3 h-3" />
                    <span>
                      {job.schedule_type === "daily"
                        ? `Daily at ${job.daily_time || "08:00"} (${job.timezone || "UTC"})`
                        : job.schedule_type === "cron"
                          ? job.cron_expr || "Cron"
                          : "Manual"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Last: {formatDate(job.last_run_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Main panel ---- */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedJob ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border glass-subtle">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedJob.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedJob.task_type === "n8n_webhook" ? "Webhook" : "Browser Flow"}
                      {" | "}
                      {selectedJob.schedule_type === "daily"
                        ? `Daily at ${selectedJob.daily_time}`
                        : selectedJob.schedule_type === "cron"
                          ? "Cron"
                          : "Manual"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={selectedJob.is_active}
                    onCheckedChange={() => handleToggleActive(selectedJob)}
                  />
                  <span className="text-xs text-muted-foreground mr-2">
                    {selectedJob.is_active ? "Enabled" : "Disabled"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleRunSingleJob(selectedJob.id)}
                    disabled={runningJob === selectedJob.id}
                  >
                    {runningJob === selectedJob.id ? (
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Run Now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmId(selectedJob.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-4 mt-2 w-fit glass rounded-xl">
                <TabsTrigger value="settings" className="gap-1.5">
                  <Settings className="w-3.5 h-3.5" /> Settings
                </TabsTrigger>
                <TabsTrigger value="execution" className="gap-1.5">
                  <Wrench className="w-3.5 h-3.5" /> Execution
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5">
                  <History className="w-3.5 h-3.5" /> Run History
                </TabsTrigger>
              </TabsList>

              {/* ---- Settings Tab ---- */}
              <TabsContent value="settings" className="flex-1 overflow-y-auto p-4 space-y-6 mt-0">
                {/* General */}
                <Card className="glass rounded-2xl elevation-1 border-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">General</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="job-name">Name</Label>
                      <Input
                        id="job-name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Job name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="job-desc">Description</Label>
                      <Input
                        id="job-desc"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Optional description"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Schedule */}
                <Card className="glass rounded-2xl elevation-1 border-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Schedule</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Schedule Type</Label>
                        <Select value={editScheduleType} onValueChange={setEditScheduleType}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="cron">Cron Expression</SelectItem>
                            <SelectItem value="manual">Manual Only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Timezone</Label>
                        <Select value={editTimezone} onValueChange={setEditTimezone}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIMEZONES.map((tz) => (
                              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {editScheduleType === "daily" && (
                      <div className="space-y-2">
                        <Label htmlFor="daily-time">Run Time (24h)</Label>
                        <Input
                          id="daily-time"
                          type="time"
                          value={editDailyTime}
                          onChange={(e) => setEditDailyTime(e.target.value)}
                        />
                      </div>
                    )}

                    {editScheduleType === "cron" && (
                      <div className="space-y-2">
                        <Label htmlFor="cron-expr">Cron Expression</Label>
                        <Input
                          id="cron-expr"
                          value={editCronExpr}
                          onChange={(e) => setEditCronExpr(e.target.value)}
                          placeholder="0 8 * * *"
                        />
                        <p className="text-xs text-muted-foreground">Standard 5-field cron format (min hour dom month dow)</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Task Configuration */}
                <Card className="glass rounded-2xl elevation-1 border-0">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Task Configuration</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Task Type</Label>
                      <Select value={editTaskType} onValueChange={setEditTaskType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="n8n_webhook">Webhook (n8n / HTTP)</SelectItem>
                          <SelectItem value="browser_flow">Browser Flow (coming soon)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {editTaskType === "n8n_webhook" && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="webhook-url">Webhook URL</Label>
                          <Input
                            id="webhook-url"
                            value={editWebhookUrl}
                            onChange={(e) => setEditWebhookUrl(e.target.value)}
                            placeholder="https://n8n.example.com/webhook/..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>HTTP Method</Label>
                          <Select value={editWebhookMethod} onValueChange={setEditWebhookMethod}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="POST">POST</SelectItem>
                              <SelectItem value="GET">GET</SelectItem>
                              <SelectItem value="PUT">PUT</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="webhook-payload">Payload (JSON, optional)</Label>
                          <textarea
                            id="webhook-payload"
                            className="w-full min-h-[80px] rounded-xl border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={editWebhookPayload}
                            onChange={(e) => setEditWebhookPayload(e.target.value)}
                            placeholder='{"key": "value"}'
                          />
                        </div>
                      </>
                    )}

                    {editTaskType === "browser_flow" && (
                      <div className="rounded-xl glass-subtle p-4 text-sm text-muted-foreground">
                        Browser Flow automation is coming soon. You'll be able to define multi-step browser actions (navigate, fill forms, extract data) that run on a schedule.
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Save button */}
                <div className="flex justify-end pb-4">
                  <Button onClick={handleSave} disabled={savingJob} className="gap-1.5 rounded-xl">
                    {savingJob ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Changes
                  </Button>
                </div>
              </TabsContent>

              {/* ---- Execution Tab ---- */}
              <TabsContent value="execution" className="flex-1 overflow-y-auto p-4 mt-0 space-y-4">
                {executionState ? (
                  <>
                    {/* Status + Phase */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge variant={statusBadgeVariant(executionState.status as string)} className="flex items-center gap-1">
                        <StatusIcon status={executionState.status as string} />
                        {executionState.status as string}
                      </Badge>
                      {executionState.execution_phase && (
                        <span className="text-xs text-muted-foreground">
                          Phase: <span className="font-medium">{executionState.execution_phase as string}</span>
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Step {((executionState.current_step as number) || 0) + 1} / {executionState.total_steps as number}
                      </span>
                      {(executionState.retry_count as number) > 0 && (
                        <span className="text-xs text-amber-500">
                          Retry #{executionState.retry_count as number}
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{
                          width: `${(executionState.total_steps as number) > 0
                            ? (((executionState.current_step as number) || 0) / (executionState.total_steps as number)) * 100
                            : 0}%`,
                        }}
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {["paused", "failed", "waiting_for_login", "waiting_for_approval"].includes(executionState.status as string) && jobRuns[0] && (
                        <Button
                          size="sm"
                          className="gap-1.5 rounded-xl"
                          onClick={() => handleResumeExecution(jobRuns[0].id)}
                          disabled={resumingJob}
                        >
                          {resumingJob ? (
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Resume
                        </Button>
                      )}
                      {["running", "retrying", "queued"].includes(executionState.status as string) && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1.5 rounded-xl"
                          onClick={() => handleCancelExecution(executionState.id as string)}
                        >
                          <Ban className="w-3.5 h-3.5" /> Cancel
                        </Button>
                      )}
                    </div>

                    {/* Error display */}
                    {executionState.last_error && (
                      <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="destructive" className="text-[10px]">
                            {executionState.last_error_class as string || "error"}
                          </Badge>
                        </div>
                        <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-words">
                          {executionState.last_error as string}
                        </pre>
                      </div>
                    )}

                    {/* Step timeline */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Execution Steps</p>
                      {((executionState.execution_log as Array<Record<string, unknown>>) || []).map((step: Record<string, unknown>, i: number) => (
                        <ExecutionStepCard
                          key={i}
                          step={step as any}
                          isActive={i === (executionState.current_step as number)}
                        />
                      ))}
                      {((executionState.execution_log as Array<Record<string, unknown>>) || []).length === 0 && (
                        <p className="text-xs text-muted-foreground/60 py-4 text-center">
                          No steps executed yet.
                        </p>
                      )}
                    </div>

                    {/* Healing log */}
                    {((executionState.healing_log as Array<Record<string, unknown>>) || []).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-amber-500 flex items-center gap-1">
                          <Wrench className="w-3 h-3" /> Self-Healing History
                        </p>
                        {((executionState.healing_log as Array<Record<string, unknown>>) || []).map((entry: Record<string, unknown>, i: number) => (
                          <div key={i} className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/10 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                                {(entry.strategy as string) || "diagnosis"}
                              </Badge>
                              <span className="text-muted-foreground">
                                {entry.healed ? "Healed" : "Failed"}
                              </span>
                            </div>
                            {entry.suggested_selector && (
                              <code className="text-[10px] text-muted-foreground block">
                                {entry.original_selector as string} → {entry.suggested_selector as string}
                              </code>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <div className="glass elevation-1 rounded-2xl p-6">
                      <Wrench className="w-10 h-10 mb-3 opacity-30" />
                    </div>
                    <p className="text-sm mt-3">No execution data yet.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Run a browser_flow job to see step-by-step execution tracking.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* ---- History Tab ---- */}
              <TabsContent value="history" className="flex-1 overflow-y-auto p-4 mt-0">
                {loadingRuns ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : jobRuns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <div className="glass elevation-1 rounded-2xl p-6">
                      <History className="w-10 h-10 mb-3 opacity-30" />
                    </div>
                    <p className="text-sm">No runs recorded yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1.5"
                      onClick={() => handleRunSingleJob(selectedJob.id)}
                      disabled={runningJob === selectedJob.id}
                    >
                      <Play className="w-3.5 h-3.5" /> Run Now
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {jobRuns.map((run) => (
                      <Card key={run.id} className="bg-card border-border glass rounded-2xl elevation-1 border-0">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              {run.run_date}
                            </CardTitle>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {formatDuration(run.duration_ms, run.started_at, run.completed_at)}
                              </span>
                              <Badge
                                variant={statusBadgeVariant(run.status)}
                                className="flex items-center gap-1"
                              >
                                <StatusIcon status={run.status} />
                                {run.status}
                              </Badge>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <div className="text-xs text-muted-foreground mb-2">
                            Started: {formatDate(run.started_at)} | Completed: {formatDate(run.completed_at)}
                          </div>

                          {run.error && (
                            <div className="p-2 rounded-xl bg-destructive/10 border border-destructive/20 mb-2">
                              <p className="text-xs font-medium text-destructive flex items-center gap-1 mb-1">
                                <XCircle className="w-3 h-3" /> Error
                              </p>
                              <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-all">
                                {run.error}
                              </pre>
                            </div>
                          )}

                          {run.output && (
                            <div className="p-2 rounded-xl glass-subtle border border-border">
                              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                                <CheckCircle className="w-3 h-3" /> Output
                              </p>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                                {typeof run.output === "string"
                                  ? run.output
                                  : JSON.stringify(run.output, null, 2)}
                              </pre>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="glass elevation-1 rounded-2xl p-6">
              <Settings className="w-12 h-12 mb-4 opacity-20" />
            </div>
            <p className="text-sm">Select a job to configure or view its history.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" /> Create Job
            </Button>
          </div>
        )}
      </div>

      {/* ---- Create Job Dialog ---- */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md glass-strong rounded-2xl">
          <DialogHeader>
            <DialogTitle>Create New Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-name">Job Name</Label>
              <Input
                id="new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Daily Order Check"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Task Type</Label>
              <Select value={newTaskType} onValueChange={setNewTaskType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="n8n_webhook">Webhook (n8n / HTTP)</SelectItem>
                  <SelectItem value="browser_flow">Browser Flow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()} className="rounded-xl">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm glass-strong rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete Job</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the job and all its run history. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} className="rounded-xl">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)} className="rounded-xl">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
