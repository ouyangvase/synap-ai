import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tool_run_id, conversation_id } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tool run
    const { data: toolRun } = await supabase
      .from("tool_runs")
      .select("*, tools(*)")
      .eq("id", tool_run_id)
      .single();

    if (!toolRun || toolRun.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (toolRun.status !== "approved") {
      return new Response(JSON.stringify({ error: "Tool run not approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update to running
    await supabase.from("tool_runs").update({
      status: "running",
      started_at: new Date().toISOString(),
    }).eq("id", tool_run_id);

    // Get endpoint
    const { data: endpoint } = await supabase
      .from("tool_endpoints")
      .select("*")
      .eq("tool_id", toolRun.tool_id)
      .single();

    if (!endpoint) {
      await supabase.from("tool_runs").update({
        status: "failed",
        error: "No endpoint configured",
        completed_at: new Date().toISOString(),
      }).eq("id", tool_run_id);
      return new Response(JSON.stringify({ error: "No endpoint" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tool = toolRun.tools;

    // Resolve N8N_WEBHOOK_BASE_URL placeholder in endpoint URL
    let resolvedUrl = endpoint.endpoint_url;
    const n8nBase = Deno.env.get("N8N_WEBHOOK_BASE_URL");
    if (n8nBase && resolvedUrl.includes("{N8N_WEBHOOK_BASE_URL}")) {
      resolvedUrl = resolvedUrl.replace("{N8N_WEBHOOK_BASE_URL}", n8nBase.replace(/\/$/, ""));
    }
    // Resolve SUPABASE_URL placeholder in endpoint URL
    if (supabaseUrl && resolvedUrl.includes("{SUPABASE_URL}")) {
      resolvedUrl = resolvedUrl.replace("{SUPABASE_URL}", supabaseUrl.replace(/\/$/, ""));
    }

    const payload = {
      meta: { tool_name: tool.name, tool_run_id, user_id: user.id, conversation_id },
      input: toolRun.input,
    };

    let lastError = "";
    for (let attempt = 0; attempt <= endpoint.max_retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), endpoint.timeout_ms);

        const resp = await fetch(resolvedUrl, {
          method: endpoint.http_method,
          headers: {
            "Content-Type": "application/json",
            ...(endpoint.headers as Record<string, string>),
            // Add service role auth for internal Supabase function calls
            ...(resolvedUrl.includes(supabaseUrl) ? {
              Authorization: `Bearer ${supabaseServiceKey}`,
              apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
            } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}`;
          if (resp.status >= 500 && attempt < endpoint.max_retries) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500 + Math.random() * 500));
            continue;
          }
          throw new Error(lastError);
        }

        const result = await resp.json();
        await supabase.from("tool_runs").update({
          status: "completed",
          output: result,
          completed_at: new Date().toISOString(),
        }).eq("id", tool_run_id);

        // Insert tool result message
        await supabase.from("messages").insert({
          conversation_id,
          user_id: user.id,
          role: "tool",
          content: result.markdown_content || JSON.stringify(result),
          tool_call_id: toolRun.tool_call_id,
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: any) {
        lastError = err.name === "AbortError" ? "Timeout" : err.message;
        if (attempt < endpoint.max_retries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
          continue;
        }
      }
    }

    await supabase.from("tool_runs").update({
      status: "failed",
      error: lastError,
      completed_at: new Date().toISOString(),
    }).eq("id", tool_run_id);

    return new Response(JSON.stringify({ error: lastError }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("execute-tool error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
