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

// ═══════════════════════════════════════════════════════
// Self-Healing: Error Classification
// ═══════════════════════════════════════════════════════

type ErrorClass =
  | 'element_not_found'
  | 'navigation_timeout'
  | 'login_required'
  | 'session_expired'
  | 'captcha_detected'
  | 'modal_blocking'
  | 'page_error'
  | 'unknown';

interface ErrorClassification {
  error_class: ErrorClass;
  confidence: number;
  details: string;
}

function classifyError(
  error: string,
  pageUrl?: string,
  domSnippet?: string,
): ErrorClassification {
  const lower = error.toLowerCase();
  const urlLower = (pageUrl || '').toLowerCase();
  const domLower = (domSnippet || '').toLowerCase();

  // Element not found
  if (lower.includes('waiting for selector') ||
      lower.includes('no node found') ||
      lower.includes('failed to find') ||
      lower.includes('element not found') ||
      lower.includes('cannot find') ||
      lower.includes('null is not an object') ||
      lower.includes('cannot read properties of null')) {
    return { error_class: 'element_not_found', confidence: 0.95, details: error };
  }

  // Navigation timeout
  if (lower.includes('timeout') && (lower.includes('navigation') || lower.includes('goto') || lower.includes('page.goto') || lower.includes('timed out'))) {
    return { error_class: 'navigation_timeout', confidence: 0.9, details: error };
  }

  // Login required (URL-based)
  if (urlLower.includes('/login') || urlLower.includes('/signin') ||
      urlLower.includes('/auth') || urlLower.includes('/sso') ||
      urlLower.includes('accounts.google') || urlLower.includes('login.microsoftonline')) {
    return { error_class: 'login_required', confidence: 0.85, details: `Redirected to login: ${pageUrl}` };
  }

  // Session expired (DOM-based)
  if (domLower.includes('please log in') || domLower.includes('sign in to continue') ||
      domLower.includes('session expired') || domLower.includes('your session has ended') ||
      domLower.includes('sesi tamat') || domLower.includes('sila log masuk')) {
    return { error_class: 'session_expired', confidence: 0.85, details: 'Session indicators in page content' };
  }

  // CAPTCHA detection
  if (domLower.includes('captcha') || domLower.includes('recaptcha') ||
      domLower.includes('hcaptcha') || domLower.includes('cf-challenge') ||
      domLower.includes('challenge-platform') || domLower.includes('turnstile')) {
    return { error_class: 'captcha_detected', confidence: 0.9, details: 'CAPTCHA element detected' };
  }

  // Modal blocking
  if ((domLower.includes('modal') && domLower.includes('overlay')) ||
      (domLower.includes('dialog') && domLower.includes('backdrop'))) {
    return { error_class: 'modal_blocking', confidence: 0.7, details: 'Modal/overlay detected in DOM' };
  }

  // Page error (4xx/5xx indicators)
  if (lower.includes('404') || lower.includes('not found') ||
      lower.includes('500') || lower.includes('internal server error')) {
    return { error_class: 'page_error', confidence: 0.75, details: error };
  }

  return { error_class: 'unknown', confidence: 0.3, details: error };
}

// ═══════════════════════════════════════════════════════
// Self-Healing: Page Diagnosis via LLM
// ═══════════════════════════════════════════════════════

interface PageDiagnosis {
  suggested_selector: string | null;
  page_state: string;
  error_class: ErrorClass;
  confidence: number;
  dismiss_action?: { action: string; selector: string };
}

async function diagnosePage(
  browserless: ReturnType<typeof parseBrowserlessUrl>,
  currentUrl: string | null,
  originalSelector: string,
  originalAction: string,
  errorMessage: string,
): Promise<PageDiagnosis> {
  // 1. Get DOM snapshot + blocker detection in a single /function call
  const diagScript = `export default async function ({ page }) {
    ${currentUrl ? `await page.goto(${JSON.stringify(currentUrl)}, { waitUntil: "networkidle2", timeout: 12000 }).catch(() => {});` : ''}

    const screenshot = await page.screenshot({ encoding: "base64", fullPage: false }).catch(() => null);
    const finalUrl = page.url();

    // Compact DOM snapshot
    const dom = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, svg, noscript, link[rel=stylesheet], iframe').forEach(e => e.remove());
      clone.querySelectorAll('*').forEach(e => {
        for (const attr of [...e.attributes]) {
          if (attr.name.startsWith('data-') && !['data-testid','data-id','data-name','data-value','data-action','data-type'].includes(attr.name)) {
            e.removeAttribute(attr.name);
          }
          if (['style','class'].includes(attr.name) && attr.value.length > 50) {
            e.setAttribute(attr.name, attr.value.substring(0, 50));
          }
        }
      });
      return clone.innerHTML.substring(0, 6000);
    });

    // Detect common blocking elements
    const blockers = await page.evaluate(() => {
      const modals = document.querySelectorAll('[class*="modal"], [class*="overlay"], [role="dialog"], .modal, .popup, .cookie-consent');
      const captchas = document.querySelectorAll('[class*="captcha"], [class*="recaptcha"], iframe[src*="captcha"]');
      const loginForms = document.querySelectorAll('form[action*="login"], form[action*="signin"], input[type="password"]');
      return {
        hasModal: modals.length > 0,
        hasCaptcha: captchas.length > 0,
        hasLoginForm: loginForms.length > 0,
        modalSelectors: [...modals].slice(0, 3).map(m => {
          const close = m.querySelector('[class*="close"], [aria-label*="close"], [aria-label*="Close"], button:last-child, .close, .dismiss');
          return close ? {
            modal: m.className || m.tagName,
            closeSelector: close.id ? '#' + close.id : (close.getAttribute('aria-label') ? '[aria-label="' + close.getAttribute('aria-label') + '"]' : close.tagName.toLowerCase() + (close.className ? '.' + close.className.split(' ')[0] : ''))
          } : null;
        }).filter(Boolean),
      };
    });

    return {
      data: { dom, screenshot, finalUrl, blockers },
      type: "application/json",
    };
  }`;

  try {
    const diagResp = await fetchWithTimeout(
      `${browserless.baseUrl}/function?token=${browserless.token}`,
      { method: "POST", headers: { "Content-Type": "application/javascript" }, body: diagScript, timeout: 12000 },
    );

    if (!diagResp.ok) {
      return { suggested_selector: null, page_state: 'Diagnosis fetch failed', error_class: 'unknown', confidence: 0 };
    }

    const diagRaw = await diagResp.json();
    const diagData = diagRaw.data || diagRaw.result || diagRaw;
    const dom = (diagData.dom as string) || '';
    const finalUrl = (diagData.finalUrl as string) || '';
    const blockers = (diagData.blockers as Record<string, unknown>) || {};

    // 2. Quick classification (no LLM needed)
    if (blockers.hasCaptcha) {
      return { suggested_selector: null, page_state: 'CAPTCHA present', error_class: 'captcha_detected', confidence: 0.95 };
    }
    if (blockers.hasLoginForm && finalUrl !== currentUrl) {
      return { suggested_selector: null, page_state: `Redirected to login: ${finalUrl}`, error_class: 'login_required', confidence: 0.9 };
    }
    if (blockers.hasModal) {
      const modalInfo = (blockers.modalSelectors as Array<Record<string, string>>)?.[0];
      return {
        suggested_selector: null,
        page_state: 'Modal/overlay blocking interaction',
        error_class: 'modal_blocking',
        confidence: 0.85,
        dismiss_action: modalInfo?.closeSelector ? { action: 'click', selector: modalInfo.closeSelector } : undefined,
      };
    }

    // 3. Call Gemini to analyze DOM and suggest new selector
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return { suggested_selector: null, page_state: 'No GEMINI_API_KEY for healing', error_class: 'element_not_found', confidence: 0.5 };
    }

    const llmMessages = [
      {
        role: "system",
        content: `You are a browser automation expert. Given a DOM snapshot and a failed action, suggest the correct CSS selector.
Respond with ONLY a JSON object: {"selector":"...","reasoning":"...","error_class":"element_not_found|login_required|session_expired|modal_blocking|page_error"}
If no suitable selector exists (e.g. the element truly doesn't exist on this page), set selector to null.`
      },
      {
        role: "user",
        content: `The action "${originalAction}" with selector "${originalSelector}" failed: "${errorMessage}"

Current URL: ${finalUrl}

DOM snapshot (trimmed):
\`\`\`html
${dom.substring(0, 4000)}
\`\`\`

Find the correct CSS selector for the intended element, or classify why the action failed.`
      }
    ];

    const llmResp = await fetchWithTimeout(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: llmMessages,
          response_format: { type: "json_object" },
        }),
        timeout: 10000,
      },
    );

    if (!llmResp.ok) {
      return { suggested_selector: null, page_state: 'LLM analysis failed', error_class: 'element_not_found', confidence: 0.5 };
    }

    const llmResult = await llmResp.json();
    const content = llmResult.choices?.[0]?.message?.content || '{}';
    try {
      const parsed = JSON.parse(content);
      return {
        suggested_selector: parsed.selector || null,
        page_state: parsed.reasoning || '',
        error_class: (parsed.error_class as ErrorClass) || 'element_not_found',
        confidence: parsed.selector ? 0.75 : 0.5,
      };
    } catch {
      return { suggested_selector: null, page_state: content.substring(0, 200), error_class: 'unknown', confidence: 0.3 };
    }
  } catch (e) {
    console.log("diagnosePage error:", e);
    return { suggested_selector: null, page_state: `Diagnosis error: ${e}`, error_class: 'unknown', confidence: 0 };
  }
}

// ═══════════════════════════════════════════════════════
// Self-Healing: Action Execution with Auto-Recovery
// ═══════════════════════════════════════════════════════

interface HealingResult extends ActionResult {
  healing_applied: boolean;
  healing_log: Array<Record<string, unknown>>;
  error_class?: string;
}

async function executeBrowserlessActionWithHealing(
  browserless: ReturnType<typeof parseBrowserlessUrl>,
  actionType: string,
  parameters: Record<string, unknown>,
  currentUrl: string | null,
  maxHealingAttempts: number = 1,
): Promise<HealingResult> {
  const healingLog: Array<Record<string, unknown>> = [];
  const originalParams = { ...parameters };

  // Attempt 1: Execute normally
  let result = await executeBrowserlessAction(browserless, actionType, parameters, currentUrl);

  if (result.success) {
    return { ...result, healing_applied: false, healing_log: [] };
  }

  // Only attempt healing for action types that use selectors
  const healableActions = ['click', 'type', 'extract', 'select', 'wait', 'get_html'];
  if (!healableActions.includes(actionType)) {
    const classification = classifyError(result.error || '', result.final_url || currentUrl || '');
    return { ...result, healing_applied: false, healing_log: [], error_class: classification.error_class };
  }

  // Classify the error
  const classification = classifyError(result.error || '', result.final_url || currentUrl || '');

  // Non-recoverable at browser-proxy level — return immediately
  if (classification.error_class === 'captcha_detected' || classification.error_class === 'login_required') {
    return {
      ...result,
      healing_applied: false,
      healing_log: [{ error_class: classification.error_class, details: classification.details, healable: false, timestamp: new Date().toISOString() }],
      error_class: classification.error_class,
    };
  }

  // Attempt healing
  for (let attempt = 0; attempt < maxHealingAttempts; attempt++) {
    console.log(`[self-heal] Attempt ${attempt + 1} for ${actionType} with selector ${parameters.selector}`);

    const diagnosis = await diagnosePage(
      browserless,
      result.final_url || currentUrl,
      (parameters.selector as string) || '',
      actionType,
      result.error || '',
    );

    const logEntry: Record<string, unknown> = {
      attempt: attempt + 1,
      original_selector: parameters.selector,
      diagnosis_error_class: diagnosis.error_class,
      suggested_selector: diagnosis.suggested_selector,
      page_state: diagnosis.page_state,
      timestamp: new Date().toISOString(),
    };

    // Strategy: dismiss modal, then retry
    if (diagnosis.error_class === 'modal_blocking' && diagnosis.dismiss_action) {
      console.log(`[self-heal] Dismissing modal: ${diagnosis.dismiss_action.selector}`);
      await executeBrowserlessAction(
        browserless,
        diagnosis.dismiss_action.action,
        { selector: diagnosis.dismiss_action.selector },
        result.final_url || currentUrl,
      );
      result = await executeBrowserlessAction(browserless, actionType, originalParams, result.final_url || currentUrl);
      if (result.success) {
        logEntry.healed = true;
        logEntry.strategy = 'dismiss_modal_then_retry';
        healingLog.push(logEntry);
        return { ...result, healing_applied: true, healing_log: healingLog };
      }
    }

    // Strategy: LLM-suggested selector
    if (diagnosis.suggested_selector && diagnosis.suggested_selector !== parameters.selector) {
      console.log(`[self-heal] Trying LLM selector: ${diagnosis.suggested_selector}`);
      const healedParams = { ...originalParams, selector: diagnosis.suggested_selector };
      result = await executeBrowserlessAction(browserless, actionType, healedParams, result.final_url || currentUrl);
      if (result.success) {
        logEntry.healed = true;
        logEntry.strategy = 'llm_selector_replacement';
        logEntry.new_selector = diagnosis.suggested_selector;
        healingLog.push(logEntry);
        return { ...result, healing_applied: true, healing_log: healingLog };
      }
    }

    // Strategy: refresh page and retry (session_expired)
    if (diagnosis.error_class === 'session_expired' || classification.error_class === 'session_expired') {
      console.log(`[self-heal] Refreshing for session_expired`);
      await executeBrowserlessAction(browserless, 'navigate', { url: result.final_url || currentUrl || '' }, null);
      result = await executeBrowserlessAction(browserless, actionType, originalParams, result.final_url || currentUrl);
      if (result.success) {
        logEntry.healed = true;
        logEntry.strategy = 'refresh_and_retry';
        healingLog.push(logEntry);
        return { ...result, healing_applied: true, healing_log: healingLog };
      }
    }

    // Strategy: simple timeout retry
    if (classification.error_class === 'navigation_timeout') {
      console.log(`[self-heal] Retrying after navigation_timeout`);
      result = await executeBrowserlessAction(browserless, actionType, originalParams, currentUrl);
      if (result.success) {
        logEntry.healed = true;
        logEntry.strategy = 'timeout_retry';
        healingLog.push(logEntry);
        return { ...result, healing_applied: true, healing_log: healingLog };
      }
    }

    logEntry.healed = false;
    healingLog.push(logEntry);
  }

  // All healing failed
  return {
    ...result,
    healing_applied: false,
    healing_log: healingLog,
    error_class: classification.error_class,
  };
}

// Track current URL for browser_get_html tool outside of sessions
let currentUrl: string | null = null;

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

  // ──────────────────────────────────────────────
  // POST /agent-action — Unified endpoint for AI agent browser tool calls.
  // Called by the chat edge function (service-to-service), no user auth needed.
  //
  // Supports two tools:
  //   1. browser_do — Execute a multi-step browser script in a single ephemeral
  //      browser instance. Steps run in sequence within the same page context,
  //      preserving cookies, localStorage, and DOM state.
  //   2. web_browse — Simple page text extraction (already handled by /browse).
  //
  // Accepts: { input: {...}, meta: { tool_name, conversation_id, user_id } }
  // ──────────────────────────────────────────────
  if (path === "/agent-action" && req.method === "POST") {
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
    const input = (body.input as Record<string, unknown>) || {};
    const meta = (body.meta as Record<string, unknown>) || {};
    const toolName = (meta.tool_name as string) || "";

    try {
      // ── browser_do: Multi-step browser automation ──
      // The AI sends a JSON array of steps that execute within a single browser.
      // Steps: navigate, click, type, select, scroll, wait, extract, screenshot
      if (toolName === "browser_do") {
        const steps = (input.steps as Array<Record<string, unknown>>) || [];
        let url = (input.url as string) || "";

        // Auto-fix missing protocol (LLM often sends "www.example.com" without https://)
        if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
        }

        if (!url && steps.length === 0) {
          return jsonResp({ error: "Either 'url' or 'steps' is required", markdown_content: "Error: provide a url or steps array." }, 400);
        }

        // Build a single Puppeteer script that runs all steps
        const script = buildCompositeScript(url, steps);

        const resp = await fetchWithTimeout(
          `${bl.baseUrl}/function?token=${bl.token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/javascript" },
            body: script,
            timeout: 55_000,
          },
        );

        if (!resp.ok) {
          const errText = await resp.text();
          return jsonResp({
            error: `Browser action failed (${resp.status})`,
            detail: errText.slice(0, 500),
            markdown_content: `Browser action failed: ${errText.slice(0, 300)}`,
          }, 502);
        }

        const contentType = resp.headers.get("content-type") || "";
        let result: Record<string, unknown> = {};
        if (contentType.includes("application/json")) {
          const raw = await resp.json();
          result = raw.data || raw.result || raw;
        } else {
          const text = await resp.text();
          result = { raw_text: text.substring(0, 10000) };
        }

        const extractedContent = (result.content as string) || "";
        const pageTitle = (result.title as string) || "";
        const pageUrl = (result.url as string) || url;
        const screenshot = (result.screenshot as string) || null;
        const stepResults = (result.step_results as string[]) || [];

        let markdown = `# ${pageTitle || pageUrl}\n\nFinal URL: ${pageUrl}\n`;
        if (stepResults.length > 0) {
          markdown += `\nSteps completed:\n${stepResults.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}\n`;
        }
        if (extractedContent) {
          markdown += `\nPage content:\n${extractedContent.substring(0, 8000)}`;
        }

        return jsonResp({
          success: true,
          title: pageTitle,
          url: pageUrl,
          content: extractedContent.substring(0, 8000),
          screenshot: screenshot ? screenshot.substring(0, 100000) : null,
          step_results: stepResults,
          markdown_content: markdown,
        });
      }

      // ── browser_get_html ── (CRITICAL for autonomous operation)
      if (toolName === "browser_get_html") {
        const selector = (input.selector as string) || "body";
        const maxLen = (input.max_length as number) || 8000;
        const result = await executeBrowserlessAction(bl, "get_html", { selector, max_length: maxLen }, currentUrl);
        const data = result.data as Record<string, unknown> || {};
        const html = ((data.html as string) || "").substring(0, maxLen);

        return jsonResp({
          html,
          selector,
          title: data.title || "",
          url: data.url || currentUrl || "",
          success: result.success,
          markdown_content: result.success
            ? `HTML structure of \`${selector}\` on ${data.url || currentUrl}:\n\n\`\`\`html\n${html}\n\`\`\``
            : `Failed to get HTML: ${result.error}`,
        });
      }

      // ── Individual browser tools (called by LLM via tool definitions) ──
      // These map each granular tool name to the corresponding Browserless action.

      // browser_start — Start session / navigate to initial URL
      if (toolName === "browser_start") {
        let url = (input.url as string) || "";
        if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
        }
        if (!url) {
          currentUrl = null;
          return jsonResp({
            success: true,
            url: "about:blank",
            markdown_content: "Browser session started (no URL specified).",
          });
        }
        const result = await executeBrowserlessAction(bl, "navigate", { url }, null);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || url;
        currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          title: data.title || "",
          url: finalUrl,
          markdown_content: result.success
            ? `Browser started and navigated to ${finalUrl} — "${data.title || ""}"`
            : `Failed to start browser at ${url}: ${result.error}`,
        });
      }

      // browser_navigate — Navigate to a URL
      if (toolName === "browser_navigate") {
        let url = (input.url as string) || "";
        if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
        }
        if (!url) {
          return jsonResp({ error: "url is required", markdown_content: "Error: url is required for browser_navigate." }, 400);
        }
        const result = await executeBrowserlessAction(bl, "navigate", { url }, null);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || url;
        currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          title: data.title || "",
          url: finalUrl,
          markdown_content: result.success
            ? `Navigated to ${finalUrl} — "${data.title || ""}"`
            : `Navigation failed: ${result.error}`,
        });
      }

      // browser_click — Click an element by CSS selector
      if (toolName === "browser_click") {
        const selector = (input.selector as string) || "";
        if (!selector) {
          return jsonResp({ error: "selector is required", markdown_content: "Error: selector is required for browser_click." }, 400);
        }
        const result = await executeBrowserlessActionWithHealing(bl, "click", { selector }, currentUrl, 1);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          title: data.title || "",
          healing_applied: result.healing_applied,
          markdown_content: result.success
            ? `Clicked \`${selector}\` — now on ${finalUrl}`
            : `Click failed on \`${selector}\`: ${result.error}${result.healing_applied ? " (self-healing was attempted)" : ""}`,
        });
      }

      // browser_type — Type text into an input field
      if (toolName === "browser_type") {
        const selector = (input.selector as string) || "";
        const text = (input.text as string) || "";
        const clear = !!input.clear;
        if (!selector) {
          return jsonResp({ error: "selector is required", markdown_content: "Error: selector is required for browser_type." }, 400);
        }
        const result = await executeBrowserlessActionWithHealing(bl, "type", { selector, text, clear, delay: 50 }, currentUrl, 1);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          healing_applied: result.healing_applied,
          markdown_content: result.success
            ? `Typed ${text.length} characters into \`${selector}\``
            : `Type failed on \`${selector}\`: ${result.error}`,
        });
      }

      // browser_screenshot — Take a screenshot
      if (toolName === "browser_screenshot") {
        const fullPage = !!input.full_page;
        const result = await executeBrowserlessAction(bl, "screenshot", { full_page: fullPage }, currentUrl);
        const data = result.data as Record<string, unknown> || {};
        const screenshot = (data.screenshot as string) || null;
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          title: data.title || "",
          screenshot: screenshot ? screenshot.substring(0, 100000) : null,
          markdown_content: result.success
            ? `Screenshot taken of ${finalUrl}`
            : `Screenshot failed: ${result.error}`,
        });
      }

      // browser_extract — Extract text content from the page
      if (toolName === "browser_extract") {
        const selector = (input.selector as string) || "body";
        const result = await executeBrowserlessAction(bl, "extract", { selector }, currentUrl);
        const data = result.data as Record<string, unknown> || {};
        const content = ((data.content as string) || "").substring(0, 10000);
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          title: data.title || "",
          content,
          markdown_content: result.success
            ? `Extracted content from \`${selector}\` on ${finalUrl}:\n\n${content}`
            : `Extract failed: ${result.error}`,
        });
      }

      // browser_scroll — Scroll the page
      if (toolName === "browser_scroll") {
        const direction = (input.direction as string) || "down";
        const amount = Number(input.amount) || 500;
        const result = await executeBrowserlessAction(bl, "scroll", { direction, amount }, currentUrl);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          markdown_content: result.success
            ? `Scrolled ${direction} ${amount}px`
            : `Scroll failed: ${result.error}`,
        });
      }

      // browser_select — Select a dropdown option
      if (toolName === "browser_select") {
        const selector = (input.selector as string) || "";
        const value = (input.value as string) || "";
        if (!selector) {
          return jsonResp({ error: "selector is required", markdown_content: "Error: selector is required for browser_select." }, 400);
        }
        const result = await executeBrowserlessActionWithHealing(bl, "select", { selector, value }, currentUrl, 1);
        const data = result.data as Record<string, unknown> || {};
        const finalUrl = (data.url as string) || currentUrl || "";
        if (finalUrl) currentUrl = finalUrl;
        return jsonResp({
          success: result.success,
          url: finalUrl,
          markdown_content: result.success
            ? `Selected "${value}" in \`${selector}\``
            : `Select failed on \`${selector}\`: ${result.error}`,
        });
      }

      // browser_stop — Close/stop the browser session
      if (toolName === "browser_stop") {
        currentUrl = null;
        return jsonResp({
          success: true,
          markdown_content: "Browser session stopped.",
        });
      }

      // browser_wait_for_user — Pause and wait for user action (CAPTCHA, 2FA, etc.)
      if (toolName === "browser_wait_for_user") {
        const instruction = (input.instruction as string) || "Please complete the required action in the browser.";
        return jsonResp({
          success: true,
          waiting: true,
          instruction,
          markdown_content: `Waiting for user action: ${instruction}`,
        });
      }

      return jsonResp({ error: `Unknown tool: ${toolName}`, markdown_content: `Unknown browser tool: ${toolName}` }, 400);
    } catch (err) {
      return jsonResp({
        error: `Agent action failed: ${err instanceof Error ? err.message : String(err)}`,
        markdown_content: `Browser action failed: ${err instanceof Error ? err.message : String(err)}`,
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

      // Execute with reconnect + self-healing
      const meta = (session.metadata as Record<string, unknown>) || {};
      const actionCurrentUrl = (meta.current_url as string) || null;

      const result = await executeBrowserlessActionWithHealing(
        browserless,
        action_type,
        parameters || {},
        actionCurrentUrl,
        1, // max 1 healing attempt per action
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
          error_class: result.error_class || null,
          healing_attempts: result.healing_log.length,
          healing_log: result.healing_log,
          original_parameters: result.healing_applied ? (parameters || null) : null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", action.id);

      return jsonResp({
        ...action,
        status: result.success ? "completed" : "failed",
        result: result.data,
        final_url: result.final_url || null,
        error: result.error || null,
        error_class: result.error_class || null,
        healing_applied: result.healing_applied,
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

        // Get the session's current_url for reconnect + self-healing
        const sessionMeta =
          (action.browser_sessions as unknown as { metadata: Record<string, unknown> })
            ?.metadata || {};
        const approveCurrentUrl = (sessionMeta.current_url as string) || null;

        const result = await executeBrowserlessActionWithHealing(
          browserless,
          action.action_type,
          action.parameters as Record<string, unknown>,
          approveCurrentUrl,
          1,
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
            error_class: result.error_class || null,
            healing_attempts: result.healing_log.length,
            healing_log: result.healing_log,
            original_parameters: result.healing_applied ? (action.parameters || null) : null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", action_id);

        return jsonResp({
          approved: true,
          result: result.data,
          final_url: result.final_url || null,
          healing_applied: result.healing_applied,
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

/**
 * Build a Puppeteer script with SMART LOCATORS.
 *
 * Instead of requiring CSS selectors, the script includes helper functions
 * that locate elements by label, placeholder, role, text, or name attribute —
 * just like Playwright's getByLabel/getByRole/getByText.
 *
 * Smart actions:
 *   fill_by_label      — find input by associated <label> text
 *   fill_by_placeholder — find input by placeholder attribute
 *   fill_by_name       — find input by name attribute
 *   fill_by_type       — find input by type (e.g. "email", "password")
 *   click_by_text      — click element containing visible text
 *   click_by_role      — click element by ARIA role + accessible name
 *   click_best_match   — click the best button/link matching an intent
 *   wait_for_url       — wait until URL contains a string
 *   wait_for_text      — wait until visible text appears on page
 *   login              — all-in-one login helper
 *
 * Legacy CSS-based actions (click, type, select, etc.) still work as fallback.
 */
function buildCompositeScript(
  startUrl: string,
  steps: Array<Record<string, unknown>>,
): string {
  const stepCode: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const action = (step.action as string) || "";

    // Common params (JSON-escaped for safety inside generated code)
    const selector = JSON.stringify((step.selector as string) || "body");
    const text = JSON.stringify((step.text as string) || "");
    const value = JSON.stringify((step.value as string) || "");
    const url = JSON.stringify((step.url as string) || "");
    const ms = Number(step.ms) || 2000;
    const direction = (step.direction as string) || "down";
    const amount = Number(step.amount) || 500;

    switch (action) {

      // ── Smart fill actions ──

      case "fill_by_label":
        stepCode.push(`
          try {
            const labelText = ${JSON.stringify((step.label as string) || "")};
            const val = ${JSON.stringify((step.value as string) || "")};
            const filled = await helpers.fillByLabel(page, labelText, val);
            stepResults.push(filled
              ? "Filled input labeled \\"" + labelText + "\\""
              : "WARN: no input found for label \\"" + labelText + "\\" — trying fallback");
            if (!filled) {
              const fb = await helpers.fillFallback(page, labelText, val);
              stepResults.push(fb ? "Fallback fill succeeded for \\"" + labelText + "\\"" : "FAIL: could not fill \\"" + labelText + "\\"");
            }
          } catch(e) { stepResults.push("fill_by_label error: " + e.message); }
        `);
        break;

      case "fill_by_placeholder":
        stepCode.push(`
          try {
            const ph = ${JSON.stringify((step.placeholder as string) || "")};
            const val = ${JSON.stringify((step.value as string) || "")};
            const filled = await helpers.fillByPlaceholder(page, ph, val);
            stepResults.push(filled
              ? "Filled input with placeholder \\"" + ph + "\\""
              : "FAIL: no input with placeholder \\"" + ph + "\\"");
          } catch(e) { stepResults.push("fill_by_placeholder error: " + e.message); }
        `);
        break;

      case "fill_by_name":
        stepCode.push(`
          try {
            const nameAttr = ${JSON.stringify((step.name as string) || "")};
            const val = ${JSON.stringify((step.value as string) || "")};
            const sel = '[name="' + nameAttr + '"]';
            await page.waitForSelector(sel, { timeout: 8000 });
            await page.click(sel, { clickCount: 3 });
            await page.keyboard.press("Backspace");
            await page.type(sel, val, { delay: 30 });
            stepResults.push("Filled input [name=" + nameAttr + "]");
          } catch(e) { stepResults.push("fill_by_name error: " + e.message); }
        `);
        break;

      case "fill_by_type":
        stepCode.push(`
          try {
            const inputType = ${JSON.stringify((step.type as string) || "text")};
            const val = ${JSON.stringify((step.value as string) || "")};
            const sel = 'input[type="' + inputType + '"]';
            await page.waitForSelector(sel, { timeout: 8000 });
            await page.click(sel, { clickCount: 3 });
            await page.keyboard.press("Backspace");
            await page.type(sel, val, { delay: 30 });
            stepResults.push("Filled input[type=" + inputType + "]");
          } catch(e) { stepResults.push("fill_by_type error: " + e.message); }
        `);
        break;

      // ── Smart click actions ──

      case "click_by_text":
        stepCode.push(`
          try {
            const txt = ${JSON.stringify((step.text as string) || "")};
            const clicked = await helpers.clickByText(page, txt);
            if (clicked) {
              await new Promise(r => setTimeout(r, 1500));
              await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => {});
              stepResults.push("Clicked element with text \\"" + txt + "\\"");
            } else {
              stepResults.push("FAIL: no clickable element with text \\"" + txt + "\\"");
            }
          } catch(e) { stepResults.push("click_by_text error: " + e.message); }
        `);
        break;

      case "click_by_role":
        stepCode.push(`
          try {
            const role = ${JSON.stringify((step.role as string) || "button")};
            const name = ${JSON.stringify((step.name as string) || "")};
            const clicked = await helpers.clickByRole(page, role, name);
            if (clicked) {
              await new Promise(r => setTimeout(r, 1500));
              await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => {});
              stepResults.push("Clicked " + role + " \\"" + name + "\\"");
            } else {
              stepResults.push("FAIL: no " + role + " named \\"" + name + "\\"");
            }
          } catch(e) { stepResults.push("click_by_role error: " + e.message); }
        `);
        break;

      case "click_best_match":
        stepCode.push(`
          try {
            const intent = ${JSON.stringify((step.intent as string) || "submit")};
            const clicked = await helpers.clickBestMatch(page, intent);
            if (clicked) {
              await new Promise(r => setTimeout(r, 1500));
              await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => {});
              stepResults.push("Clicked best match for intent \\"" + intent + "\\"");
            } else {
              stepResults.push("FAIL: no match for intent \\"" + intent + "\\"");
            }
          } catch(e) { stepResults.push("click_best_match error: " + e.message); }
        `);
        break;

      // ── Smart wait actions ──

      case "wait_for_url":
        stepCode.push(`
          try {
            const fragment = ${JSON.stringify((step.text as string) || "")};
            const timeout = ${Number(step.timeout) || 10000};
            await helpers.waitForUrl(page, fragment, timeout);
            stepResults.push("URL now contains \\"" + fragment + "\\"");
          } catch(e) { stepResults.push("wait_for_url timeout: URL never contained \\"" + ${JSON.stringify((step.text as string) || "")} + "\\""); }
        `);
        break;

      case "wait_for_text":
        stepCode.push(`
          try {
            const txt = ${JSON.stringify((step.text as string) || "")};
            const timeout = ${Number(step.timeout) || 10000};
            await helpers.waitForText(page, txt, timeout);
            stepResults.push("Text \\"" + txt + "\\" is now visible");
          } catch(e) { stepResults.push("wait_for_text timeout: \\"" + ${JSON.stringify((step.text as string) || "")} + "\\" not found"); }
        `);
        break;

      // ── All-in-one login helper ──

      case "login":
        stepCode.push(`
          try {
            const email = ${JSON.stringify((step.email as string) || "")};
            const password = ${JSON.stringify((step.password as string) || "")};
            const loginResult = await helpers.autoLogin(page, email, password);
            stepResults.push(...loginResult.steps);
            if (!loginResult.success) {
              stepResults.push("Login may require manual intervention");
            }
          } catch(e) { stepResults.push("login error: " + e.message); }
        `);
        break;

      // ── Legacy CSS-based actions (still supported as fallback) ──

      case "navigate":
        stepCode.push(`
          await page.goto(${url}, { waitUntil: "networkidle2", timeout: 30000 });
          stepResults.push("Navigated to " + ${url});
        `);
        break;

      case "click":
        stepCode.push(`
          try {
            await page.waitForSelector(${selector}, { timeout: 10000 });
            await page.click(${selector});
            await new Promise(r => setTimeout(r, 1000));
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => {});
            stepResults.push("Clicked " + ${selector});
          } catch(e) { stepResults.push("Click failed on " + ${selector} + ": " + e.message); }
        `);
        break;

      case "type":
        stepCode.push(`
          try {
            await page.waitForSelector(${selector}, { timeout: 10000 });
            ${step.clear ? `await page.click(${selector}, { clickCount: 3 }); await page.keyboard.press("Backspace");` : ""}
            await page.type(${selector}, ${text}, { delay: 50 });
            stepResults.push("Typed into " + ${selector});
          } catch(e) { stepResults.push("Type failed on " + ${selector} + ": " + e.message); }
        `);
        break;

      case "select":
        stepCode.push(`
          try {
            await page.waitForSelector(${selector}, { timeout: 10000 });
            await page.select(${selector}, ${value});
            stepResults.push("Selected " + ${value} + " in " + ${selector});
          } catch(e) { stepResults.push("Select failed: " + e.message); }
        `);
        break;

      case "scroll":
        stepCode.push(`
          await page.evaluate((dir, px) => {
            if (dir === "down") window.scrollBy(0, px);
            else if (dir === "up") window.scrollBy(0, -px);
          }, "${direction}", ${amount});
          stepResults.push("Scrolled ${direction} ${amount}px");
        `);
        break;

      case "wait":
        stepCode.push(`
          await new Promise(r => setTimeout(r, ${ms}));
          stepResults.push("Waited ${ms}ms");
        `);
        break;

      case "press":
        stepCode.push(`
          await page.keyboard.press(${JSON.stringify((step.key as string) || "Enter")});
          await new Promise(r => setTimeout(r, 500));
          stepResults.push("Pressed key " + ${JSON.stringify((step.key as string) || "Enter")});
        `);
        break;

      case "screenshot":
        stepCode.push(`
          takeScreenshot = true;
          stepResults.push("Screenshot taken");
        `);
        break;

      case "extract":
        stepCode.push(`
          try {
            await page.waitForSelector(${selector}, { timeout: 10000 }).catch(() => {});
            const extracted = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              return el ? el.innerText : null;
            }, ${selector});
            if (extracted) extractedContent = extracted;
            stepResults.push("Extracted content from " + ${selector});
          } catch(e) { stepResults.push("Extract failed: " + e.message); }
        `);
        break;

      case "get_html":
        stepCode.push(`
          try {
            await page.waitForSelector(${selector}, { timeout: 10000 }).catch(() => {});
            const html = await page.evaluate((sel, limit) => {
              const el = document.querySelector(sel);
              if (!el) return "(element not found)";
              if (sel === "body" || sel === "html") {
                const clone = el.cloneNode(true);
                clone.querySelectorAll("script, style, svg, noscript, link[rel=stylesheet], iframe").forEach(e => e.remove());
                clone.querySelectorAll("*").forEach(e => {
                  for (const attr of [...e.attributes]) {
                    if (attr.name.startsWith("data-") && !["data-testid","data-id","data-name","data-value","data-action","data-type"].includes(attr.name)) {
                      e.removeAttribute(attr.name);
                    }
                  }
                });
                return clone.innerHTML.substring(0, limit);
              }
              return el.outerHTML.substring(0, limit);
            }, ${selector}, ${Number(step.max_length) || 8000});
            extractedContent = html;
            stepResults.push("Got HTML structure from " + ${selector});
          } catch(e) { stepResults.push("get_html failed: " + e.message); }
        `);
        break;

      default:
        stepCode.push(`stepResults.push("Unknown action: ${action}");`);
    }
  }

  // The generated script includes smart locator helpers
  return `export default async function ({ page }) {

    // ═══ Smart Locator Helpers (Puppeteer equivalents of Playwright getByLabel etc.) ═══
    const helpers = {

      // Fill an input by its associated <label> text (case-insensitive partial match)
      async fillByLabel(page, labelText, value) {
        const handle = await page.evaluateHandle((lt) => {
          const lower = lt.toLowerCase();
          // Strategy 1: <label> with matching text whose "for" points to an input
          for (const label of document.querySelectorAll("label")) {
            if (label.textContent.toLowerCase().includes(lower)) {
              const forId = label.getAttribute("for");
              if (forId) { const inp = document.getElementById(forId); if (inp) return inp; }
              const nested = label.querySelector("input, textarea, select");
              if (nested) return nested;
            }
          }
          // Strategy 2: aria-label on input
          for (const inp of document.querySelectorAll("input, textarea, select")) {
            const al = inp.getAttribute("aria-label") || "";
            if (al.toLowerCase().includes(lower)) return inp;
          }
          return null;
        }, labelText);
        const el = handle.asElement();
        if (!el) return false;
        await el.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await el.type(value, { delay: 30 });
        return true;
      },

      // Fill an input by placeholder text (case-insensitive partial match)
      async fillByPlaceholder(page, placeholder, value) {
        const handle = await page.evaluateHandle((ph) => {
          const lower = ph.toLowerCase();
          for (const inp of document.querySelectorAll("input, textarea")) {
            const p = inp.getAttribute("placeholder") || "";
            if (p.toLowerCase().includes(lower)) return inp;
          }
          return null;
        }, placeholder);
        const el = handle.asElement();
        if (!el) return false;
        await el.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await el.type(value, { delay: 30 });
        return true;
      },

      // Fallback fill: tries placeholder, name, type, aria-label — anything matching the hint
      async fillFallback(page, hint, value) {
        const lower = hint.toLowerCase();
        // Try common patterns based on the hint
        const strategies = [];
        if (lower.includes("email")) {
          strategies.push('input[type="email"]', 'input[name*="email"]', 'input[placeholder*="email" i]', 'input[autocomplete="email"]');
        }
        if (lower.includes("password") || lower.includes("kata laluan")) {
          strategies.push('input[type="password"]', 'input[name*="password"]', 'input[name*="pass"]');
        }
        if (lower.includes("user") || lower.includes("nama")) {
          strategies.push('input[name*="user"]', 'input[name*="login"]', 'input[autocomplete="username"]');
        }
        // Generic fallbacks
        strategies.push('input[name*="' + lower.split(" ")[0] + '"]', 'input[placeholder*="' + lower.split(" ")[0] + '" i]');

        for (const sel of strategies) {
          try {
            const el = await page.$(sel);
            if (el) {
              await el.click({ clickCount: 3 });
              await page.keyboard.press("Backspace");
              await el.type(value, { delay: 30 });
              return true;
            }
          } catch {}
        }
        return false;
      },

      // Click an element by its visible text (case-insensitive)
      async clickByText(page, text) {
        return await page.evaluate((txt) => {
          const lower = txt.toLowerCase();
          // Prioritize buttons and links, then any clickable element
          const candidates = [...document.querySelectorAll("button, a, [role=button], input[type=submit], input[type=button]")];
          for (const el of candidates) {
            const vis = (el.textContent || el.value || "").trim().toLowerCase();
            if (vis.includes(lower) || lower.includes(vis)) {
              el.click();
              return true;
            }
          }
          // Broader search: any element
          const all = [...document.querySelectorAll("*")];
          for (const el of all) {
            if (el.children.length > 3) continue; // skip containers
            const vis = (el.textContent || "").trim().toLowerCase();
            if (vis === lower) { el.click(); return true; }
          }
          return false;
        }, text);
      },

      // Click by ARIA role and accessible name
      async clickByRole(page, role, name) {
        return await page.evaluate((r, n) => {
          const lower = n.toLowerCase();
          const els = document.querySelectorAll("[role=" + r + "], " + r);
          for (const el of els) {
            const accName = (el.getAttribute("aria-label") || el.textContent || "").trim().toLowerCase();
            if (accName.includes(lower)) { el.click(); return true; }
          }
          // For role=button, also check <button> elements
          if (r === "button") {
            for (const el of document.querySelectorAll("button, input[type=submit], input[type=button]")) {
              const t = (el.textContent || el.value || "").trim().toLowerCase();
              if (t.includes(lower)) { el.click(); return true; }
            }
          }
          if (r === "link") {
            for (const el of document.querySelectorAll("a")) {
              const t = (el.textContent || "").trim().toLowerCase();
              if (t.includes(lower)) { el.click(); return true; }
            }
          }
          return false;
        }, role, name);
      },

      // Click the best matching button/link for an intent like "sign in", "login", "submit"
      async clickBestMatch(page, intent) {
        return await page.evaluate((intent) => {
          const lower = intent.toLowerCase();
          // Common login/submit button patterns in multiple languages
          const patterns = [lower];
          if (lower.includes("sign in") || lower.includes("login") || lower.includes("log in")) {
            patterns.push("sign in", "log in", "login", "masuk", "submit", "continue", "next");
          }
          if (lower.includes("submit")) {
            patterns.push("submit", "send", "go", "ok");
          }
          if (lower.includes("sign up") || lower.includes("register")) {
            patterns.push("sign up", "register", "create account", "daftar");
          }
          const candidates = [...document.querySelectorAll("button, a[role=button], input[type=submit], input[type=button], [role=button]")];
          for (const pattern of patterns) {
            for (const el of candidates) {
              const t = (el.textContent || el.value || "").trim().toLowerCase();
              if (t.includes(pattern)) { el.click(); return true; }
            }
          }
          // Last resort: click submit button in a form
          const submit = document.querySelector("form button[type=submit], form input[type=submit], form button:not([type])");
          if (submit) { submit.click(); return true; }
          return false;
        }, intent);
      },

      // Wait until URL contains a string
      async waitForUrl(page, fragment, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (page.url().includes(fragment)) return;
          await new Promise(r => setTimeout(r, 300));
        }
        throw new Error("URL never contained " + fragment);
      },

      // Wait until visible text appears on page
      async waitForText(page, text, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const found = await page.evaluate((t) => {
            return document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase());
          }, text);
          if (found) return;
          await new Promise(r => setTimeout(r, 300));
        }
        throw new Error("Text never appeared: " + text);
      },

      // All-in-one login: tries multiple strategies to fill email + password + click submit
      async autoLogin(page, email, password) {
        const steps = [];

        // ── Fill email ──
        let emailFilled = false;
        // Try type=email first
        try {
          const emailSel = 'input[type="email"]';
          const el = await page.$(emailSel);
          if (el) {
            await el.click({ clickCount: 3 });
            await page.keyboard.press("Backspace");
            await el.type(email, { delay: 30 });
            emailFilled = true;
            steps.push("Filled email via input[type=email]");
          }
        } catch {}
        // Try label
        if (!emailFilled) {
          emailFilled = await helpers.fillByLabel(page, "email", email) || await helpers.fillByLabel(page, "e-mel", email);
          if (emailFilled) steps.push("Filled email via label");
        }
        // Try placeholder
        if (!emailFilled) {
          emailFilled = await helpers.fillByPlaceholder(page, "email", email);
          if (emailFilled) steps.push("Filled email via placeholder");
        }
        // Try name
        if (!emailFilled) {
          try {
            for (const n of ["email", "username", "user", "login"]) {
              const s = 'input[name*="' + n + '"]';
              const el = await page.$(s);
              if (el) { await el.click({clickCount:3}); await page.keyboard.press("Backspace"); await el.type(email, {delay:30}); emailFilled = true; steps.push("Filled email via name=" + n); break; }
            }
          } catch {}
        }
        // Try first visible text input as last resort
        if (!emailFilled) {
          try {
            const filled = await page.evaluate((em) => {
              const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=checkbox]):not([type=radio])');
              for (const inp of inputs) {
                if (inp.offsetParent !== null) { inp.value = em; inp.dispatchEvent(new Event("input", {bubbles:true})); return true; }
              }
              return false;
            }, email);
            if (filled) { emailFilled = true; steps.push("Filled email via first visible input"); }
          } catch {}
        }
        if (!emailFilled) steps.push("FAIL: could not find email field");

        // ── Fill password ──
        let passFilled = false;
        try {
          const passSel = 'input[type="password"]';
          await page.waitForSelector(passSel, { timeout: 5000 });
          const el = await page.$(passSel);
          if (el) {
            await el.click({ clickCount: 3 });
            await page.keyboard.press("Backspace");
            await el.type(password, { delay: 30 });
            passFilled = true;
            steps.push("Filled password via input[type=password]");
          }
        } catch {}
        if (!passFilled) steps.push("FAIL: could not find password field");

        // ── Click submit ──
        let clicked = false;
        await new Promise(r => setTimeout(r, 500));
        // Try common button texts
        for (const txt of ["Sign in", "Log in", "Login", "Masuk", "Submit", "Continue", "Sign In", "LOG IN"]) {
          clicked = await helpers.clickByText(page, txt);
          if (clicked) { steps.push("Clicked submit: \\"" + txt + "\\""); break; }
        }
        if (!clicked) {
          // Try role=button, form submit
          clicked = await page.evaluate(() => {
            const btn = document.querySelector("form button[type=submit], form input[type=submit], form button:not([type]), button[type=submit]");
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (clicked) steps.push("Clicked form submit button");
        }
        if (!clicked) steps.push("FAIL: could not find submit button");

        // Wait for navigation
        if (clicked) {
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
          steps.push("Post-login URL: " + page.url());
        }

        return { success: emailFilled && passFilled && clicked, steps };
      },
    };

    // ═══ Main execution ═══
    const stepResults = [];
    let extractedContent = "";
    let takeScreenshot = false;

    // Page state detection helper
    async function checkPageState() {
      try {
        const state = await page.evaluate(() => {
          const loginIndicators = document.querySelectorAll('input[type="password"], form[action*="login"], form[action*="signin"]');
          const captchaIndicators = document.querySelectorAll('[class*="captcha"], [class*="recaptcha"], iframe[src*="captcha"], [class*="turnstile"]');
          const errorIndicators = document.querySelectorAll('.error, .alert-danger, [class*="error-page"], [class*="error-message"]');
          const modalIndicators = document.querySelectorAll('[class*="modal"][class*="show"], [class*="overlay"][class*="visible"], [role="dialog"][open]');
          return {
            hasLoginForm: loginIndicators.length > 0,
            hasCaptcha: captchaIndicators.length > 0,
            hasError: errorIndicators.length > 0,
            hasModal: modalIndicators.length > 0,
            url: window.location.href,
          };
        });
        if (state.hasCaptcha) stepResults.push("WARNING: CAPTCHA detected on page");
        if (state.hasLoginForm && stepResults.length > 0) stepResults.push("WARNING: Login form detected - may need re-authentication");
        if (state.hasError) stepResults.push("WARNING: Error indicators found on page");
        if (state.hasModal) stepResults.push("WARNING: Modal/overlay detected on page");
      } catch(e) { /* page check non-fatal */ }
    }

    // Navigate to start URL
    ${startUrl ? `
    await page.goto(${JSON.stringify(startUrl)}, { waitUntil: "networkidle2", timeout: 30000 });
    stepResults.push("Navigated to " + ${JSON.stringify(startUrl)});
    ` : ""}

    // Execute steps
    ${stepCode.join("\n")}

    // Post-execution page state check
    await checkPageState();

    // Always extract page content if not explicitly extracted
    if (!extractedContent) {
      try {
        extractedContent = await page.evaluate(() => {
          const rm = document.querySelectorAll("script, style, nav, footer, header, aside, [role=navigation], [role=banner]");
          rm.forEach(el => el.remove());
          return document.body ? document.body.innerText.substring(0, 10000) : "";
        });
      } catch {}
    }

    // Take screenshot if requested
    let screenshot = null;
    if (takeScreenshot) {
      try {
        screenshot = await page.screenshot({ encoding: "base64", fullPage: false });
      } catch {}
    }

    const title = await page.title();
    const finalUrl = page.url();

    return {
      data: {
        title,
        url: finalUrl,
        content: extractedContent.substring(0, 10000),
        screenshot,
        step_results: stepResults,
      },
      type: "application/json",
    };
  }`;
}

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

    case "get_html":
      return `export default async function ({ page }) {
        ${reconnectPreamble(false)}
        const selector = ${JSON.stringify(params.selector || "body")};
        const maxLen = ${Number(params.max_length) || 8000};
        await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
        const html = await page.evaluate((sel, limit) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          // For body, return a cleaned version that's useful for finding selectors
          if (sel === 'body') {
            // Remove script, style, svg content to save space
            const clone = el.cloneNode(true);
            clone.querySelectorAll('script, style, svg, noscript, link[rel=stylesheet]').forEach(e => e.remove());
            // Simplify: remove data-* attributes that aren't useful for selectors
            clone.querySelectorAll('*').forEach(e => {
              for (const attr of [...e.attributes]) {
                if (attr.name.startsWith('data-') && !['data-testid', 'data-id', 'data-name', 'data-value', 'data-action'].includes(attr.name)) {
                  e.removeAttribute(attr.name);
                }
              }
            });
            return clone.innerHTML.substring(0, limit);
          }
          return el.outerHTML.substring(0, limit);
        }, selector, maxLen);
        const finalUrl = page.url();
        const title = await page.title();
        return {
          data: { html: html || '(element not found)', selector, title, url: finalUrl },
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
