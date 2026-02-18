import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_TIMEOUT = 60_000; // 60 seconds

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
 * Parse the BROWSER_SERVICE_URL.
 * Supports both formats:
 *   wss://production-sfo.browserless.io?token=XXX
 *   wss://production-sfo.browserless.io/chromium/playwright?token=XXX
 *
 * Returns the HTTPS base URL (host only), the full path (e.g. /chromium/playwright),
 * the token, and pre-built WebSocket connect URL.
 */
function parseBrowserlessUrl(raw: string): {
  baseUrl: string;
  wsBase: string;
  path: string;
  token: string;
  connectWs: string;
} {
  let cleaned = raw.trim();

  // Determine the ws scheme for later reconstruction
  const isSecure = !cleaned.startsWith("ws://");

  // Convert to http(s) so we can parse with URL constructor
  if (cleaned.startsWith("wss://")) cleaned = "https://" + cleaned.slice(6);
  else if (cleaned.startsWith("ws://")) cleaned = "http://" + cleaned.slice(5);
  else if (!cleaned.startsWith("http")) cleaned = "https://" + cleaned;

  const parsed = new URL(cleaned);
  const token = parsed.searchParams.get("token") || "";
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const wsScheme = isSecure ? "wss" : "ws";
  const wsBase = `${wsScheme}://${parsed.host}`;

  // Preserve path (e.g. /chromium/playwright) — defaults to empty string
  const path = parsed.pathname === "/" ? "" : parsed.pathname;

  // Build the WebSocket connect URL for persistent sessions
  // If a path like /chromium/playwright is present, use it; otherwise use bare host
  const connectWs = path
    ? `${wsBase}${path}?token=${token}`
    : `${wsBase}?token=${token}`;

  return { baseUrl, wsBase, path, token, connectWs };
}

/**
 * Fetch with a timeout. Wraps native fetch to abort after `ms` milliseconds.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const ms = init.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${ms}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const rawUrl = Deno.env.get("BROWSER_SERVICE_URL");

  const url = new URL(req.url);
  const path = url.pathname.split("/browser-proxy")[1] || "/";

  // ──────────────────────────────────────────────
  // GET /health — Test connectivity to Browserless
  // No auth required so monitoring tools can hit it.
  // ──────────────────────────────────────────────
  if (path === "/health" && req.method === "GET") {
    if (!rawUrl) {
      return jsonResp(
        { status: "error", detail: "BROWSER_SERVICE_URL not configured" },
        503,
      );
    }
    let browserless: ReturnType<typeof parseBrowserlessUrl>;
    try {
      browserless = parseBrowserlessUrl(rawUrl);
    } catch {
      return jsonResp(
        { status: "error", detail: "Invalid BROWSER_SERVICE_URL" },
        500,
      );
    }
    try {
      const versionUrl = `${browserless.baseUrl}/json/version?token=${browserless.token}`;
      const resp = await fetchWithTimeout(versionUrl, { timeout: 10_000 });
      if (!resp.ok) {
        const body = await resp.text();
        return jsonResp(
          {
            status: "degraded",
            browserless_status: resp.status,
            detail: body.slice(0, 500),
          },
          502,
        );
      }
      const versionInfo = await resp.json();
      return jsonResp({
        status: "ok",
        browserless: {
          connected: true,
          version: versionInfo,
          base_url: browserless.baseUrl,
        },
      });
    } catch (err) {
      return jsonResp(
        { status: "error", detail: `Browserless unreachable: ${String(err)}` },
        502,
      );
    }
  }

  // ──────────────────────────────────────────────
  // POST /browse — Lightweight page content extraction for AI tool calls.
  // Called by the chat edge function (service-to-service), no user auth needed.
  // Accepts: { input: { url: "..." }, meta: {...} }
  // Returns: { content, title, url }
  // ──────────────────────────────────────────────
  if (path === "/browse" && req.method === "POST") {
    if (!rawUrl) {
      return jsonResp({ error: "Browser service not configured" }, 503);
    }
    let bl: ReturnType<typeof parseBrowserlessUrl>;
    try {
      bl = parseBrowserlessUrl(rawUrl);
    } catch {
      return jsonResp({ error: "Invalid BROWSER_SERVICE_URL" }, 500);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const input = (body.input as Record<string, unknown>) || body;
    const targetUrl = (input.url as string) || "";
    if (!targetUrl) {
      return jsonResp({ error: "url is required in input" }, 400);
    }

    try {
      // Use Browserless /function to navigate + extract text
      const script = `export default async function ({ page }) {
        await page.goto(${JSON.stringify(targetUrl)}, { waitUntil: "networkidle2", timeout: 25000 });
        const title = await page.title();
        const finalUrl = page.url();
        const content = await page.evaluate(() => {
          // Remove script/style/nav/header/footer for cleaner text
          const remove = document.querySelectorAll("script, style, nav, footer, header, aside, [role=navigation], [role=banner]");
          remove.forEach(el => el.remove());
          return document.body ? document.body.innerText.substring(0, 12000) : "";
        });
        return {
          data: { content, title, url: finalUrl },
          type: "application/json",
        };
      }`;

      const resp = await fetchWithTimeout(
        `${bl.baseUrl}/function?token=${bl.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/javascript" },
          body: script,
          timeout: 30_000,
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        return jsonResp({
          error: `Browser fetch failed (${resp.status})`,
          detail: errText.slice(0, 500),
        }, 502);
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const result = await resp.json();
        const data = result.data || result.result || result;
        return jsonResp({
          content: data.content || "",
          title: data.title || "",
          url: data.url || targetUrl,
          markdown_content: `# ${data.title || targetUrl}\n\nSource: ${data.url || targetUrl}\n\n${data.content || "(no content extracted)"}`,
        });
      }

      const text = await resp.text();
      return jsonResp({
        content: text.substring(0, 12000),
        title: targetUrl,
        url: targetUrl,
        markdown_content: `# ${targetUrl}\n\n${text.substring(0, 12000)}`,
      });
    } catch (err) {
      return jsonResp({
        error: `Browse failed: ${err instanceof Error ? err.message : String(err)}`,
        url: targetUrl,
      }, 502);
    }
  }

  // ── Everything below requires auth ──

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp({ error: "Unauthorized — missing or invalid Bearer token" }, 401);
  }

  const supabaseUser = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return jsonResp({ error: "Unauthorized — invalid token" }, 401);
  }
  const userId = user.id;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!rawUrl) {
    return jsonResp({ error: "Browser service not configured (BROWSER_SERVICE_URL)" }, 503);
  }

  let browserless: ReturnType<typeof parseBrowserlessUrl>;
  try {
    browserless = parseBrowserlessUrl(rawUrl);
  } catch {
    return jsonResp({ error: "Invalid BROWSER_SERVICE_URL configuration" }, 500);
  }

  try {
    // ──────────────────────────────────────────────
    // POST /start — Create a browser session
    //
    // Uses the Browserless /connect WebSocket endpoint for persistent sessions.
    // Stores the ws endpoint in session metadata so subsequent actions can
    // reconnect. Also generates a live debugger URL.
    // ──────────────────────────────────────────────
    if (path === "/start" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const loginSetup = body.login_setup === true;
      const startUrl = (body.url as string) || "about:blank";

      // Check for saved cookies
      const { data: profile } = await supabase
        .from("profiles")
        .select("browser_profile_path")
        .eq("id", userId)
        .single();
      const hasSavedCookies = !!profile?.browser_profile_path;

      // Build the persistent WebSocket connect URL
      // This is what Playwright/Puppeteer would use:
      //   browserWSEndpoint = wss://production-sfo.browserless.io?token=XXX
      // or with a path:
      //   browserWSEndpoint = wss://production-sfo.browserless.io/chromium/playwright?token=XXX
      const wsEndpoint = browserless.connectWs;

      // Live debugger URL — Browserless exposes /live on the HTTPS base
      // The launch parameter pre-fills the URL the live view connects to
      const liveUrl = `${browserless.baseUrl}/live?token=${browserless.token}`;

      // Optionally navigate to the start URL using /function so the session
      // has an initial page ready for the live debugger
      let initialTitle: string | null = null;
      if (startUrl && startUrl !== "about:blank") {
        try {
          const nav = await executeBrowserlessAction(
            browserless,
            "navigate",
            { url: startUrl },
            null,
          );
          if (nav.success && nav.data) {
            initialTitle = (nav.data as Record<string, unknown>).title as string || null;
          }
        } catch {
          // Non-fatal — session is still valid
        }
      }

      // Store session in DB
      const { data: dbSession, error: dbErr } = await supabase
        .from("browser_sessions")
        .insert({
          user_id: userId,
          status: loginSetup ? "login_setup" : "running",
          vnc_url: liveUrl,
          playwright_url: wsEndpoint,
          browser_profile_path: null,
          metadata: {
            login_setup: loginSetup,
            has_saved_cookies: hasSavedCookies,
            ws_endpoint: wsEndpoint,
            current_url: startUrl !== "about:blank" ? startUrl : null,
            initial_title: initialTitle,
            started_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (dbErr) return jsonResp({ error: `Failed to create session: ${dbErr.message}` }, 500);
      return jsonResp(dbSession);
    }

    // ──────────────────────────────────────────────
    // POST /confirm-login — User confirms they've logged in via Take Over.
    // Saves a login_confirmed timestamp. Agent resumes automation after this.
    // ──────────────────────────────────────────────
    if (path === "/confirm-login" && req.method === "POST") {
      const { session_id } = await req.json();
      if (!session_id) return jsonResp({ error: "session_id is required" }, 400);

      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, status, metadata")
        .eq("id", session_id)
        .single();

      if (!session) return jsonResp({ error: "Session not found" }, 404);

      const now = new Date().toISOString();
      const meta = (session.metadata as Record<string, unknown>) || {};

      await supabase
        .from("browser_sessions")
        .update({
          status: "running",
          metadata: {
            ...meta,
            login_confirmed: true,
            login_confirmed_at: now,
          },
        })
        .eq("id", session_id);

      return jsonResp({ confirmed: true, status: "running", login_confirmed_at: now });
    }

    // ──────────────────────────────────────────────
    // POST /save-session — Export cookies and store in DB
    // ──────────────────────────────────────────────
    if (path === "/save-session" && req.method === "POST") {
      const { session_id, cookies } = await req.json();
      if (!session_id) return jsonResp({ error: "session_id is required" }, 400);

      const cookieData = cookies
        ? JSON.stringify(cookies)
        : JSON.stringify({ saved_at: new Date().toISOString() });

      await supabase
        .from("profiles")
        .update({ browser_profile_path: cookieData })
        .eq("id", userId);

      // Preserve existing metadata when updating
      const { data: session } = await supabase
        .from("browser_sessions")
        .select("metadata")
        .eq("id", session_id)
        .single();

      const existingMeta = (session?.metadata as Record<string, unknown>) || {};

      await supabase
        .from("browser_sessions")
        .update({
          status: "running",
          metadata: {
            ...existingMeta,
            login_saved: true,
            saved_at: new Date().toISOString(),
          },
        })
        .eq("id", session_id);

      return jsonResp({ saved: true });
    }

    // ──────────────────────────────────────────────
    // POST /action — Execute a browser action
    //
    // Uses the Browserless /function endpoint with a reconnect pattern:
    // each action navigates to the last known URL first (from
    // session metadata.current_url), performs the action, then
    // updates metadata.current_url with the final page URL.
    // ──────────────────────────────────────────────
    if (path === "/action" && req.method === "POST") {
      const body = await req.json();
      const { session_id, task_id, action_type, parameters, requires_approval } = body;

      if (!session_id) return jsonResp({ error: "session_id is required" }, 400);
      if (!action_type) return jsonResp({ error: "action_type is required" }, 400);

      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, status, playwright_url, metadata")
        .eq("id", session_id)
        .single();

      if (!session) return jsonResp({ error: "Session not found" }, 404);

      // Block automation while waiting for login
      if (session.status === "login_setup") {
        return jsonResp(
          {
            error:
              "Session is waiting for login confirmation. User must complete login via Take Over and click 'I'm Logged In'.",
            awaiting_login: true,
          },
          409,
        );
      }

      const initialStatus = requires_approval ? "awaiting_approval" : "pending";

      const { data: action, error: actionErr } = await supabase
        .from("browser_actions")
        .insert({
          task_id: task_id || null,
          session_id,
          user_id: userId,
          action_type,
          parameters: parameters || {},
          status: initialStatus,
        })
        .select()
        .single();

      if (actionErr) return jsonResp({ error: `Failed to create action: ${actionErr.message}` }, 500);

      // If approval is required, stop here
      if (requires_approval) {
        await supabase.from("browser_approvals").insert({
          action_id: action.id,
          user_id: userId,
          status: "pending",
        });
        return jsonResp({ ...action, awaiting_approval: true });
      }

      // Execute with reconnect: use current_url from session metadata
      const meta = (session.metadata as Record<string, unknown>) || {};
      const currentUrl = (meta.current_url as string) || null;

      const result = await executeBrowserlessAction(
        browserless,
        action_type,
        parameters || {},
        currentUrl,
      );

      // Update the session's current_url with the final page URL
      if (result.final_url) {
        await supabase
          .from("browser_sessions")
          .update({
            metadata: {
              ...meta,
              current_url: result.final_url,
              last_action_at: new Date().toISOString(),
            },
          })
          .eq("id", session_id);
      }

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
        final_url: result.final_url || null,
        error: result.error || null,
      });
    }

    // ──────────────────────────────────────────────
    // POST /approve — Approve or reject a pending action
    // ──────────────────────────────────────────────
    if (path === "/approve" && req.method === "POST") {
      const { action_id, approved, reason } = await req.json();
      if (!action_id) return jsonResp({ error: "action_id is required" }, 400);

      const newStatus = approved ? "approved" : "rejected";

      await supabase
        .from("browser_approvals")
        .update({
          status: newStatus,
          reason: reason || null,
          resolved_at: new Date().toISOString(),
        })
        .eq("action_id", action_id);

      const { data: action } = await supabase
        .from("browser_actions")
        .select("*, browser_sessions!inner(metadata)")
        .eq("id", action_id)
        .single();

      if (!action) return jsonResp({ error: "Action not found" }, 404);

      if (approved) {
        await supabase
          .from("browser_actions")
          .update({ status: "executing" })
          .eq("id", action_id);

        // Get the session's current_url for reconnect
        const sessionMeta =
          (action.browser_sessions as unknown as { metadata: Record<string, unknown> })
            ?.metadata || {};
        const currentUrl = (sessionMeta.current_url as string) || null;

        const result = await executeBrowserlessAction(
          browserless,
          action.action_type,
          action.parameters as Record<string, unknown>,
          currentUrl,
        );

        // Update session current_url
        if (result.final_url && action.session_id) {
          const { data: sess } = await supabase
            .from("browser_sessions")
            .select("metadata")
            .eq("id", action.session_id)
            .single();
          const meta = (sess?.metadata as Record<string, unknown>) || {};
          await supabase
            .from("browser_sessions")
            .update({
              metadata: {
                ...meta,
                current_url: result.final_url,
                last_action_at: new Date().toISOString(),
              },
            })
            .eq("id", action.session_id);
        }

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

        return jsonResp({
          approved: true,
          result: result.data,
          final_url: result.final_url || null,
        });
      } else {
        await supabase
          .from("browser_actions")
          .update({ status: "rejected", completed_at: new Date().toISOString() })
          .eq("id", action_id);
        return jsonResp({ approved: false, reason });
      }
    }

    // ──────────────────────────────────────────────
    // GET /screenshot — Take a screenshot of the current page
    //
    // Uses current_url from session metadata so we screenshot
    // whatever page the session last navigated to.
    // ──────────────────────────────────────────────
    if (path === "/screenshot" && req.method === "GET") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) return jsonResp({ error: "session_id query parameter is required" }, 400);

      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, metadata")
        .eq("id", sessionId)
        .single();

      if (!session) return jsonResp({ error: "Session not found" }, 404);

      const meta = (session.metadata as Record<string, unknown>) || {};
      const targetUrl = (meta.current_url as string) || "about:blank";

      if (targetUrl === "about:blank") {
        return jsonResp(
          { error: "No page has been navigated to yet in this session" },
          400,
        );
      }

      try {
        const screenshotResp = await fetchWithTimeout(
          `${browserless.baseUrl}/screenshot?token=${browserless.token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: targetUrl,
              options: { fullPage: false, type: "png" },
            }),
            timeout: DEFAULT_TIMEOUT,
          },
        );

        if (!screenshotResp.ok) {
          const errText = await screenshotResp.text();
          return jsonResp(
            {
              error: `Browserless screenshot failed (${screenshotResp.status}): ${errText.slice(0, 500)}`,
              target_url: targetUrl,
            },
            screenshotResp.status >= 500 ? 502 : screenshotResp.status,
          );
        }

        const imageBlob = await screenshotResp.blob();
        return new Response(imageBlob, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/png",
            "Cache-Control": "no-cache",
          },
        });
      } catch (err) {
        return jsonResp(
          { error: `Screenshot request failed: ${String(err)}`, target_url: targetUrl },
          502,
        );
      }
    }

    // ──────────────────────────────────────────────
    // POST /stop — Close/stop a session
    // ──────────────────────────────────────────────
    if (path === "/stop" && req.method === "POST") {
      const { session_id } = await req.json();
      if (!session_id) return jsonResp({ error: "session_id is required" }, 400);

      const { data: session } = await supabase
        .from("browser_sessions")
        .select("id, metadata")
        .eq("id", session_id)
        .single();

      if (!session) return jsonResp({ error: "Session not found" }, 404);

      const meta = (session.metadata as Record<string, unknown>) || {};

      await supabase
        .from("browser_sessions")
        .update({
          status: "stopped",
          stopped_at: new Date().toISOString(),
          metadata: {
            ...meta,
            stopped_at: new Date().toISOString(),
          },
        })
        .eq("id", session_id);

      return jsonResp({ stopped: true });
    }

    // ──────────────────────────────────────────────
    // POST /task — Create a browser task
    // ──────────────────────────────────────────────
    if (path === "/task" && req.method === "POST") {
      const { session_id, description } = await req.json();
      if (!session_id) return jsonResp({ error: "session_id is required" }, 400);
      if (!description) return jsonResp({ error: "description is required" }, 400);

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

      if (error) return jsonResp({ error: `Failed to create task: ${error.message}` }, 500);
      return jsonResp(task);
    }

    return jsonResp({ error: `Not found: ${req.method} ${path}` }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[browser-proxy] Unhandled error on ${path}:`, message);
    return jsonResp({ error: `Internal error: ${message}` }, 500);
  }
});

// ═══════════════════════════════════════════════════════
// Browserless /function execution with reconnect pattern
// ═══════════════════════════════════════════════════════

interface ActionResult {
  success: boolean;
  data?: unknown;
  screenshot_url?: string;
  error?: string;
  final_url?: string;
}

/**
 * Execute a browser action using the Browserless /function API.
 *
 * Reconnect pattern: because free-plan edge functions cannot hold a persistent
 * WebSocket connection, each call to /function spins up a fresh browser context.
 * To maintain continuity we:
 *   1. Navigate to `currentUrl` first (the last known page URL from session metadata).
 *   2. Perform the requested action.
 *   3. Return the final page URL so the caller can persist it.
 */
async function executeBrowserlessAction(
  browserless: ReturnType<typeof parseBrowserlessUrl>,
  actionType: string,
  parameters: Record<string, unknown>,
  currentUrl: string | null,
): Promise<ActionResult> {
  try {
    const script = buildActionScript(actionType, parameters, currentUrl);

    const resp = await fetchWithTimeout(
      `${browserless.baseUrl}/function?token=${browserless.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/javascript" },
        body: script,
        timeout: DEFAULT_TIMEOUT,
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        success: false,
        error: `Browserless /function returned ${resp.status}: ${errText.slice(0, 1000)}`,
      };
    }

    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await resp.json();
      return {
        success: true,
        data: data.result ?? data,
        final_url: data.final_url ?? (data.result?.url as string) ?? null,
        screenshot_url: data.screenshot_url ?? null,
      };
    }

    // Some endpoints return plain text
    const text = await resp.text();
    return { success: true, data: { raw: text } };
  } catch (err) {
    return {
      success: false,
      error: `Action execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build a Puppeteer script for the Browserless /function endpoint.
 *
 * Every script follows the reconnect pattern:
 *   1. If `currentUrl` is provided and the action is NOT a navigate, go there first.
 *   2. Perform the action.
 *   3. Return `{ result: ..., final_url: page.url() }` so the session URL is tracked.
 */
function buildActionScript(
  actionType: string,
  params: Record<string, unknown>,
  currentUrl: string | null,
): string {
  // Helper: navigation preamble that restores the last known page
  const reconnectPreamble = (skipForNavigate: boolean) => {
    if (skipForNavigate || !currentUrl) return "";
    return `
        // Reconnect: navigate to last known URL first
        await page.goto(${JSON.stringify(currentUrl)}, {
          waitUntil: "networkidle2",
          timeout: 30000,
        }).catch(() => {});
    `;
  };

  switch (actionType) {
    case "navigate":
      return `export default async function ({ page }) {
        const targetUrl = ${JSON.stringify(params.url || "about:blank")};
        await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 45000 });
        const title = await page.title();
        const finalUrl = page.url();
        return {
          data: { title, url: finalUrl, navigated: true },
          type: "application/json",
        };
      }`;

    case "click":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "body")};
        await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
        await page.click(selector);
        // Wait for any navigation or network activity triggered by the click
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
        const finalUrl = page.url();
        const title = await page.title();
        return {
          data: { clicked: selector, title, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "type":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "input")};
        const text = ${JSON.stringify(params.text || "")};
        await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
        // Clear existing value first if requested
        ${params.clear ? `await page.click(selector, { clickCount: 3 }); await page.keyboard.press("Backspace");` : ""}
        await page.type(selector, text, { delay: ${params.delay || 50} });
        const finalUrl = page.url();
        return {
          data: { typed: true, selector, length: text.length, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "screenshot":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const screenshot = await page.screenshot({ encoding: "base64", fullPage: ${!!params.full_page} });
        const finalUrl = page.url();
        const title = await page.title();
        return {
          data: { screenshot, title, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "extract":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "body")};
        await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
        const content = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? el.innerText : null;
        }, selector);
        const finalUrl = page.url();
        const title = await page.title();
        return {
          data: { content, selector, title, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "evaluate":
      // Run arbitrary JS in the page context
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const result = await page.evaluate(() => {
          ${params.expression || "return document.title;"}
        });
        const finalUrl = page.url();
        return {
          data: { result, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "wait":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "body")};
        const ms = ${Number(params.ms) || 2000};
        if (selector !== "body") {
          await page.waitForSelector(selector, { timeout: ms });
        } else {
          await new Promise(r => setTimeout(r, ms));
        }
        const finalUrl = page.url();
        return {
          data: { waited: true, selector, ms, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "select":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "select")};
        const value = ${JSON.stringify(params.value || "")};
        await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
        await page.select(selector, value);
        const finalUrl = page.url();
        return {
          data: { selected: true, selector, value, url: finalUrl },
          type: "application/json",
        };
      }`;

    case "scroll":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const direction = ${JSON.stringify(params.direction || "down")};
        const amount = ${Number(params.amount) || 500};
        await page.evaluate((dir, px) => {
          if (dir === "down") window.scrollBy(0, px);
          else if (dir === "up") window.scrollBy(0, -px);
          else if (dir === "left") window.scrollBy(-px, 0);
          else if (dir === "right") window.scrollBy(px, 0);
        }, direction, amount);
        // Small delay for lazy-loaded content
        await new Promise(r => setTimeout(r, 500));
        const finalUrl = page.url();
        return {
          data: { scrolled: true, direction, amount, url: finalUrl },
          type: "application/json",
        };
      }`;

    default:
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const finalUrl = page.url();
        return {
          data: { error: "Unknown action type: ${actionType}", url: finalUrl },
          type: "application/json",
        };
      }`;
  }
}
