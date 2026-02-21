import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * jobs-run — Supabase Edge Function
 *
 * Runs a single job by ID, or all active jobs that are due (scheduler mode).
 *
 * Routes:
 *   POST /jobs-run  { "job_id": "..." }  — Run one specific job immediately
 *   POST /jobs-run  {} or no job_id       — Run all active due jobs (scheduler)
 *
 * Auth: service-role key OR a valid user JWT in Authorization header.
 *
 * Supports task types:
 *   - n8n_webhook:  fires an HTTP request to the configured webhook URL
 *   - browser_flow: placeholder (not yet implemented)
 *
 * Legacy fallback: jobs with workflow_name + workflow_payload use
 *   N8N_WEBHOOK_BASE_URL + /webhook/${workflow_name}
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  name: string;
  description: string | null;
  schedule: string | null;
  workflow_name: string | null;
  workflow_payload: Record<string, unknown> | null;
  is_active: boolean;
  task_type: string;
  task_config: Record<string, unknown>;
  schedule_type: string;
  daily_time: string;
  timezone: string;
  cron_expr: string | null;
  steps: Array<{ action: string; parameters: Record<string, unknown>; phase: string; max_retries?: number; timeout_ms?: number }>;
}

interface JobResult {
  job_id: string;
  job_name: string;
  status: "success" | "skipped" | "failed" | "waiting_for_login" | "waiting_for_approval" | "paused";
  reason?: string;
  error?: string;
  error_class?: string;
  duration_ms?: number;
}

interface StepResult {
  step: number;
  phase: string;
  action: string;
  status: "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  error_class?: string;
  healing_attempts?: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify errors for state machine transitions.
 */
function classifyBrowserError(error: string, url?: string): { error_class: string; is_recoverable: boolean } {
  const lower = error.toLowerCase();
  const urlLower = (url || "").toLowerCase();

  if (urlLower.includes("/login") || urlLower.includes("/signin") || urlLower.includes("/auth")) {
    return { error_class: "login_required", is_recoverable: false };
  }
  if (lower.includes("captcha") || lower.includes("recaptcha") || lower.includes("hcaptcha")) {
    return { error_class: "captcha_detected", is_recoverable: false };
  }
  if (lower.includes("session expired") || lower.includes("sign in to continue")) {
    return { error_class: "session_expired", is_recoverable: true };
  }
  if (lower.includes("timeout")) {
    return { error_class: "navigation_timeout", is_recoverable: true };
  }
  if (lower.includes("element not found") || lower.includes("waiting for selector")) {
    return { error_class: "element_not_found", is_recoverable: true };
  }
  return { error_class: "unknown", is_recoverable: false };
}

// ── Execution State Helpers ──

async function initExecutionState(
  supabase: ReturnType<typeof createClient>,
  jobRunId: string,
  steps: Job["steps"],
  maxRetries: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("execution_state")
    .insert({
      job_run_id: jobRunId,
      status: "created",
      total_steps: steps.length,
      max_retries: maxRetries,
      resume_token: { steps },
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create execution state: ${error.message}`);
  return data.id;
}

async function getExecutionState(supabase: ReturnType<typeof createClient>, jobRunId: string) {
  const { data } = await supabase
    .from("execution_state")
    .select("*")
    .eq("job_run_id", jobRunId)
    .maybeSingle();
  return data;
}

async function updateExecutionState(
  supabase: ReturnType<typeof createClient>,
  executionStateId: string,
  updates: Record<string, unknown>,
) {
  await supabase.from("execution_state").update(updates).eq("id", executionStateId);
}

async function appendStepResult(
  supabase: ReturnType<typeof createClient>,
  executionStateId: string,
  stepResult: StepResult,
  newStatus: string,
  newStep: number,
) {
  const { data: current } = await supabase
    .from("execution_state")
    .select("execution_log")
    .eq("id", executionStateId)
    .single();

  const log = ((current?.execution_log as StepResult[]) || []);
  log.push(stepResult);

  await supabase
    .from("execution_state")
    .update({
      execution_log: log,
      current_step: newStep,
      status: newStatus,
      last_error: stepResult.error || null,
      last_error_class: stepResult.error_class || null,
      ...(["success", "failed", "cancelled"].includes(newStatus)
        ? { completed_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", executionStateId);
}

/**
 * Get today's date (YYYY-MM-DD) in the given IANA timezone.
 * Uses Intl.DateTimeFormat so we don't need any third-party date library.
 */
function getDateInTimezone(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

/**
 * Get the current time (HH:MM, 24-hour) in the given IANA timezone.
 */
function getTimeInTimezone(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  return `${hour}:${minute}`;
}

/**
 * Convert an HH:MM string to total minutes since midnight.
 */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check whether the current time in the job's timezone is within a
 * 30-minute window of the job's daily_time.
 *
 * Example: daily_time = "06:00", current = "06:25" => true (within 30 min)
 *          daily_time = "06:00", current = "06:35" => false
 */
function isWithinDailyWindow(dailyTime: string, currentTime: string): boolean {
  const target = timeToMinutes(dailyTime);
  const current = timeToMinutes(currentTime);

  // Handle midnight wraparound (e.g. target=23:50, current=00:10)
  let diff = current - target;
  if (diff < -720) diff += 1440; // wrap forward
  if (diff > 720) diff -= 1440;  // wrap backward

  return diff >= 0 && diff < 30;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // ---------- CORS ----------
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ---------- Auth: service-role key OR valid user JWT ----------
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  let isAuthorized = false;

  if (token) {
    // Check if it's the service role key (from pg_cron or server-side)
    if (token === serviceRoleKey) {
      isAuthorized = true;
    } else {
      // Try to validate as a user JWT
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const {
          data: { user },
          error: authError,
        } = await userClient.auth.getUser();
        if (!authError && user) {
          isAuthorized = true;
        }
      } catch {
        // auth failed
      }

      // Also check if token is a service_role JWT (env var may differ from JWT)
      if (!isAuthorized && token.startsWith("eyJ")) {
        // Parse JWT payload and check role
        try {
          const payloadB64 = token.split(".")[1];
          const payload = JSON.parse(atob(payloadB64));
          if (payload.role === "service_role" && payload.iss === "supabase") {
            isAuthorized = true;
          }
        } catch {
          // not a valid JWT
        }
      }
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---------- Supabase client (service role — bypasses RLS) ----------
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---------- Parse request body ----------
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — means scheduler mode
  }

  const jobId = (body.job_id as string) || null;
  const results: JobResult[] = [];

  try {
    // ------------------------------------------------------------------
    // 1. Fetch job(s)
    // ------------------------------------------------------------------
    let jobs: Job[];

    if (jobId) {
      // Single-job mode
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr, steps",
        )
        .eq("id", jobId)
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: `Job not found: ${error?.message ?? "unknown"}` }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      jobs = [data as Job];
    } else {
      // Scheduler mode — all active jobs
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr, steps",
        )
        .eq("is_active", true);

      if (error) {
        throw new Error(`Failed to query jobs: ${error.message}`);
      }
      jobs = (data ?? []) as Job[];
    }

    if (jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No jobs to run", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ------------------------------------------------------------------
    // 2. Process each job
    // ------------------------------------------------------------------
    for (const job of jobs) {
      const tz = job.timezone || "UTC";
      const todayInTz = getDateInTimezone(tz);
      const nowTimeInTz = getTimeInTimezone(tz);

      // ── Schedule check (only in scheduler mode — skip for single job) ──
      if (!jobId) {
        if (job.schedule_type === "daily" && job.daily_time) {
          if (!isWithinDailyWindow(job.daily_time, nowTimeInTz)) {
            results.push({
              job_id: job.id,
              job_name: job.name,
              status: "skipped",
              reason: `Not within 30-min window of ${job.daily_time} (current: ${nowTimeInTz} ${tz})`,
            });
            continue;
          }
        } else if (job.schedule_type === "manual") {
          results.push({
            job_id: job.id,
            job_name: job.name,
            status: "skipped",
            reason: "Manual schedule — skipped in scheduler mode",
          });
          continue;
        }
        // For cron schedule_type we just let it through for now
        // (cron matching can be added later)
      }

      // ── Idempotency check ──
      const runDate = todayInTz;
      const { data: existingRun } = await supabase
        .from("job_runs")
        .select("id, status")
        .eq("job_id", job.id)
        .eq("run_date", runDate)
        .maybeSingle();

      if (existingRun && (existingRun.status === "success" || existingRun.status === "running")) {
        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "skipped",
          reason: `Already ${existingRun.status} for ${runDate}`,
        });
        continue;
      }

      // ── Create or reuse (failed) job_run record ──
      const startedAt = new Date().toISOString();
      let runId: string;

      if (existingRun && existingRun.status === "failed") {
        // Re-run a previously failed attempt
        const { error: updateErr } = await supabase
          .from("job_runs")
          .update({
            status: "running",
            error: null,
            output: null,
            started_at: startedAt,
            completed_at: null,
            duration_ms: null,
            input: job.task_config ?? job.workflow_payload,
          })
          .eq("id", existingRun.id);

        if (updateErr) {
          results.push({
            job_id: job.id,
            job_name: job.name,
            status: "failed",
            error: `Failed to update existing run: ${updateErr.message}`,
          });
          continue;
        }
        runId = existingRun.id;
      } else {
        // Insert new run
        const { data: newRun, error: insertErr } = await supabase
          .from("job_runs")
          .insert({
            job_id: job.id,
            run_date: runDate,
            status: "running",
            input: job.task_config ?? job.workflow_payload,
            started_at: startedAt,
          })
          .select("id")
          .single();

        if (insertErr) {
          results.push({
            job_id: job.id,
            job_name: job.name,
            status: "skipped",
            reason: `Could not create run (possible duplicate): ${insertErr.message}`,
          });
          continue;
        }
        runId = newRun.id;
      }

      // ── Execute based on task_type ──
      const taskType = job.task_type || "n8n_webhook";

      if (taskType === "browser_flow") {
        // ── browser_flow: Multi-step browser automation with state machine ──
        const steps = (job.steps || []) as Job["steps"];
        if (steps.length === 0) {
          const completedAt = new Date().toISOString();
          const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          await supabase.from("job_runs").update({
            status: "skipped", output: { message: "No steps defined for browser_flow" },
            completed_at: completedAt, duration_ms: durationMs,
          }).eq("id", runId);
          await supabase.from("jobs").update({ last_run_at: completedAt }).eq("id", job.id);
          results.push({ job_id: job.id, job_name: job.name, status: "skipped", reason: "No steps defined" });
          continue;
        }

        // Check for existing execution state (resume scenario)
        let execState = await getExecutionState(supabase, runId);
        let execStateId: string;
        const maxRetries = (job.task_config as Record<string, unknown>)?.max_retries as number || 3;

        if (execState && ["failed", "paused", "waiting_for_login", "waiting_for_approval"].includes(execState.status)) {
          // Resume from last checkpoint
          execStateId = execState.id;
          await updateExecutionState(supabase, execStateId, {
            status: "running",
            retry_count: (execState.retry_count || 0) + 1,
          });
        } else if (!execState) {
          // Fresh start
          execStateId = await initExecutionState(supabase, runId, steps, maxRetries);
          await updateExecutionState(supabase, execStateId, {
            status: "running",
            started_at: new Date().toISOString(),
          });
        } else {
          execStateId = execState.id;
        }

        // Reload state
        execState = await getExecutionState(supabase, runId);
        const startStep = execState?.current_step || 0;

        await supabase.from("job_runs").update({ status: "running" }).eq("id", runId);

        let lastUrl: string | null = (execState?.resume_token as Record<string, unknown>)?.last_url as string || null;
        let flowFailed = false;
        let failedStepResult: StepResult | null = null;
        let finalStatus = "success";

        for (let i = startStep; i < steps.length; i++) {
          const step = steps[i];
          const stepStart = new Date().toISOString();

          // Update phase
          await updateExecutionState(supabase, execStateId, {
            current_step: i,
            execution_phase: step.phase,
            status: "running",
          });

          try {
            // Call browser-proxy/agent-action for this step
            const actionPayload = {
              input: {
                url: lastUrl || (step.parameters?.url as string),
                steps: [{ action: step.action, ...step.parameters }],
              },
              meta: {
                tool_name: "browser_do",
                job_run_id: runId,
                execution_state_id: execStateId,
              },
            };

            const resp = await fetch(`${supabaseUrl}/functions/v1/browser-proxy/agent-action`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceRoleKey}`,
                apikey: anonKey,
              },
              body: JSON.stringify(actionPayload),
            });

            const result = await resp.json();

            if (!resp.ok || result.error) {
              throw new Error(result.error || `Step failed with HTTP ${resp.status}`);
            }

            // Update last known URL
            if (result.url) lastUrl = result.url;

            const stepEnd = new Date().toISOString();
            const stepDuration = new Date(stepEnd).getTime() - new Date(stepStart).getTime();

            await appendStepResult(supabase, execStateId, {
              step: i, phase: step.phase, action: step.action, status: "completed",
              result: { url: result.url, content: result.content?.substring?.(0, 2000), step_results: result.step_results },
              started_at: stepStart, completed_at: stepEnd, duration_ms: stepDuration,
            }, i === steps.length - 1 ? "success" : "running", i + 1);

            // Persist last_url for resume
            await updateExecutionState(supabase, execStateId, {
              resume_token: { ...(execState?.resume_token as Record<string, unknown>), last_url: lastUrl, last_completed_step: i },
            });

          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const stepEnd = new Date().toISOString();
            const stepDuration = new Date(stepEnd).getTime() - new Date(stepStart).getTime();

            const classification = classifyBrowserError(errorMessage, lastUrl || "");

            failedStepResult = {
              step: i, phase: step.phase, action: step.action, status: "failed",
              error: errorMessage, error_class: classification.error_class,
              started_at: stepStart, completed_at: stepEnd, duration_ms: stepDuration,
            };

            // Determine state transition based on error class
            if (classification.error_class === "login_required") {
              finalStatus = "waiting_for_login";
            } else if (classification.error_class === "captcha_detected") {
              finalStatus = "waiting_for_approval";
            } else if (classification.is_recoverable && (execState?.retry_count || 0) < maxRetries) {
              finalStatus = "retrying";
            } else {
              finalStatus = "failed";
            }

            await appendStepResult(supabase, execStateId, failedStepResult, finalStatus, i);

            await updateExecutionState(supabase, execStateId, {
              resume_token: { ...(execState?.resume_token as Record<string, unknown>), last_url: lastUrl, last_completed_step: i > 0 ? i - 1 : 0 },
              last_error: errorMessage,
              last_error_class: classification.error_class,
            });

            flowFailed = true;
            break;
          }
        }

        // Finalize
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
        const finalExec = await getExecutionState(supabase, runId);

        await supabase.from("job_runs").update({
          status: flowFailed ? finalStatus : "success",
          output: { execution_log: finalExec?.execution_log, final_url: lastUrl },
          error: flowFailed ? failedStepResult?.error : null,
          completed_at: completedAt,
          duration_ms: durationMs,
        }).eq("id", runId);

        await supabase.from("jobs").update({ last_run_at: completedAt }).eq("id", job.id);

        results.push({
          job_id: job.id, job_name: job.name,
          status: (flowFailed ? finalStatus : "success") as JobResult["status"],
          error: flowFailed ? failedStepResult?.error : undefined,
          error_class: flowFailed ? failedStepResult?.error_class : undefined,
          duration_ms: durationMs,
        });
        continue;
      }

      // ── n8n_webhook (default) ──
      try {
        // Determine webhook URL and request details
        let webhookUrl: string;
        let method = "POST";
        let headers: Record<string, string> = { "Content-Type": "application/json" };
        let payload: Record<string, unknown>;

        const taskConfig = job.task_config || {};

        if (taskConfig.webhook_url) {
          // New-style: full URL in task_config
          webhookUrl = taskConfig.webhook_url as string;
          method = (taskConfig.method as string) || "POST";
          if (taskConfig.headers && typeof taskConfig.headers === "object") {
            headers = { ...headers, ...(taskConfig.headers as Record<string, string>) };
          }
          payload = (taskConfig.payload as Record<string, unknown>) ?? {
            job_id: job.id,
            job_name: job.name,
            run_id: runId,
            run_date: runDate,
          };
        } else if (job.workflow_name) {
          // Legacy fallback: workflow_name + N8N_WEBHOOK_BASE_URL
          const n8nBase = Deno.env.get("N8N_WEBHOOK_BASE_URL");
          if (!n8nBase) {
            throw new Error(
              "N8N_WEBHOOK_BASE_URL is not configured and job has no task_config.webhook_url",
            );
          }
          webhookUrl = `${n8nBase.replace(/\/+$/, "")}/webhook/${job.workflow_name}`;
          payload = {
            job_id: job.id,
            job_name: job.name,
            run_id: runId,
            run_date: runDate,
            ...(job.workflow_payload ?? {}),
          };
        } else {
          throw new Error(
            "Job has no task_config.webhook_url and no workflow_name — cannot determine webhook target",
          );
        }

        // Fire the request
        const resp = await fetch(webhookUrl, {
          method,
          headers,
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`Webhook responded ${resp.status}: ${errBody}`);
        }

        const output = await resp.json().catch(() => ({ raw: "non-json response" }));

        // ── Success ──
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        await supabase
          .from("job_runs")
          .update({
            status: "success",
            output,
            completed_at: completedAt,
            duration_ms: durationMs,
          })
          .eq("id", runId);

        await supabase
          .from("jobs")
          .update({ last_run_at: completedAt })
          .eq("id", job.id);

        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "success",
          duration_ms: durationMs,
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        // ── Failure ──
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        await supabase
          .from("job_runs")
          .update({
            status: "failed",
            error: errorMessage,
            completed_at: completedAt,
            duration_ms: durationMs,
          })
          .eq("id", runId);

        // Still update last_run_at so we know the job was attempted
        await supabase
          .from("jobs")
          .update({ last_run_at: completedAt })
          .eq("id", job.id);

        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "failed",
          error: errorMessage,
          duration_ms: durationMs,
        });
      }
    }

    // ------------------------------------------------------------------
    // 3. Return summary
    // ------------------------------------------------------------------
    const summary = {
      mode: jobId ? "single" : "scheduler",
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("jobs-run fatal error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
