import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = claimsData.claims.sub as string;
  const BROWSER_URL = Deno.env.get("BROWSER_SERVICE_URL");

  if (!BROWSER_URL) {
    return new Response(
      JSON.stringify({ error: "Browser service not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/browser-proxy")[1] || "/";

  try {
    // Route: POST /start
    if (path === "/start" && req.method === "POST") {
      // Call external Playwright service
      const extResp = await fetch(`${BROWSER_URL}/browser/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const extData = await extResp.json();

      if (!extResp.ok) {
        return new Response(JSON.stringify({ error: extData.error || "Failed to start session" }), {
          status: extResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store session in DB
      const { data: session, error } = await supabase
        .from("browser_sessions")
        .insert({
          user_id: userId,
          status: "running",
          vnc_url: extData.vnc_url || null,
          playwright_url: extData.playwright_url || null,
          metadata: extData.metadata || {},
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(session), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: POST /action
    if (path === "/action" && req.method === "POST") {
      const body = await req.json();
      const { session_id, task_id, action_type, parameters, requires_approval } = body;

      // Verify session ownership
      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, status")
        .eq("id", session_id)
        .single();

      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const initialStatus = requires_approval ? "awaiting_approval" : "pending";

      // Create action record
      const { data: action, error: actionErr } = await supabase
        .from("browser_actions")
        .insert({
          task_id,
          session_id,
          user_id: userId,
          action_type,
          parameters: parameters || {},
          status: initialStatus,
        })
        .select()
        .single();

      if (actionErr) {
        return new Response(JSON.stringify({ error: actionErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If requires approval, create approval record and return
      if (requires_approval) {
        await supabase.from("browser_approvals").insert({
          action_id: action.id,
          user_id: userId,
          status: "pending",
        });

        return new Response(JSON.stringify({ ...action, awaiting_approval: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Otherwise execute immediately
      const result = await executeAction(BROWSER_URL, session_id, action_type, parameters);

      await supabase
        .from("browser_actions")
        .update({
          status: result.success ? "completed" : "failed",
          result: result.data || null,
          screenshot_url: result.screenshot_url || null,
          error: result.error || null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", action.id);

      return new Response(
        JSON.stringify({ ...action, status: result.success ? "completed" : "failed", result: result.data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /approve
    if (path === "/approve" && req.method === "POST") {
      const { action_id, approved, reason } = await req.json();

      const newStatus = approved ? "approved" : "rejected";

      // Update approval
      await supabase
        .from("browser_approvals")
        .update({ status: newStatus, reason, resolved_at: new Date().toISOString() })
        .eq("action_id", action_id);

      // Get the action
      const { data: action } = await supabase
        .from("browser_actions")
        .select("*")
        .eq("id", action_id)
        .single();

      if (!action) {
        return new Response(JSON.stringify({ error: "Action not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (approved) {
        // Execute the action now
        await supabase
          .from("browser_actions")
          .update({ status: "executing" })
          .eq("id", action_id);

        const result = await executeAction(
          BROWSER_URL,
          action.session_id,
          action.action_type,
          action.parameters
        );

        await supabase
          .from("browser_actions")
          .update({
            status: result.success ? "completed" : "failed",
            result: result.data || null,
            screenshot_url: result.screenshot_url || null,
            error: result.error || null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", action_id);

        return new Response(JSON.stringify({ approved: true, result: result.data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        await supabase
          .from("browser_actions")
          .update({ status: "rejected", completed_at: new Date().toISOString() })
          .eq("id", action_id);

        return new Response(JSON.stringify({ approved: false, reason }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Route: GET /screenshot
    if (path === "/screenshot" && req.method === "GET") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "session_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const extResp = await fetch(
        `${BROWSER_URL}/browser/screenshot?session_id=${sessionId}`
      );

      if (!extResp.ok) {
        const errText = await extResp.text();
        return new Response(JSON.stringify({ error: errText }), {
          status: extResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imageBlob = await extResp.blob();
      return new Response(imageBlob, {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Route: POST /stop
    if (path === "/stop" && req.method === "POST") {
      const { session_id } = await req.json();

      await fetch(`${BROWSER_URL}/browser/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id }),
      });

      await supabase
        .from("browser_sessions")
        .update({ status: "stopped", stopped_at: new Date().toISOString() })
        .eq("id", session_id);

      return new Response(JSON.stringify({ stopped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Route: POST /task
    if (path === "/task" && req.method === "POST") {
      const { session_id, description } = await req.json();

      const { data: task, error } = await supabase
        .from("browser_tasks")
        .insert({
          session_id,
          user_id: userId,
          description,
          status: "pending",
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(task), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function executeAction(
  browserUrl: string,
  sessionId: string,
  actionType: string,
  parameters: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; screenshot_url?: string; error?: string }> {
  try {
    const resp = await fetch(`${browserUrl}/browser/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        action: actionType,
        ...parameters,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: errText };
    }

    const data = await resp.json();
    return { success: true, data, screenshot_url: data.screenshot_url };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
