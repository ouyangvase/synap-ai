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
 *   - browser_flow: DAG-based multi-step browser automation with state machine
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
  workflow: Workflow;
}

interface JobResult {
  job_id: string;
  job_name: string;
  status: "success" | "skipped" | "failed" | "waiting_for_login" | "waiting_for_approval" | "waiting_for_delay" | "paused";
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
// DAG Workflow Types
// ---------------------------------------------------------------------------

type WorkflowNodeType = "browser_action" | "webhook_call" | "data_transform" | "approval_gate" | "conditional_branch" | "delay";

interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  data: {
    action?: string;
    parameters?: Record<string, unknown>;
    phase?: string;
    max_retries?: number;
    timeout_ms?: number;
    condition?: string;         // JS expression for conditional_branch
    delay_seconds?: number;     // for delay nodes
    webhook_url?: string;       // for webhook_call
    webhook_method?: string;    // for webhook_call
    webhook_headers?: Record<string, string>;
    transform_expression?: string; // for data_transform
  };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // "true"/"false" for conditional, "success"/"failure" for error recovery
  label?: string;
  condition?: string;    // JS expression evaluated against source node result
}

interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface NodeResult {
  node_id: string;
  type: string;
  label: string;
  status: "completed" | "failed" | "skipped" | "waiting";
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
  supabase: any,
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
  return (data as any).id;
}

async function getExecutionState(supabase: any, jobRunId: string) {
  const { data } = await supabase
    .from("execution_state")
    .select("*")
    .eq("job_run_id", jobRunId)
    .maybeSingle();
  return data as any;
}

async function updateExecutionState(
  supabase: any,
  executionStateId: string,
  updates: Record<string, unknown>,
) {
  await supabase.from("execution_state").update(updates).eq("id", executionStateId);
}

async function appendStepResult(
  supabase: any,
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

// ---------------------------------------------------------------------------
// DAG Workflow Helpers
// ---------------------------------------------------------------------------

/**
 * Convert legacy steps[] array to a linear DAG workflow.
 */
function convertStepsToWorkflow(steps: Job["steps"]): Workflow {
  const nodes: WorkflowNode[] = steps.map((step, i) => ({
    id: `step-${i}`,
    type: "browser_action" as WorkflowNodeType,
    label: step.phase || step.action || `Step ${i + 1}`,
    position: { x: 250, y: i * 120 },
    data: {
      action: step.action,
      parameters: step.parameters,
      phase: step.phase,
      max_retries: step.max_retries,
      timeout_ms: step.timeout_ms,
    },
  }));

  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i}-${i + 1}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    });
  }

  return { nodes, edges };
}

/**
 * Get the effective workflow for a job, auto-converting legacy steps[] if needed.
 */
function getJobWorkflow(job: Job): Workflow {
  const wf = job.workflow;
  if (wf && wf.nodes && wf.nodes.length > 0) {
    return wf;
  }
  // Fallback: convert legacy steps[] to linear DAG
  const steps = job.steps || [];
  if (steps.length > 0) {
    return convertStepsToWorkflow(steps);
  }
  return { nodes: [], edges: [] };
}

/**
 * Validate a DAG has no cycles using Kahn's algorithm (topological sort).
 * Returns { valid: true } or { valid: false, message: string }.
 */
function validateDAG(workflow: Workflow): { valid: boolean; message?: string } {
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited !== nodeIds.size) {
    return { valid: false, message: `Cycle detected: ${visited} of ${nodeIds.size} nodes reachable` };
  }
  return { valid: true };
}

/**
 * Safely evaluate a condition expression against a node result.
 * Only exposes the `result` variable in a frozen scope.
 */
function evaluateCondition(condition: string, sourceResult: unknown): boolean {
  try {
    const fn = new Function("result", `"use strict"; return Boolean(${condition});`);
    const frozenResult = Object.freeze(
      typeof sourceResult === "object" && sourceResult !== null
        ? { ...sourceResult as Record<string, unknown> }
        : { value: sourceResult }
    );
    return fn(frozenResult);
  } catch {
    // If condition evaluation fails, default to true (unconditional)
    return true;
  }
}

/**
 * Compute the set of nodes that are ready to execute:
 * - Not already completed or failed
 * - All incoming edges' source nodes are in completedNodes
 * - All incoming edge conditions evaluate to true
 */
function getReadyNodes(
  workflow: Workflow,
  completedNodes: Set<string>,
  failedNodes: Set<string>,
  nodeResults: Record<string, NodeResult>,
): WorkflowNode[] {
  const ready: WorkflowNode[] = [];

  for (const node of workflow.nodes) {
    if (completedNodes.has(node.id) || failedNodes.has(node.id)) continue;

    const incomingEdges = workflow.edges.filter((e) => e.target === node.id);

    if (incomingEdges.length === 0) {
      // Root node — always ready if not yet processed
      ready.push(node);
      continue;
    }

    let allSatisfied = true;
    for (const edge of incomingEdges) {
      // Source must be completed (present in completedNodes)
      if (!completedNodes.has(edge.source)) {
        allSatisfied = false;
        break;
      }

      // Check sourceHandle matching for conditional/failure edges
      if (edge.sourceHandle) {
        const sourceNodeResult = nodeResults[edge.source];
        if (sourceNodeResult) {
          // For conditional_branch: match sourceHandle against result.branch
          const sourceNode = workflow.nodes.find((n) => n.id === edge.source);
          if (sourceNode?.type === "conditional_branch") {
            const branch = (sourceNodeResult.result as Record<string, unknown>)?.branch;
            if (String(branch) !== edge.sourceHandle) {
              allSatisfied = false;
              break;
            }
          }
          // For failure recovery edges
          else if (edge.sourceHandle === "failure") {
            // Only follow failure edge if source actually failed
            if (sourceNodeResult.status !== "failed") {
              allSatisfied = false;
              break;
            }
          }
          // For success edges (explicit)
          else if (edge.sourceHandle === "success") {
            if (sourceNodeResult.status === "failed") {
              allSatisfied = false;
              break;
            }
          }
          // For approval_gate: "approved"/"rejected"
          else if (sourceNode?.type === "approval_gate") {
            const approved = (sourceNodeResult.result as Record<string, unknown>)?.approved;
            if (edge.sourceHandle === "approved" && !approved) {
              allSatisfied = false;
              break;
            }
            if (edge.sourceHandle === "rejected" && approved) {
              allSatisfied = false;
              break;
            }
          }
        }
      }

      // Check explicit edge condition
      if (edge.condition && allSatisfied) {
        const sourceNodeResult = nodeResults[edge.source];
        if (sourceNodeResult && !evaluateCondition(edge.condition, sourceNodeResult.result)) {
          allSatisfied = false;
          break;
        }
      }
    }

    if (allSatisfied) {
      ready.push(node);
    }
  }

  return ready;
}

interface ExecuteNodeContext {
  supabase: any;
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  runId: string;
  execStateId: string;
  lastUrl: string | null;
  nodeResults: Record<string, NodeResult>;
}

/**
 * Execute a single workflow node based on its type.
 */
async function executeNode(
  node: WorkflowNode,
  ctx: ExecuteNodeContext,
): Promise<{ status: "completed" | "failed" | "waiting"; result?: unknown; error?: string; error_class?: string; lastUrl?: string; waitType?: string }> {
  const { supabase, supabaseUrl, serviceRoleKey, anonKey, runId, execStateId, lastUrl, nodeResults } = ctx;

  switch (node.type) {
    case "browser_action": {
      const actionPayload = {
        input: {
          url: lastUrl || (node.data.parameters?.url as string),
          steps: [{ action: node.data.action, ...node.data.parameters }],
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

      const respData = await resp.json();

      if (!resp.ok || respData.error) {
        const errMsg = respData.error || `Step failed with HTTP ${resp.status}`;
        const classification = classifyBrowserError(errMsg, lastUrl || "");
        return { status: "failed", error: errMsg, error_class: classification.error_class };
      }

      return {
        status: "completed",
        result: { url: respData.url, content: respData.content?.substring?.(0, 2000), step_results: respData.step_results },
        lastUrl: respData.url || lastUrl || undefined,
      };
    }

    case "webhook_call": {
      const url = node.data.webhook_url;
      if (!url) return { status: "failed", error: "No webhook_url configured", error_class: "configuration_error" };

      const method = node.data.webhook_method || "POST";
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(node.data.webhook_headers || {}) };

      // Build payload from upstream node results
      const payload: Record<string, unknown> = {
        node_id: node.id,
        node_label: node.label,
        job_run_id: runId,
        upstream_results: Object.fromEntries(
          Object.entries(nodeResults).map(([k, v]) => [k, v.result])
        ),
        ...(node.data.parameters || {}),
      };

      const resp = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      if (!resp.ok) {
        const errBody = await resp.text();
        return { status: "failed", error: `Webhook responded ${resp.status}: ${errBody}`, error_class: "webhook_error" };
      }

      const output = await resp.json().catch(() => ({ raw: "non-json response" }));
      return { status: "completed", result: output };
    }

    case "data_transform": {
      const expression = node.data.transform_expression;
      if (!expression) return { status: "completed", result: null };

      try {
        const fn = new Function("results", "nodeResults", `"use strict"; return (${expression});`);
        const allResults = Object.fromEntries(
          Object.entries(nodeResults).map(([k, v]) => [k, v.result])
        );
        const output = fn(allResults, nodeResults);
        return { status: "completed", result: output };
      } catch (err: unknown) {
        return { status: "failed", error: `Transform error: ${err instanceof Error ? err.message : String(err)}`, error_class: "transform_error" };
      }
    }

    case "approval_gate": {
      return { status: "waiting", waitType: "waiting_for_approval", result: { message: "Waiting for human approval" } };
    }

    case "conditional_branch": {
      const condition = node.data.condition;
      if (!condition) return { status: "completed", result: { branch: "true" } };

      try {
        // Build a context with all upstream results
        const allResults = Object.fromEntries(
          Object.entries(nodeResults).map(([k, v]) => [k, v.result])
        );
        const fn = new Function("results", "nodeResults", `"use strict"; return (${condition});`);
        const rawResult = fn(allResults, nodeResults);
        const branch = rawResult === true ? "true" : rawResult === false ? "false" : String(rawResult);
        return { status: "completed", result: { branch, raw: rawResult } };
      } catch (err: unknown) {
        return { status: "failed", error: `Condition error: ${err instanceof Error ? err.message : String(err)}`, error_class: "condition_error" };
      }
    }

    case "delay": {
      const seconds = node.data.delay_seconds || 0;
      if (seconds <= 0) return { status: "completed", result: { delayed: false } };

      // For short delays (< 30s), wait inline
      if (seconds <= 30) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return { status: "completed", result: { delayed: true, seconds } };
      }

      // For longer delays, pause execution
      return { status: "waiting", waitType: "waiting_for_delay", result: { delay_seconds: seconds, resume_at: new Date(Date.now() + seconds * 1000).toISOString() } };
    }

    default:
      return { status: "failed", error: `Unknown node type: ${node.type}`, error_class: "unknown_node_type" };
  }
}

/**
 * Append a node result to execution_log and update DAG tracking columns.
 */
async function appendNodeResult(
  supabase: ReturnType<typeof createClient>,
  executionStateId: string,
  nodeResult: NodeResult,
  completedNodes: Set<string>,
  failedNodes: Set<string>,
  nodeResults: Record<string, NodeResult>,
  totalNodes: number,
  overallStatus: string,
) {
  const { data: current } = await supabase
    .from("execution_state")
    .select("execution_log")
    .eq("id", executionStateId)
    .single();

  const log = ((current?.execution_log as NodeResult[]) || []);
  log.push(nodeResult);

  await supabase
    .from("execution_state")
    .update({
      execution_log: log,
      current_step: completedNodes.size,
      total_steps: totalNodes,
      current_node_id: nodeResult.node_id,
      completed_nodes: Array.from(completedNodes),
      failed_nodes: Array.from(failedNodes),
      node_results: nodeResults,
      status: overallStatus,
      last_error: nodeResult.error || null,
      last_error_class: nodeResult.error_class || null,
      ...(["success", "failed", "cancelled"].includes(overallStatus)
        ? { completed_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", executionStateId);
}

/**
 * Initialize execution state for a DAG workflow.
 */
async function initDAGExecutionState(
  supabase: ReturnType<typeof createClient>,
  jobRunId: string,
  workflow: Workflow,
  maxRetries: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("execution_state")
    .insert({
      job_run_id: jobRunId,
      status: "created",
      total_steps: workflow.nodes.length,
      max_retries: maxRetries,
      resume_token: { workflow },
      completed_nodes: [],
      failed_nodes: [],
      node_results: {},
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create execution state: ${error.message}`);
  return data.id;
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
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr, steps, workflow",
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
          "id, name, description, schedule, workflow_name, workflow_payload, is_active, task_type, task_config, schedule_type, daily_time, timezone, cron_expr, steps, workflow",
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
        // ── browser_flow: DAG-based workflow with state machine ──
        const workflow = getJobWorkflow(job);

        if (workflow.nodes.length === 0) {
          const completedAt = new Date().toISOString();
          const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          await supabase.from("job_runs").update({
            status: "skipped", output: { message: "No workflow nodes or steps defined" },
            completed_at: completedAt, duration_ms: durationMs,
          }).eq("id", runId);
          await supabase.from("jobs").update({ last_run_at: completedAt }).eq("id", job.id);
          results.push({ job_id: job.id, job_name: job.name, status: "skipped", reason: "No workflow nodes defined" });
          continue;
        }

        // Validate DAG (no cycles)
        const dagValidation = validateDAG(workflow);
        if (!dagValidation.valid) {
          const completedAt = new Date().toISOString();
          const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          await supabase.from("job_runs").update({
            status: "failed", error: `Invalid workflow: ${dagValidation.message}`,
            completed_at: completedAt, duration_ms: durationMs,
          }).eq("id", runId);
          results.push({ job_id: job.id, job_name: job.name, status: "failed", error: dagValidation.message });
          continue;
        }

        // Check for existing execution state (resume scenario)
        let execState = await getExecutionState(supabase, runId);
        let execStateId: string;
        const maxRetries = (job.task_config as Record<string, unknown>)?.max_retries as number || 3;

        if (execState && ["failed", "paused", "waiting_for_login", "waiting_for_approval", "waiting_for_delay"].includes(execState.status)) {
          // Resume from checkpoint — preserve completed_nodes
          execStateId = execState.id;
          await updateExecutionState(supabase, execStateId, {
            status: "running",
            retry_count: (execState.retry_count || 0) + 1,
          });
        } else if (!execState) {
          // Fresh start
          execStateId = await initDAGExecutionState(supabase, runId, workflow, maxRetries);
          await updateExecutionState(supabase, execStateId, {
            status: "running",
            started_at: new Date().toISOString(),
          });
        } else {
          execStateId = execState.id;
        }

        // Reload state
        execState = await getExecutionState(supabase, runId);
        await supabase.from("job_runs").update({ status: "running" }).eq("id", runId);

        // Restore DAG progress from execution state
        const completedNodes = new Set<string>((execState?.completed_nodes as string[]) || []);
        const failedNodes = new Set<string>((execState?.failed_nodes as string[]) || []);
        const nodeResults: Record<string, NodeResult> = (execState?.node_results as Record<string, NodeResult>) || {};
        let lastUrl: string | null = (execState?.resume_token as Record<string, unknown>)?.last_url as string || null;

        // On resume from failure, move the failed node back to retryable
        if (execState && failedNodes.size > 0 && ["failed", "paused"].includes(execState.status as string)) {
          // Clear failed nodes so they can be re-tried
          for (const fid of failedNodes) {
            delete nodeResults[fid];
          }
          failedNodes.clear();
        }

        let flowFailed = false;
        let lastError: string | null = null;
        let lastErrorClass: string | null = null;
        let finalStatus = "success";
        const executionStartTime = Date.now();

        // ── DAG Execution Loop ──
        while (true) {
          // Check time budget (50s limit to leave buffer for finalization)
          if (Date.now() - executionStartTime > 50_000) {
            finalStatus = "paused";
            lastError = "Execution paused: approaching time limit";
            flowFailed = true;
            await updateExecutionState(supabase, execStateId, {
              status: "paused",
              completed_nodes: Array.from(completedNodes),
              failed_nodes: Array.from(failedNodes),
              node_results: nodeResults,
              resume_token: { workflow, last_url: lastUrl },
              last_error: lastError,
            });
            break;
          }

          const readyNodes = getReadyNodes(workflow, completedNodes, failedNodes, nodeResults);
          if (readyNodes.length === 0) break; // All done or stuck

          for (const node of readyNodes) {
            const nodeStart = new Date().toISOString();

            // Update current execution phase
            await updateExecutionState(supabase, execStateId, {
              current_node_id: node.id,
              execution_phase: node.data.phase || node.label,
              status: "running",
            });

            const result = await executeNode(node, {
              supabase, supabaseUrl, serviceRoleKey, anonKey,
              runId, execStateId, lastUrl, nodeResults,
            });

            const nodeEnd = new Date().toISOString();
            const nodeDuration = new Date(nodeEnd).getTime() - new Date(nodeStart).getTime();

            if (result.lastUrl) lastUrl = result.lastUrl;

            if (result.status === "waiting") {
              // Approval gate or delay — pause execution
              const waitStatus = result.waitType || "waiting_for_approval";
              const nr: NodeResult = {
                node_id: node.id, type: node.type, label: node.label,
                status: "waiting", result: result.result,
                started_at: nodeStart, completed_at: nodeEnd, duration_ms: nodeDuration,
              };
              nodeResults[node.id] = nr;

              await appendNodeResult(supabase, execStateId, nr,
                completedNodes, failedNodes, nodeResults,
                workflow.nodes.length, waitStatus);

              await updateExecutionState(supabase, execStateId, {
                resume_token: { workflow, last_url: lastUrl },
              });

              // Update job_run status
              await supabase.from("job_runs").update({ status: waitStatus }).eq("id", runId);
              await supabase.from("jobs").update({ last_run_at: nodeEnd }).eq("id", job.id);

              results.push({
                job_id: job.id, job_name: job.name,
                status: waitStatus as JobResult["status"],
                duration_ms: new Date(nodeEnd).getTime() - new Date(startedAt).getTime(),
              });
              // Exit the entire job processing — we'll be resumed later
              // Use a flag so the outer loop doesn't finalize
              flowFailed = true;
              finalStatus = waitStatus;
              break;
            }

            if (result.status === "completed") {
              completedNodes.add(node.id);
              const nr: NodeResult = {
                node_id: node.id, type: node.type, label: node.label,
                status: "completed", result: result.result,
                started_at: nodeStart, completed_at: nodeEnd, duration_ms: nodeDuration,
              };
              nodeResults[node.id] = nr;

              const isLastNode = completedNodes.size === workflow.nodes.length;
              await appendNodeResult(supabase, execStateId, nr,
                completedNodes, failedNodes, nodeResults,
                workflow.nodes.length, isLastNode ? "success" : "running");

              await updateExecutionState(supabase, execStateId, {
                resume_token: { workflow, last_url: lastUrl },
              });
            } else {
              // Failed
              const classification = classifyBrowserError(result.error || "", lastUrl || "");
              const errorClass = result.error_class || classification.error_class;

              // Check for recovery edges
              const recoveryEdges = workflow.edges.filter(
                (e) => e.source === node.id && e.sourceHandle === "failure"
              );

              const nr: NodeResult = {
                node_id: node.id, type: node.type, label: node.label,
                status: "failed", error: result.error, error_class: errorClass,
                started_at: nodeStart, completed_at: nodeEnd, duration_ms: nodeDuration,
              };
              nodeResults[node.id] = nr;

              if (recoveryEdges.length > 0) {
                // Has recovery path — mark as completed (with error) so downstream recovery nodes activate
                completedNodes.add(node.id);
                await appendNodeResult(supabase, execStateId, nr,
                  completedNodes, failedNodes, nodeResults,
                  workflow.nodes.length, "running");
              } else {
                // No recovery — determine state transition
                failedNodes.add(node.id);

                if (errorClass === "login_required") {
                  finalStatus = "waiting_for_login";
                } else if (errorClass === "captcha_detected") {
                  finalStatus = "waiting_for_approval";
                } else if (classification.is_recoverable && (execState?.retry_count || 0) < maxRetries) {
                  finalStatus = "retrying";
                } else {
                  finalStatus = "failed";
                }

                lastError = result.error || "Unknown error";
                lastErrorClass = errorClass;

                await appendNodeResult(supabase, execStateId, nr,
                  completedNodes, failedNodes, nodeResults,
                  workflow.nodes.length, finalStatus);

                await updateExecutionState(supabase, execStateId, {
                  resume_token: { workflow, last_url: lastUrl },
                  last_error: lastError,
                  last_error_class: lastErrorClass,
                });

                flowFailed = true;
              }

              if (flowFailed) break;
            }
          }

          if (flowFailed) break;
        }

        // Finalize (unless we already handled a waiting state)
        if (!["waiting_for_approval", "waiting_for_delay", "waiting_for_login"].includes(finalStatus)) {
          const completedAt = new Date().toISOString();
          const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          const finalExec = await getExecutionState(supabase, runId);

          await supabase.from("job_runs").update({
            status: flowFailed ? finalStatus : "success",
            output: { execution_log: finalExec?.execution_log, node_results: nodeResults, final_url: lastUrl },
            error: flowFailed ? lastError : null,
            completed_at: completedAt,
            duration_ms: durationMs,
          }).eq("id", runId);

          await supabase.from("jobs").update({ last_run_at: completedAt }).eq("id", job.id);

          results.push({
            job_id: job.id, job_name: job.name,
            status: (flowFailed ? finalStatus : "success") as JobResult["status"],
            error: flowFailed ? lastError || undefined : undefined,
            error_class: flowFailed ? lastErrorClass || undefined : undefined,
            duration_ms: durationMs,
          });
        }
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
