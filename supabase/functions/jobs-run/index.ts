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
}

interface JobResult {
  job_id: string;
  job_name: string;
  status: "success" | "skipped" | "failed";
  reason?: string;
  error?: string;
  duration_ms?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr",
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
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr",
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
        // Placeholder — not yet implemented
        const completedAt = new Date().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        await supabase
          .from("job_runs")
          .update({
            status: "skipped",
            output: { message: "browser_flow not yet implemented" },
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
          status: "skipped",
          reason: "browser_flow not yet implemented",
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
