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

/**
 * Sanitize a single tool_call so it is valid for Gemini's OpenAI-compat API.
 * Returns null if the call is unsalvageable (empty function name).
 */
function sanitizeToolCall(tc: any): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
  const name = tc?.function?.name || tc?.name || "";
  if (!name || name === "unknown") return null; // DROP calls with empty/unknown name

  const id = tc?.id || tc?.function?.id || `call_${Math.random().toString(36).slice(2, 10)}`;
  let args: string;
  if (typeof tc?.function?.arguments === "string") {
    args = tc.function.arguments;
  } else {
    args = JSON.stringify(tc?.function?.arguments || tc?.arguments || {});
  }

  return { id, type: "function", function: { name, arguments: args } };
}

/**
 * Build a clean LLM message array from DB rows.
 * Drops any tool_call whose function.name is empty (prevents Gemini 400).
 * Also drops orphaned tool results with no matching assistant tool_call.
 */
function buildLlmMessages(systemPrompt: string, dbMessages: any[]): any[] {
  const msgs: any[] = [{ role: "system", content: systemPrompt }];
  const validToolCallIds = new Set<string>();

  for (const m of dbMessages || []) {
    if (!m.role) continue;

    // ── assistant ──
    if (m.role === "assistant") {
      const msg: any = { role: "assistant" };
      if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const sanitized = (m.tool_calls as any[]).map(sanitizeToolCall).filter(Boolean) as any[];
        if (sanitized.length > 0) {
          msg.tool_calls = sanitized;
          msg.content = m.content || "";
          sanitized.forEach((tc: any) => validToolCallIds.add(tc.id));
        } else {
          // All tool calls had empty names — convert to plain text
          msg.content = m.content || "(tool call omitted)";
        }
      } else {
        msg.content = m.content || "";
        if (!msg.content) continue;
      }
      msgs.push(msg);
      continue;
    }

    // ── tool result ──
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

    // ── user ──
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content || "" });
      continue;
    }
  }

  // Gemini requires last message to be user or tool
  const last = msgs[msgs.length - 1];
  if (last && last.role === "assistant" && !last.tool_calls) {
    msgs.push({ role: "user", content: "(continue)" });
  }

  return msgs;
}

/**
 * Deduplicate consecutive identical user messages.
 */
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

// ── Main serve ──────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id } = await req.json();
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
    const systemPrompt = agent?.system_prompt || "You are a helpful AI assistant.";
    let model = agent?.model || "gemini-2.0-flash";
    if (model.startsWith("google/")) model = "gemini-2.0-flash";
    const validModels = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash-preview"];
    if (!validModels.some(m => model.includes(m))) model = "gemini-2.0-flash";

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
    }));

    const llmResponse = await fetchWithRetry(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${geminiApiKey}`, "Content-Type": "application/json" },
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
      let detailedError = `AI service error (HTTP ${llmResponse.status})`;
      try {
        const errJson = JSON.parse(errText);
        const errMsg = errJson?.[0]?.error?.message || errJson?.error?.message;
        if (errMsg) {
          detailedError = errMsg;
          if (errMsg.includes("API key not valid")) detailedError = "Gemini API key is invalid.";
        }
      } catch {}
      throw new Error(detailedError);
    }

    // ── Stream response ──
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const { fullContent, toolCallsList } = await processStream(llmResponse, controller, encoder);

          await supabase.from("messages").insert({
            conversation_id, user_id: user.id, role: "assistant",
            content: fullContent || null,
            tool_calls: toolCallsList.length > 0 ? toolCallsList : null,
          });

          // ── Agentic loop ──
          if (toolCallsList.length > 0) {
            let loopMessages = [...llmMessages];
            let currentToolCalls = toolCallsList;
            let currentContent = fullContent;
            const MAX_LOOPS = 16;
            const loopStartTime = Date.now();
            // Edge functions have a hard wall-clock limit (~60s free, ~150s pro).
            // Reserve 10s for overhead. Stop starting new iterations after this.
            const MAX_LOOP_ELAPSED_MS = 50_000; // 50s safety limit

            for (let loop = 0; loop < MAX_LOOPS; loop++) {
              // ── Wall-clock guard ──
              const elapsed = Date.now() - loopStartTime;
              if (elapsed > MAX_LOOP_ELAPSED_MS) {
                console.warn(`[agentic-loop] Wall-clock limit reached (${elapsed}ms). Stopping loop to prevent edge fn timeout.`);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "\n\n*Continuing in next message — processing time limit reached. Send any message to continue.*" } }] })}\n\n`));
                break;
              }

              const toolResultMsgs: any[] = [];
              let approvalPending = false;

              for (const tc of currentToolCalls) {
                if (!tc.function.name || tc.function.name === "unknown") {
                  console.warn("Skipping tool call with empty name:", JSON.stringify(tc));
                  continue;
                }

                const tool = tools.find((t) => t.name === tc.function.name);
                if (!tool) { console.warn("Tool not found:", tc.function.name); continue; }

                let parsedArgs: Record<string, unknown> = {};
                try { parsedArgs = JSON.parse(tc.function.arguments); } catch {}

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
                  await executeToolRun(supabase, toolRun.id, tool, parsedArgs, user.id, conversation_id);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", tool_run_id: toolRun.id })}\n\n`));

                  const { data: completedRun } = await supabase
                    .from("tool_runs")
                    .select("output, status, error, tool_call_id")
                    .eq("id", toolRun.id)
                    .single();

                  if (completedRun) {
                    let rc = completedRun.output?.markdown_content || JSON.stringify(completedRun.output || {});
                    if (typeof rc !== "string") rc = JSON.stringify(rc);

                    // Pass error information to the LLM if tool failed so it can debug and retry
                    if (completedRun.status === "failed") {
                      rc = `ERROR: Tool "${tool.name}" failed.\nError: ${completedRun.error || "Unknown error"}\nPlease analyze the error and try a different approach.`;
                    }

                    // Recovery mode — nudge LLM to retry on verification failure
                    const outcomeStatus = completedRun.output?.outcome_status;
                    const verificationStatus = completedRun.output?.verification_status;
                    if (tool.name === "browser_do" && (outcomeStatus === "needs_attention" || verificationStatus === "verification_failed")) {
                      rc += "\n\n⚠️ VERIFICATION FAILED — The action may not have completed successfully. " +
                        "You MUST retry with a corrected approach. Common issues:\n" +
                        "- A confirmation dialog/modal may need to be clicked\n" +
                        "- The button click may not have registered (try click_in_row instead of click_by_text)\n" +
                        "- A dropdown/select may need to be chosen before clicking Assign\n" +
                        "- There may be a required field that wasn't filled\n" +
                        "DO NOT report this task as complete. Issue a new browser_do call to fix and verify.";
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

              // ── Emit "thinking" event so UI shows the agent is reasoning ──
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "thinking", message: "Analyzing results and planning next step..." })}\n\n`));

              const followUpResp = await fetchWithRetry(
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${geminiApiKey}`, "Content-Type": "application/json" },
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
  input: Record<string, unknown>, userId: string, conversationId: string
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

    // Dynamic timeout: browser_do needs time for multi-step flows but must fit in edge fn limit
    const isBrowserDo = tool.name === "browser_do";
    const stepCount = isBrowserDo && Array.isArray(input.steps) ? input.steps.length : 0;
    // browser_do: 20s base + 10s per step, min 50s, max 90s (edge fn has ~60-150s limit)
    const effectiveTimeout = isBrowserDo
      ? Math.min(Math.max(20_000 + stepCount * 10_000, 50_000), 90_000)
      : ep.timeout_ms;

    let lastError = "";
    const maxRetries = isBrowserDo ? 2 : ep.max_retries; // browser_do gets 2 retries

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), effectiveTimeout);
        const resp = await fetch(resolvedUrl, {
          method: ep.http_method,
          headers: {
            "Content-Type": "application/json",
            ...(ep.headers as Record<string, string>),
            ...(resolvedUrl.includes(Deno.env.get("SUPABASE_URL") || "NONE") ? {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`,
              apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
            } : {}),
          },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}: ${await resp.text()}`;
          if (resp.status >= 500 && attempt < maxRetries) {
            console.warn(`[executeToolRun] ${tool.name} attempt ${attempt} failed (${resp.status}), retrying...`);
            await delay(Math.pow(2, attempt) * 1000 + Math.random() * 1000);
            continue;
          }
          throw new Error(lastError);
        }

        const result = await resp.json();

        // ── Proof-gated completion: browser_do status reflects outcome ──
        let runStatus = "completed";
        if (isBrowserDo && result.outcome_status === "needs_attention") {
          runStatus = "failed"; // Mark as failed so UI shows failure correctly
        }
        if (isBrowserDo && result.has_failures && !result.verification_status) {
          runStatus = "failed";
        }

        await supabase.from("tool_runs").update({
          status: runStatus, output: result, completed_at: new Date().toISOString(),
        }).eq("id", toolRunId);

        const resultContent = result.markdown_content || JSON.stringify(result);
        const { data: runData } = await supabase.from("tool_runs").select("tool_call_id").eq("id", toolRunId).single();
        await supabase.from("messages").insert({
          conversation_id: conversationId, user_id: userId,
          role: "tool", content: resultContent, tool_call_id: runData?.tool_call_id,
        });
        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          lastError = `Browser action timed out after ${effectiveTimeout / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})`;
          console.warn(`[executeToolRun] ${tool.name} aborted on attempt ${attempt}:`, lastError);
          if (attempt < maxRetries) {
            await delay(Math.pow(2, attempt) * 1000);
            continue;
          }
        } else {
          lastError = err.message;
          if (attempt < maxRetries) {
            console.warn(`[executeToolRun] ${tool.name} error on attempt ${attempt}, retrying:`, lastError);
            await delay(Math.pow(2, attempt) * 1000);
            continue;
          }
        }
      }
    }

    // If all retries exhausted, store a helpful error message
    const failureMsg = isBrowserDo
      ? `${lastError}. The browser flow took too long. Try splitting into fewer steps per browser_do call, or ensure each step has proper waits.`
      : lastError;

    await supabase.from("tool_runs").update({
      status: "failed", error: failureMsg, completed_at: new Date().toISOString(),
    }).eq("id", toolRunId);

    // Also insert a tool message so the LLM knows about the failure and can self-correct
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
