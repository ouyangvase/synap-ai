import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * daily-cron — Supabase Edge Function
 *
 * Called by pg_cron (via net.http_post) or manually.
 * Delegates to the jobs-run function in scheduler mode.
 *
 * This is a thin wrapper that:
 * 1. Validates auth (service-role or user JWT)
 * 2. Calls the jobs-run function in scheduler mode (no job_id)
 * 3. Returns the result
 *
 * Auth: service-role key OR a valid user JWT in Authorization header.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // ---------- CORS ----------
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ---------- Auth ----------
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  let isAuthorized = false;

  if (token === serviceRoleKey) {
    isAuthorized = true;
  } else if (token) {
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

  // ---------- Delegate to jobs-run in scheduler mode ----------
  try {
    const jobsRunUrl = `${supabaseUrl}/functions/v1/jobs-run`;
    const resp = await fetch(jobsRunUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({}), // empty = scheduler mode
    });

    const data = await resp.json();

    return new Response(JSON.stringify(data, null, 2), {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("daily-cron error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
