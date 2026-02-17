import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Parse the BROWSER_SERVICE_URL which is a Browserless WSS URL like:
 * wss://production-sfo.browserless.io?token=abc123
 * We extract the base HTTP URL and token from it.
 */
function parseBrowserlessUrl(raw: string): { baseUrl: string; token: string } {
  // Normalize: strip wss:// or ws:// and use https://
  let cleaned = raw.trim();
  if (cleaned.startsWith("wss://")) cleaned = "https://" + cleaned.slice(6);
  else if (cleaned.startsWith("ws://")) cleaned = "http://" + cleaned.slice(5);
  else if (!cleaned.startsWith("http")) cleaned = "https://" + cleaned;

  const parsed = new URL(cleaned);
  const token = parsed.searchParams.get("token") || "";
  // Base URL without query params
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  return { baseUrl, token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const userId = claimsData.claims.sub as string;
  const rawUrl = Deno.env.get("BROWSER_SERVICE_URL");

  if (!rawUrl) {
    return jsonResp({ error: "Browser service not configured" }, 503);
  }

  let browserless: { baseUrl: string; token: string };
  try {
    browserless = parseBrowserlessUrl(rawUrl);
  } catch {
    return jsonResp({ error: "Invalid BROWSER_SERVICE_URL configuration" }, 500);
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/browser-proxy")[1] || "/";

  try {
    // ──────────────────────────────────────────────
    // POST /start — Create a Browserless session
    // ──────────────────────────────────────────────
    if (path === "/start" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const loginSetup = body.login_setup === true;

      // Check if user has existing profile path (for session persistence)
      const { data: profile } = await supabase
        .from("profiles")
        .select("browser_profile_path")
        .eq("id", userId)
        .single();

      const profilePath = `~/profiles/${userId}`;
      const userDataDir = profile?.browser_profile_path || profilePath;

      // Create a Browserless persistent session via Sessions API
      const sessionResp = await fetch(
        `${browserless.baseUrl}/session?token=${browserless.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            headless: false,
            ttl: 86400000, // 24 hours persistence
            args: [`--user-data-dir=${userDataDir}`],
          }),
        }
      );

      if (!sessionResp.ok) {
        const errText = await sessionResp.text();
        return jsonResp({ error: `Browserless session creation failed: ${errText}` }, sessionResp.status);
      }

      const sessionData = await sessionResp.json();
      // sessionData contains: { browserWSEndpoint, browserQLEndpoint, ... }

      // Derive live debugger URL
      const wsEndpoint = sessionData.browserWSEndpoint || "";
      const liveUrl = wsEndpoint
        ? `${browserless.baseUrl}/live/?${new URLSearchParams({ token: browserless.token }).toString()}`
        : null;

      // Store session in DB
      const { data: dbSession, error: dbErr } = await supabase
        .from("browser_sessions")
        .insert({
          user_id: userId,
          status: loginSetup ? "login_setup" : "running",
          vnc_url: liveUrl,
          playwright_url: wsEndpoint,
          browser_profile_path: userDataDir,
          last_worker_endpoint: wsEndpoint,
          metadata: {
            browserless_session: sessionData,
            login_setup: loginSetup,
          },
        })
        .select()
        .single();

      if (dbErr) {
        return jsonResp({ error: dbErr.message }, 500);
      }

      // Save profile path for future sessions
      if (!profile?.browser_profile_path) {
        await supabase
          .from("profiles")
          .update({ browser_profile_path: userDataDir })
          .eq("id", userId);
      }

      return jsonResp(dbSession);
    }

    // ──────────────────────────────────────────────
    // POST /action — Execute a browser action via /function API
    // ──────────────────────────────────────────────
    if (path === "/action" && req.method === "POST") {
      const body = await req.json();
      const { session_id, task_id, action_type, parameters, requires_approval } = body;

      // Verify session exists
      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, status, playwright_url, metadata")
        .eq("id", session_id)
        .single();

      if (!session) {
        return jsonResp({ error: "Session not found" }, 404);
      }

      const initialStatus = requires_approval ? "awaiting_approval" : "pending";

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
        return jsonResp({ error: actionErr.message }, 500);
      }

      if (requires_approval) {
        await supabase.from("browser_approvals").insert({
          action_id: action.id,
          user_id: userId,
          status: "pending",
        });
        return jsonResp({ ...action, awaiting_approval: true });
      }

      // Execute via Browserless /function API
      const result = await executeBrowserlessAction(
        browserless,
        session.playwright_url,
        action_type,
        parameters || {}
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
        .eq("id", action.id);

      return jsonResp({
        ...action,
        status: result.success ? "completed" : "failed",
        result: result.data,
      });
    }

    // ──────────────────────────────────────────────
    // POST /approve — Approve or reject a pending action
    // ──────────────────────────────────────────────
    if (path === "/approve" && req.method === "POST") {
      const { action_id, approved, reason } = await req.json();
      const newStatus = approved ? "approved" : "rejected";

      await supabase
        .from("browser_approvals")
        .update({ status: newStatus, reason, resolved_at: new Date().toISOString() })
        .eq("action_id", action_id);

      const { data: action } = await supabase
        .from("browser_actions")
        .select("*, session:browser_sessions(playwright_url)")
        .eq("id", action_id)
        .single();

      if (!action) {
        return jsonResp({ error: "Action not found" }, 404);
      }

      if (approved) {
        await supabase.from("browser_actions").update({ status: "executing" }).eq("id", action_id);

        const result = await executeBrowserlessAction(
          browserless,
          (action as any).session?.playwright_url,
          action.action_type,
          action.parameters as Record<string, unknown>
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

        return jsonResp({ approved: true, result: result.data });
      } else {
        await supabase
          .from("browser_actions")
          .update({ status: "rejected", completed_at: new Date().toISOString() })
          .eq("id", action_id);
        return jsonResp({ approved: false, reason });
      }
    }

    // ──────────────────────────────────────────────
    // GET /screenshot — Take a screenshot via Browserless REST API
    // ──────────────────────────────────────────────
    if (path === "/screenshot" && req.method === "GET") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) {
        return jsonResp({ error: "session_id required" }, 400);
      }

      // Get the session's current page URL from metadata
      const { data: session } = await supabase
        .from("browser_sessions")
        .select("metadata, playwright_url")
        .eq("id", sessionId)
        .single();

      // Use the Browserless /screenshot REST API
      const targetUrl = (session?.metadata as any)?.current_url || "about:blank";
      const screenshotResp = await fetch(
        `${browserless.baseUrl}/screenshot?token=${browserless.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: targetUrl,
            options: { fullPage: false, type: "png" },
          }),
        }
      );

      if (!screenshotResp.ok) {
        const errText = await screenshotResp.text();
        return jsonResp({ error: errText }, screenshotResp.status);
      }

      const imageBlob = await screenshotResp.blob();
      return new Response(imageBlob, {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ──────────────────────────────────────────────
    // POST /stop — Close session
    // ──────────────────────────────────────────────
    if (path === "/stop" && req.method === "POST") {
      const { session_id } = await req.json();

      // Get session metadata to find Browserless session ID
      const { data: session } = await supabase
        .from("browser_sessions")
        .select("metadata")
        .eq("id", session_id)
        .single();

      const blSession = (session?.metadata as any)?.browserless_session;

      // If there's a Browserless session, try to close it (only if NOT saving)
      if (blSession?.browserWSEndpoint) {
        // Disconnect gracefully — Browserless keeps session data persisted
        // We don't need to do anything special, the session TTL handles cleanup
      }

      await supabase
        .from("browser_sessions")
        .update({ status: "stopped", stopped_at: new Date().toISOString() })
        .eq("id", session_id);

      return jsonResp({ stopped: true });
    }

    // ──────────────────────────────────────────────
    // POST /task — Create a task
    // ──────────────────────────────────────────────
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
        return jsonResp({ error: error.message }, 500);
      }

      return jsonResp(task);
    }

    // ──────────────────────────────────────────────
    // POST /save-session — Mark session as saved (login persisted)
    // ──────────────────────────────────────────────
    if (path === "/save-session" && req.method === "POST") {
      const { session_id } = await req.json();

      // The Browserless session with --user-data-dir already persists cookies/localStorage.
      // We just update our DB to reflect the login is saved.
      await supabase
        .from("browser_sessions")
        .update({
          status: "running",
          metadata: {
            login_saved: true,
            saved_at: new Date().toISOString(),
          },
        })
        .eq("id", session_id);

      return jsonResp({ saved: true });
    }

    return jsonResp({ error: "Not found" }, 404);
  } catch (err) {
    return jsonResp({ error: String(err) }, 500);
  }
});

/**
 * Execute a browser action using Browserless /function API.
 * Sends a Puppeteer-compatible script that performs the action.
 */
async function executeBrowserlessAction(
  browserless: { baseUrl: string; token: string },
  _wsEndpoint: string | null,
  actionType: string,
  parameters: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; screenshot_url?: string; error?: string }> {
  try {
    // Build a Puppeteer script that runs on Browserless
    const script = buildActionScript(actionType, parameters);

    const resp = await fetch(
      `${browserless.baseUrl}/function?token=${browserless.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/javascript" },
        body: script,
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return { success: false, error: errText };
    }

    const data = await resp.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Build a Puppeteer-compatible script string for the Browserless /function endpoint.
 */
function buildActionScript(actionType: string, params: Record<string, unknown>): string {
  switch (actionType) {
    case "navigate":
      return `export default async function ({ page }) {
        await page.goto(${JSON.stringify(params.url || "about:blank")}, { waitUntil: "networkidle2" });
        const title = await page.title();
        return { data: { title, url: page.url() }, type: "application/json" };
      }`;

    case "click":
      return `export default async function ({ page }) {
        await page.goto(${JSON.stringify(params.url || "about:blank")}, { waitUntil: "networkidle2" });
        await page.click(${JSON.stringify(params.selector || "body")});
        return { data: { clicked: ${JSON.stringify(params.selector)} }, type: "application/json" };
      }`;

    case "type":
      return `export default async function ({ page }) {
        await page.goto(${JSON.stringify(params.url || "about:blank")}, { waitUntil: "networkidle2" });
        await page.type(${JSON.stringify(params.selector || "input")}, ${JSON.stringify(params.text || "")});
        return { data: { typed: true }, type: "application/json" };
      }`;

    case "screenshot":
      return `export default async function ({ page }) {
        await page.goto(${JSON.stringify(params.url || "about:blank")}, { waitUntil: "networkidle2" });
        const screenshot = await page.screenshot({ encoding: "base64" });
        return { data: { screenshot }, type: "application/json" };
      }`;

    case "extract":
      return `export default async function ({ page }) {
        await page.goto(${JSON.stringify(params.url || "about:blank")}, { waitUntil: "networkidle2" });
        const content = await page.evaluate(() => document.body.innerText);
        return { data: { content }, type: "application/json" };
      }`;

    default:
      return `export default async function ({ page }) {
        return { data: { error: "Unknown action type: ${actionType}" }, type: "application/json" };
      }`;
  }
}
