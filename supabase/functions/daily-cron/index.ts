import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * daily-cron — Supabase Edge Function
 *
 * Called by pg_cron (via net.http_post) or manually via POST from the UI.
 * Iterates all active jobs, enforces daily idempotency (one run per job per day),
 * triggers the corresponding n8n webhook, and records the result.
 *
 * Auth: service-role key OR a valid user JWT in Authorization header.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Job {
  id: string;
  name: string;
  workflow_name: string;
  workflow_payload: Record<string, unknown>;
}

interface JobResult {
  job_id: string;
  job_name: string;
  status: "skipped" | "completed" | "failed";
  reason?: string;
  error?: string;
}

/**
 * Get today's date in UTC+8 (MYT) as YYYY-MM-DD string.
 * The jobs schedule targets 6 AM MYT, so the "run date" should reflect
 * the local MYT date, not UTC.
 */
function getTodayMYT(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 10); // YYYY-MM-DD
}

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

  const token = authHeader.replace(/^Bearer\s+/i, "");
  let isAuthorized = false;

  // Check if it's the service role key (from pg_cron or server-side)
  if (token === serviceRoleKey) {
    isAuthorized = true;
  } else if (token) {
    // Try to validate as a user JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (!authError && user) {
      isAuthorized = true;
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

  // ---------- n8n webhook base ----------
  const n8nBase = Deno.env.get("N8N_WEBHOOK_BASE_URL");
  if (!n8nBase) {
    return new Response(JSON.stringify({ error: "N8N_WEBHOOK_BASE_URL is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const today = getTodayMYT();
  const results: JobResult[] = [];

  try {
    // ---------- 1. Fetch all active jobs ----------
    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id, name, workflow_name, workflow_payload")
      .eq("is_active", true);

    if (jobsError) {
      throw new Error(`Failed to query jobs: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ message: "No active jobs found", date: today, results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- 2. Process each job ----------
    for (const job of jobs as Job[]) {
      // --- 2a. Idempotency check ---
      const { data: existingRun } = await supabase
        .from("job_runs")
        .select("id, status")
        .eq("job_id", job.id)
        .eq("run_date", today)
        .maybeSingle();

      if (existingRun && (existingRun.status === "completed" || existingRun.status === "running")) {
        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "skipped",
          reason: `Already ${existingRun.status} for ${today}`,
        });
        continue;
      }

      // --- 2b. Create (or reuse failed) job_run record ---
      let runId: string;

      if (existingRun && existingRun.status === "failed") {
        // Re-run a previously failed attempt
        const { error: updateErr } = await supabase
          .from("job_runs")
          .update({
            status: "running",
            error: null,
            output: null,
            started_at: new Date().toISOString(),
            completed_at: null,
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
        // Insert new job_run
        const { data: newRun, error: insertErr } = await supabase
          .from("job_runs")
          .insert({
            job_id: job.id,
            run_date: today,
            status: "running",
            input: job.workflow_payload,
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertErr) {
          // Could be a race condition with the unique constraint
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

      // --- 2c. Call n8n webhook ---
      try {
        const webhookUrl = `${n8nBase.replace(/\/+$/, "")}/webhook/${job.workflow_name}`;

        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: job.id,
            job_name: job.name,
            run_id: runId,
            run_date: today,
            ...job.workflow_payload,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`n8n responded ${resp.status}: ${errBody}`);
        }

        const output = await resp.json().catch(() => ({ raw: "non-json response" }));

        // --- 2d. Success: mark completed ---
        await supabase
          .from("job_runs")
          .update({
            status: "completed",
            output,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);

        // Update last_run_at on the job
        await supabase
          .from("jobs")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", job.id);

        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "completed",
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        // --- 2e. Failure: mark failed ---
        await supabase
          .from("job_runs")
          .update({
            status: "failed",
            error: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);

        // Still update last_run_at so we know the job was attempted
        await supabase
          .from("jobs")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", job.id);

        results.push({
          job_id: job.id,
          job_name: job.name,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    // ---------- 3. Return summary ----------
    const summary = {
      date: today,
      total: results.length,
      completed: results.filter((r) => r.status === "completed").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("daily-cron fatal error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
