import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ToolDef {
  id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  requires_approval: boolean;
}

interface ToolEndpoint {
  endpoint_url: string;
  http_method: string;
  timeout_ms: number;
  max_retries: number;
  headers: Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status === 429 && i < maxRetries) {
        await delay(Math.pow(2, i) * 1000 + Math.random() * 1000);
        continue;
      }
      return resp;
    } catch (e) {
      if (i === maxRetries) throw e;
      await delay(Math.pow(2, i) * 1000);
    }
  }
  throw new Error("Max retries exceeded");
}

function sanitizeToolCall(tc: any): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
  const name = tc?.function?.name || tc?.name || "";
  if (!name || name === "unknown") return null;

  const id = tc?.id || tc?.function?.id || `call_${Math.random().toString(36).slice(2, 10)}`;
  let args: string;
  if (typeof tc?.function?.arguments === "string") {
    args = tc.function.arguments;
  } else {
    args = JSON.stringify(tc?.function?.arguments || tc?.arguments || {});
  }

  return { id, type: "function", function: { name, arguments: args } };
}

function buildLlmMessages(systemPrompt: string, dbMessages: any[]): any[] {
  const msgs: any[] = [{ role: "system", content: systemPrompt }];
  const validToolCallIds = new Set<string>();

  for (const m of dbMessages || []) {
    if (!m.role) continue;

    if (m.role === "assistant") {
      const msg: any = { role: "assistant" };
      if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const sanitized = (m.tool_calls as any[]).map(sanitizeToolCall).filter(Boolean) as any[];
        if (sanitized.length > 0) {
          msg.tool_calls = sanitized;
          msg.content = m.content || "";
          sanitized.forEach((tc: any) => validToolCallIds.add(tc.id));
        } else {
          msg.content = m.content || "(tool call omitted)";
        }
      } else {
        msg.content = m.content || "";
        if (!msg.content) continue;
      }
      msgs.push(msg);
      continue;
    }

    if (m.role === "tool") {
      if (!m.tool_call_id) continue;
      if (!validToolCallIds.has(m.tool_call_id)) continue;
      msgs.push({
        role: "tool",
        content: (m.content || "No output").substring(0, 15000),
        tool_call_id: m.tool_call_id,
      });
      continue;
    }

    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content || "" });
      continue;
    }
  }

  const last = msgs[msgs.length - 1];
  if (last && last.role === "assistant" && !last.tool_calls) {
    msgs.push({ role: "user", content: "(continue)" });
  }

  return msgs;
}

function deduplicateUserMessages(msgs: any[]): any[] {
  const result: any[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (i > 0 && msgs[i].role === "user" && msgs[i - 1]?.role === "user" && msgs[i].content === msgs[i - 1].content) {
      continue;
    }
    result.push(msgs[i]);
  }
  return result;
}

// ── Plan mode detection ──
function detectPlanMode(userContent: string): { isPlanMode: boolean; cleanContent: string } {
  if (userContent.startsWith("[PLAN]")) {
    return { isPlanMode: true, cleanContent: userContent.replace(/^\[PLAN\]\s*/, "") };
  }
  return { isPlanMode: false, cleanContent: userContent };
}

function isApprovalMessage(content: string): boolean {
  const approvalPhrases = ["approve", "approved", "go ahead", "proceed", "execute", "run it", "do it", "yes", "confirm", "lgtm"];
  const lower = content.toLowerCase().trim();
  return approvalPhrases.some(p => lower === p || lower.startsWith(p));
}

// ── Main serve ──────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    if (!lovableApiKey) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id, plan_mode } = await req.json();
    if (!conversation_id) throw new Error("conversation_id required");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: conversation } = await supabase
      .from("conversations")
      .select("*, agents(*)")
      .eq("id", conversation_id)
      .single();

    if (!conversation || conversation.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agent = conversation.agents;
    const baseSystemPrompt = agent?.system_prompt || "You are a helpful AI assistant.";
    const model = agent?.model || "google/gemini-2.5-flash";

    let tools: ToolDef[] = [];
    if (agent) {
      const { data: agentTools } = await supabase
        .from("agent_tools")
        .select("tool_id, tools(*)")
        .eq("agent_id", agent.id);
      if (agentTools) {
        tools = agentTools.map((at: any) => at.tools).filter((t: any) => t && t.is_active);
      }
    }

    const { data: dbMessages } = await supabase
      .from("messages")
      .select("role, content, tool_call_id, tool_calls")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    // ── Detect plan mode from last user message or request flag ──
    const lastUserMsg = [...(dbMessages || [])].reverse().find((m: any) => m.role === "user");
    const userText = lastUserMsg?.content || "";
    const { isPlanMode, cleanContent } = detectPlanMode(userText);
    const planModeActive = isPlanMode || plan_mode === true;
    const isApproval = isApprovalMessage(userText);

    // ── Self-improving memory: fetch relevant learnings ──
    let learningsContext = "";
    if (agent) {
      const domainMatch = userText.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-z]{2,})/i);
      const domain = domainMatch ? domainMatch[1] : null;

      if (domain) {
        const { data: learnings } = await supabase
          .from("agent_learnings")
          .select("correction, error_pattern, success_count")
          .eq("agent_id", agent.id)
          .eq("domain", domain)
          .order("success_count", { ascending: false })
          .limit(5);

        if (learnings && learnings.length > 0) {
          learningsContext = "\n\n## LEARNED FROM PREVIOUS ATTEMPTS\n" +
            learnings.map((l: any) =>
              `- ${l.error_pattern ? `When "${l.error_pattern}": ` : ""}${l.correction} (verified ${l.success_count}x)`
            ).join("\n");
        }
      }
    }

    // ── Build enhanced system prompt ──
    let systemPrompt = baseSystemPrompt + learningsContext;

    if (planModeActive && !isApproval) {
      systemPrompt += `\n\n## PLAN MODE ACTIVE
You MUST first create a detailed numbered step-by-step plan before executing any actions.
Format your plan as:
**Plan:**
1. [Step description]
2. [Step description]
...

After presenting the plan, wait for user approval. Do NOT execute tools until the user approves.
Think through each step carefully and explain your reasoning.`;
    }

    if (isApproval) {
      systemPrompt += `\n\n## PLAN APPROVED
The user has approved your plan. Execute autonomously until the goal is fully completed or a hard blocker appears.
Do NOT pause for user confirmation between steps.
After each tool call, verify progress and immediately continue with the next best action.`;
    }

    // Always add thinking instructions
    systemPrompt += `\n\n## THINKING INSTRUCTIONS
When reasoning through complex tasks:
- Think step by step and explain your reasoning
- When using browser_do, describe what you're about to do and why
- After each action, analyze the result and decide the next step
- If something fails, explain what went wrong and try a different approach`;

    let llmMessages = buildLlmMessages(systemPrompt, dbMessages || []);
    llmMessages = deduplicateUserMessages(llmMessages);

    const llmTools = tools.map((t) => {
      let params = t.input_schema || { type: "object", properties: {} };
      if (typeof params === "object" && !params.type) params = { type: "object", ...params };
      return { type: "function" as const, function: { name: t.name, description: t.description, parameters: params } };
    });

    const llmBody: any = { model, messages: llmMessages, stream: true };
    if (llmTools.length > 0) llmBody.tools = llmTools;

    console.log("LLM request:", JSON.stringify({
      model, msg_count: llmMessages.length,
      roles: llmMessages.map((m: any) => m.role),
      tool_count: llmTools.length,
      plan_mode: planModeActive,
    }));

    // ── Use Lovable AI Gateway ──
    const llmResponse = await fetchWithRetry(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(llmBody),
      }
    );

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("LLM error:", llmResponse.status, errText);
      if (llmResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (llmResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted — please top up." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let detailedError = `AI service error (HTTP ${llmResponse.status})`;
      try {
        const errJson = JSON.parse(errText);
        const errMsg = errJson?.[0]?.error?.message || errJson?.error?.message;
        if (errMsg) detailedError = errMsg;
      } catch {}
      throw new Error(detailedError);
    }

    // ── Stream response ──
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Emit initial thinking phase
          if (planModeActive && !isApproval) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Creating a step-by-step plan...", phase: "planning" })}\n\n`));
          } else if (isApproval) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Plan approved. Beginning execution...", phase: "executing" })}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Analyzing your request...", phase: "reasoning" })}\n\n`));
          }

          const { fullContent, toolCallsList } = await processStream(llmResponse, controller, encoder);

          await supabase.from("messages").insert({
            conversation_id, user_id: user.id, role: "assistant",
            content: fullContent || null,
            tool_calls: toolCallsList.length > 0 ? toolCallsList : null,
            metadata: planModeActive ? { plan_mode: true } : {},
          });

          // ── Agentic loop ──
          if (toolCallsList.length > 0) {
            let loopMessages = [...llmMessages];
            let currentToolCalls = toolCallsList;
            let currentContent = fullContent;
            const MAX_LOOPS = 30;
            const loopStartTime = Date.now();
            const MAX_LOOP_ELAPSED_MS = 180_000;
            let previousFailedAction: string | null = null;

            for (let loop = 0; loop < MAX_LOOPS; loop++) {
              const elapsed = Date.now() - loopStartTime;
              if (elapsed > MAX_LOOP_ELAPSED_MS) {
                console.warn(`[agentic-loop] Wall-clock limit reached (${elapsed}ms).`);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n*Continuing in next message — processing time limit reached. Send any message to continue.*" } }] })}\n\n`));
                break;
              }

              const toolResultMsgs: any[] = [];
              let approvalPending = false;

              for (const tc of currentToolCalls) {
                if (!tc.function.name || tc.function.name === "unknown") continue;

                const tool = tools.find((t) => t.name === tc.function.name);
                if (!tool) { console.warn("Tool not found:", tc.function.name); continue; }

                let parsedArgs: Record<string, unknown> = {};
                try { parsedArgs = JSON.parse(tc.function.arguments); } catch {}

                // Emit thinking about tool usage
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                  type: "thinking", 
                  message: `Using ${tool.name}: ${tool.description}`,
                  phase: "executing",
                  tool_name: tool.name,
                })}\n\n`));

                const { data: toolRun } = await supabase
                  .from("tool_runs")
                  .insert({
                    conversation_id, user_id: user.id, tool_id: tool.id,
                    tool_call_id: tc.id,
                    status: tool.requires_approval ? "pending" : "running",
                    input: parsedArgs,
                    started_at: tool.requires_approval ? null : new Date().toISOString(),
                  })
                  .select().single();

                if (tool.requires_approval && toolRun) {
                  await supabase.from("tool_approvals").insert({ tool_run_id: toolRun.id, status: "pending" });
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "approval_required", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
                  approvalPending = true;
                } else if (toolRun) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
                  await executeToolRun(supabase, toolRun.id, tool, parsedArgs, user.id, conversation_id, authHeader || undefined);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", tool_run_id: toolRun.id })}\n\n`));

                  const { data: completedRun } = await supabase
                    .from("tool_runs")
                    .select("output, status, error, tool_call_id")
                    .eq("id", toolRun.id)
                    .single();

                  if (completedRun) {
                    let rc = completedRun.output?.markdown_content || JSON.stringify(completedRun.output || {});
                    if (typeof rc !== "string") rc = JSON.stringify(rc);
                    // Enrich with page content so the LLM can "see" what's on screen
                    const pageContent = completedRun.output?.content;
                    if (pageContent && typeof pageContent === "string") {
                      rc += `\n\n--- Page Content (first 3000 chars) ---\n${pageContent.substring(0, 3000)}`;
                    }

                    if (completedRun.status === "failed") {
                      rc = `ERROR: Tool "${tool.name}" failed.\nError: ${completedRun.error || "Unknown error"}\nPlease analyze the error and try a different approach.`;
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: `Tool failed: ${completedRun.error}. Analyzing and retrying...`, phase: "reasoning" })}\n\n`));
                    }

                    const outcomeStatus = completedRun.output?.outcome_status;
                    const verificationStatus = completedRun.output?.verification_status;
                    if (tool.name === "browser_do" && (outcomeStatus === "needs_attention" || verificationStatus === "verification_failed")) {
                      previousFailedAction = JSON.stringify(parsedArgs).substring(0, 500);
                      rc += "\n\n⚠️ VERIFICATION FAILED — The action may not have completed successfully. " +
                        "You MUST retry with a corrected approach.";
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Verification failed. Re-evaluating approach...", phase: "reasoning" })}\n\n`));
                    } else if (tool.name === "browser_do" && completedRun.status === "failed") {
                      previousFailedAction = completedRun.error?.substring(0, 500) || "unknown failure";
                    } else if (tool.name === "browser_do" && completedRun.status === "completed" && previousFailedAction) {
                      const urlMatch = JSON.stringify(parsedArgs).match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-z]{2,})/i);
                      const learnDomain = urlMatch ? urlMatch[1] : "general";
                      const correction = `After failure, succeeded with: ${JSON.stringify(parsedArgs).substring(0, 300)}`;
                      try {
                        await supabase.from("agent_learnings").insert({
                          agent_id: agent?.id || null, user_id: user.id,
                          domain: learnDomain, error_pattern: previousFailedAction.substring(0, 200),
                          correction: correction.substring(0, 500), success_count: 1,
                        });
                      } catch (e) { console.warn("[self-improving] Failed to store learning:", e); }
                      previousFailedAction = null;
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Action succeeded! Verifying result...", phase: "verifying" })}\n\n`));
                    }

                    toolResultMsgs.push({
                      role: "tool",
                      content: rc.substring(0, 15000),
                      tool_call_id: completedRun.tool_call_id,
                    });
                  }
                }
              }

              if (approvalPending || toolResultMsgs.length === 0) break;

              const sanitizedCalls = currentToolCalls.map(sanitizeToolCall).filter(Boolean) as any[];
              if (sanitizedCalls.length === 0) break;

              loopMessages = [
                ...loopMessages,
                { role: "assistant", content: currentContent || "", tool_calls: sanitizedCalls },
                ...toolResultMsgs,
              ];

              const followUpBody: any = { model, messages: loopMessages, stream: true };
              if (llmTools.length > 0) followUpBody.tools = llmTools;

              const thinkingPhase = previousFailedAction
                ? "Analyzing failure and planning recovery..."
                : loop === 0
                  ? "Observing results and planning next action..."
                  : `Step ${loop + 1}: Evaluating progress...`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: thinkingPhase, phase: previousFailedAction ? "reasoning" : "executing" })}\n\n`));

              const followUpResp = await fetchWithRetry(
                "https://ai.gateway.lovable.dev/v1/chat/completions",
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify(followUpBody),
                }
              );

              if (!followUpResp.ok) {
                const errStatus = followUpResp.status;
                console.error("Follow-up error:", errStatus);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n*AI error (${errStatus}). Please retry.*` } }] })}\n\n`));
                break;
              }

              const followUp = await processStream(followUpResp, controller, encoder);

              if (followUp.fullContent || followUp.toolCallsList.length > 0) {
                await supabase.from("messages").insert({
                  conversation_id, user_id: user.id, role: "assistant",
                  content: followUp.fullContent || null,
                  tool_calls: followUp.toolCallsList.length > 0 ? followUp.toolCallsList : null,
                });
              }

              if (followUp.toolCallsList.length > 0) {
                currentToolCalls = followUp.toolCallsList;
                currentContent = followUp.fullContent;
                continue;
              }
              break;
            }
          }

          if ((dbMessages?.length || 0) <= 1 && fullContent) {
            const title = fullContent.slice(0, 60).replace(/\n/g, " ");
            await supabase.from("conversations").update({ title }).eq("id", conversation_id);
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          console.error("Stream error:", e);
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Reusable stream parser ──

async function processStream(
  response: Response,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<{ fullContent: string; toolCallsList: { id: string; function: { name: string; arguments: string } }[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  const acc: Record<number, { id: string; function: { name: string; arguments: string } }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ") || line.trim() === "") continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!acc[idx]) acc[idx] = { id: tc.id || "", function: { name: "", arguments: "" } };
            if (tc.id) acc[idx].id = tc.id;
            if (tc.function?.name) acc[idx].function.name += tc.function.name;
            if (tc.function?.arguments) acc[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch {}
    }
  }

  const toolCallsList = Object.values(acc).filter(tc => tc.function.name && tc.function.name !== "unknown");
  for (const tc of toolCallsList) {
    if (!tc.id) tc.id = `call_${Math.random().toString(36).slice(2, 10)}`;
  }

  return { fullContent, toolCallsList };
}

// ── Tool execution ──

async function executeToolRun(
  supabase: any, toolRunId: string, tool: ToolDef,
  input: Record<string, unknown>, userId: string, conversationId: string,
  forwardedAuthHeader?: string
) {
  try {
    const { data: endpoint } = await supabase
      .from("tool_endpoints").select("*").eq("tool_id", tool.id).single();

    if (!endpoint) {
      await supabase.from("tool_runs").update({
        status: "failed", error: "No endpoint configured", completed_at: new Date().toISOString(),
      }).eq("id", toolRunId);
      return;
    }

    const ep = endpoint as ToolEndpoint;
    let resolvedUrl = ep.endpoint_url;
    const n8nBase = Deno.env.get("N8N_WEBHOOK_BASE_URL");
    if (n8nBase && resolvedUrl.includes("{N8N_WEBHOOK_BASE_URL}"))
      resolvedUrl = resolvedUrl.replace("{N8N_WEBHOOK_BASE_URL}", n8nBase.replace(/\/$/, ""));
    const supabaseUrlEnv = Deno.env.get("SUPABASE_URL");
    if (supabaseUrlEnv && resolvedUrl.includes("{SUPABASE_URL}"))
      resolvedUrl = resolvedUrl.replace("{SUPABASE_URL}", supabaseUrlEnv.replace(/\/$/, ""));

    const payload = {
      meta: { tool_name: tool.name, tool_run_id: toolRunId, user_id: userId, conversation_id: conversationId },
      input,
    };

    const isBrowserDo = tool.name === "browser_do";
    const stepCount = isBrowserDo && Array.isArray(input.steps) ? input.steps.length : 0;
    const effectiveTimeout = isBrowserDo
      ? Math.min(Math.max(20_000 + stepCount * 10_000, 50_000), 90_000)
      : ep.timeout_ms;

    let lastError = "";
    const maxRetries = isBrowserDo ? 2 : ep.max_retries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), effectiveTimeout);

        // Internal function auth strategy:
        // - /browser-proxy/agent-action is service-to-service and does not require user JWT
        // - Other internal protected endpoints should receive the user's JWT when available
        const supabaseUrlEnvCheck = Deno.env.get("SUPABASE_URL") || "NONE";
        const isInternalCall = resolvedUrl.includes(supabaseUrlEnvCheck);
        const isAgentAction = resolvedUrl.includes("/functions/v1/browser-proxy/agent-action");
        const authHeaders = isInternalCall
          ? (isAgentAction
            ? { apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" }
            : {
                Authorization: forwardedAuthHeader || `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`,
                apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
              })
          : {};

        const resp = await fetch(resolvedUrl, {
          method: ep.http_method,
          headers: {
            "Content-Type": "application/json",
            ...(ep.headers as Record<string, string>),
            ...authHeaders,
          },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          const errBody = await resp.text();
          lastError = `HTTP ${resp.status}: ${errBody}`;
          
          // Don't retry 401/403 auth errors or 400 schema errors — they won't resolve with retries
          if (resp.status === 401 || resp.status === 403) {
            lastError = `Auth error (${resp.status}): ${errBody}. This is a configuration issue, not a transient error.`;
            break;
          }
          if (resp.status === 400) {
            lastError = `Bad request (400): ${errBody}`;
            break;
          }
          
          if (resp.status >= 500 && attempt < maxRetries) {
            await delay(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
            continue;
          }
          throw new Error(lastError);
        }

        const result = await resp.json();

        let runStatus = "completed";
        if (isBrowserDo && result.outcome_status === "needs_attention") runStatus = "failed";
        if (isBrowserDo && result.has_failures && !result.verification_status) runStatus = "failed";

        await supabase.from("tool_runs").update({
          status: runStatus, output: result, completed_at: new Date().toISOString(),
        }).eq("id", toolRunId);

        let resultContent = result.markdown_content || JSON.stringify(result);
        // Include page content for LLM context
        if (result.content && typeof result.content === "string") {
          resultContent += `\n\n--- Page Content ---\n${result.content.substring(0, 3000)}`;
        }
        const { data: runData } = await supabase.from("tool_runs").select("tool_call_id").eq("id", toolRunId).single();
        await supabase.from("messages").insert({
          conversation_id: conversationId, user_id: userId,
          role: "tool", content: resultContent, tool_call_id: runData?.tool_call_id,
        });
        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          lastError = `Browser action timed out after ${effectiveTimeout / 1000}s`;
        } else {
          lastError = err.message;
        }
        // Don't retry auth/schema errors
        if (lastError.includes("Auth error") || lastError.includes("Bad request")) break;
        if (attempt < maxRetries) {
          await delay(Math.pow(2, attempt) * 1000);
          continue;
        }
      }
    }

    const failureMsg = isBrowserDo && !lastError.includes("Auth error") && !lastError.includes("Bad request")
      ? `${lastError}. Keep steps small (1-4), use supported actions, and continue from last successful state.`
      : lastError;

    await supabase.from("tool_runs").update({
      status: "failed", error: failureMsg, completed_at: new Date().toISOString(),
    }).eq("id", toolRunId);

    const { data: runData } = await supabase.from("tool_runs").select("tool_call_id").eq("id", toolRunId).single();
    await supabase.from("messages").insert({
      conversation_id: conversationId, user_id: userId,
      role: "tool", content: `Tool execution failed: ${failureMsg}`, tool_call_id: runData?.tool_call_id,
    });
  } catch (e: any) {
    await supabase.from("tool_runs").update({
      status: "failed", error: e.message, completed_at: new Date().toISOString(),
    }).eq("id", toolRunId);
  }
}
