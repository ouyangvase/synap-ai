import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Play,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Loader,
} from "lucide-react";

interface Job {
  id: string;
  name: string;
  schedule: string | null;
  is_active: boolean;
  last_run_at: string | null;
  workflow_name: string;
  created_at: string;
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
  created_at: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "running":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="w-3.5 h-3.5" />;
    case "running":
      return <Loader className="w-3.5 h-3.5 animate-spin" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5" />;
    default:
      return <Clock className="w-3.5 h-3.5" />;
  }
}

export default function JobsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runningCron, setRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<string | null>(null);

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
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // ---------- Fetch runs when a job is selected ----------
  useEffect(() => {
    if (selectedJob) {
      fetchJobRuns(selectedJob.id);
    } else {
      setJobRuns([]);
    }
  }, [selectedJob, fetchJobRuns]);

  // ---------- Real-time subscription on job_runs ----------
  useEffect(() => {
    const channel = supabase
      .channel("job-runs-realtime")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "job_runs" },
        (payload: any) => {
          const updatedRun = payload.new as JobRun;

          // Update the run list if it belongs to the selected job
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

          // Also refresh jobs list to pick up last_run_at changes
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedJob, fetchJobs]);

  // ---------- Run Now: call the daily-cron edge function ----------
  const handleRunNow = useCallback(async () => {
    setRunningCron(true);
    setCronResult(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

      // Fall back to user's access token if service role key is not available on the client
      const token = serviceRoleKey || session?.access_token;

      if (!token) {
        setCronResult("Error: No authentication token available.");
        return;
      }

      const resp = await fetch(`${supabaseUrl}/functions/v1/daily-cron`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await resp.json();

      if (resp.ok) {
        setCronResult(
          `Completed: ${data.completed ?? 0} | Failed: ${data.failed ?? 0} | Skipped: ${data.skipped ?? 0}`
        );
        // Refresh data
        fetchJobs();
        if (selectedJob) fetchJobRuns(selectedJob.id);
      } else {
        setCronResult(`Error: ${data.error || resp.statusText}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCronResult(`Error: ${msg}`);
    } finally {
      setRunningCron(false);
    }
  }, [session, selectedJob, fetchJobs, fetchJobRuns]);

  // ---------- Select a job ----------
  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
    setCronResult(null);
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Left panel: Jobs list */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
            Jobs
          </h1>
        </div>

        <div className="p-3 border-b border-border space-y-2">
          <Button
            className="w-full"
            size="sm"
            onClick={handleRunNow}
            disabled={runningCron}
          >
            {runningCron ? (
              <Loader className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Run All Jobs Now
          </Button>
          {cronResult && (
            <p className="text-xs text-muted-foreground px-1">{cronResult}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingJobs ? (
            <div className="flex items-center justify-center p-8">
              <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              No jobs found.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => handleSelectJob(job)}
                  className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                    selectedJob?.id === job.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate pr-2">
                      {job.name}
                    </span>
                    <Badge
                      variant={job.is_active ? "default" : "outline"}
                      className="text-[10px] shrink-0"
                    >
                      {job.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {job.schedule && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Calendar className="w-3 h-3" />
                      <span>{job.schedule}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Last run: {formatDate(job.last_run_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main panel: Job runs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedJob ? (
          <>
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedJob.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    Workflow: {selectedJob.workflow_name}
                    {selectedJob.schedule ? ` | Schedule: ${selectedJob.schedule}` : ""}
                  </p>
                </div>
                <Badge variant={selectedJob.is_active ? "default" : "outline"}>
                  {selectedJob.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingRuns ? (
                <div className="flex items-center justify-center p-8">
                  <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : jobRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Calendar className="w-10 h-10 mb-3 opacity-50" />
                  <p className="text-sm">No runs recorded for this job yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {jobRuns.map((run) => (
                    <Card key={run.id} className="bg-card border-border">
                      <CardHeader className="pb-2 pt-4 px-4">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            {run.run_date}
                          </CardTitle>
                          <Badge
                            variant={statusBadgeVariant(run.status)}
                            className="flex items-center gap-1"
                          >
                            <StatusIcon status={run.status} />
                            {run.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="h-8 text-xs">Started</TableHead>
                              <TableHead className="h-8 text-xs">Completed</TableHead>
                              <TableHead className="h-8 text-xs">Duration</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-xs py-2">
                                {formatDate(run.started_at)}
                              </TableCell>
                              <TableCell className="text-xs py-2">
                                {formatDate(run.completed_at)}
                              </TableCell>
                              <TableCell className="text-xs py-2">
                                {run.started_at && run.completed_at
                                  ? `${(
                                      (new Date(run.completed_at).getTime() -
                                        new Date(run.started_at).getTime()) /
                                      1000
                                    ).toFixed(1)}s`
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>

                        {run.error && (
                          <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20">
                            <p className="text-xs font-medium text-destructive flex items-center gap-1 mb-1">
                              <XCircle className="w-3 h-3" />
                              Error
                            </p>
                            <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-all">
                              {run.error}
                            </pre>
                          </div>
                        )}

                        {run.output && (
                          <div className="mt-3 p-2 rounded bg-muted/50 border border-border">
                            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                              <CheckCircle className="w-3 h-3" />
                              Output
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
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Clock className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-sm">Select a job from the left panel to view its run history.</p>
          </div>
        )}
      </div>
    </div>
  );
}
