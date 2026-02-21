import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * jobs-resume — Resume a paused/failed/waiting execution
 *
 * POST /jobs-resume { "job_run_id": "..." }
 *
 * Validates that the execution_state is in a resumable state,
 * then re-invokes jobs-run to pick up from the last checkpoint.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESUMABLE_STATES = ["failed", "paused", "waiting_for_login", "waiting_for_approval"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  let isAuthorized = false;

  if (token === serviceRoleKey) {
    isAuthorized = true;
  } else if (token) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (!authError && user) isAuthorized = true;
    } catch {}

    if (!isAuthorized && token.startsWith("eyJ")) {
      try {
        const payloadB64 = token.split(".")[1];
        const payload = JSON.parse(atob(payloadB64));
        if (payload.role === "service_role" && payload.iss === "supabase") {
          isAuthorized = true;
        }
      } catch {}
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const jobRunId = body.job_run_id as string;

    if (!jobRunId) {
      return new Response(JSON.stringify({ error: "job_run_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get execution state
    const { data: execState, error: execErr } = await supabase
      .from("execution_state")
      .select("*")
      .eq("job_run_id", jobRunId)
      .single();

    if (execErr || !execState) {
      return new Response(JSON.stringify({ error: "Execution state not found for this job run" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESUMABLE_STATES.includes(execState.status)) {
      return new Response(JSON.stringify({
        error: `Cannot resume from status "${execState.status}". Resumable states: ${RESUMABLE_STATES.join(", ")}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check retry limit
    if (execState.retry_count >= execState.max_retries) {
      return new Response(JSON.stringify({
        error: `Max retries (${execState.max_retries}) exceeded. Retry count: ${execState.retry_count}`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the job_run to find the job_id
    const { data: jobRun } = await supabase
      .from("job_runs")
      .select("job_id")
      .eq("id", jobRunId)
      .single();

    if (!jobRun) {
      return new Response(JSON.stringify({ error: "Job run not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reset execution state for resume
    await supabase.from("execution_state").update({
      status: "queued",
      last_error: null,
      last_error_class: null,
    }).eq("id", execState.id);

    // Reset job_run status to pending so jobs-run will pick it up
    await supabase.from("job_runs").update({
      status: "running",
      error: null,
      completed_at: null,
    }).eq("id", jobRunId);

    // Re-invoke jobs-run for this specific job
    const resp = await fetch(`${supabaseUrl}/functions/v1/jobs-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ job_id: jobRun.job_id }),
    });

    const result = await resp.json();

    return new Response(JSON.stringify({
      message: "Job resumed",
      job_run_id: jobRunId,
      execution_state_id: execState.id,
      resumed_from_step: execState.current_step,
      retry_count: execState.retry_count + 1,
      jobs_run_result: result,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("jobs-resume error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
