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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    // Auth: create client with user's token
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

    const { conversation_id } = await req.json();
    if (!conversation_id) throw new Error("conversation_id required");

    // Use service role for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify conversation ownership
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*, agents(*)")
      .eq("id", conversation_id)
      .single();

    if (!conversation || conversation.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agent = conversation.agents;
    const systemPrompt = agent?.system_prompt || "You are a helpful AI assistant.";
    let model = agent?.model || "gemini-2.0-flash";
    // Strip provider prefix if present (e.g., "google/gemini-3-flash-preview" -> "gemini-2.0-flash")
    if (model.startsWith("google/")) model = "gemini-2.0-flash";

    // Get available tools for this agent
    let tools: ToolDef[] = [];
    if (agent) {
      const { data: agentTools } = await supabase
        .from("agent_tools")
        .select("tool_id, tools(*)")
        .eq("agent_id", agent.id);

      if (agentTools) {
        tools = agentTools
          .map((at: any) => at.tools)
          .filter((t: any) => t && t.is_active);
      }
    }

    // Load conversation history
    const { data: dbMessages } = await supabase
      .from("messages")
      .select("role, content, tool_call_id, tool_calls")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    const llmMessages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const m of dbMessages || []) {
      const msg: any = { role: m.role, content: m.content || "" };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      llmMessages.push(msg);
    }

    // Build tool definitions for LLM
    const llmTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));

    // Call LLM with streaming
    const llmBody: any = {
      model,
      messages: llmMessages,
      stream: true,
    };
    if (llmTools.length > 0) {
      llmBody.tools = llmTools;
    }

    const llmResponse = await fetchWithRetry(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(llmBody),
      }
    );

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("LLM error:", llmResponse.status, errText);
      if (llmResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (llmResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("LLM request failed");
    }

    // Process stream: collect tool calls and stream text
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = llmResponse.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullContent = "";
          let toolCallsAccumulator: Record<number, { id: string; function: { name: string; arguments: string } }> = {};
          let finishReason = "";

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

                if (choice.finish_reason) finishReason = choice.finish_reason;

                const delta = choice.delta;
                if (!delta) continue;

                // Text content
                if (delta.content) {
                  fullContent += delta.content;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                }

                // Tool calls
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsAccumulator[idx]) {
                      toolCallsAccumulator[idx] = { id: tc.id || "", function: { name: "", arguments: "" } };
                    }
                    if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallsAccumulator[idx].function.name += tc.function.name;
                    if (tc.function?.arguments) toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
                  }
                }
              } catch {
                // partial JSON, ignore
              }
            }
          }

          // Save assistant message
          const toolCallsList = Object.values(toolCallsAccumulator);
          const assistantMsg: any = {
            conversation_id,
            user_id: user.id,
            role: "assistant",
            content: fullContent || null,
            tool_calls: toolCallsList.length > 0 ? toolCallsList : null,
          };
          await supabase.from("messages").insert(assistantMsg);

          // Handle tool calls - AGENTIC LOOP: keep calling tools until AI gives a text response
          if (toolCallsList.length > 0) {
            let loopMessages = [...llmMessages];
            let currentToolCalls = toolCallsList;
            let currentContent = fullContent;
            const MAX_AGENT_LOOPS = 8; // safety limit

            for (let agentLoop = 0; agentLoop < MAX_AGENT_LOOPS; agentLoop++) {
              const toolResultMessages: any[] = [];
              let hasApprovalPending = false;

              for (const tc of currentToolCalls) {
                const tool = tools.find((t) => t.name === tc.function.name);
                if (!tool) continue;

                let parsedArgs: Record<string, unknown> = {};
                try { parsedArgs = JSON.parse(tc.function.arguments); } catch {}

                // Create tool run
                const { data: toolRun } = await supabase
                  .from("tool_runs")
                  .insert({
                    conversation_id,
                    user_id: user.id,
                    tool_id: tool.id,
                    tool_call_id: tc.id,
                    status: tool.requires_approval ? "pending" : "running",
                    input: parsedArgs,
                    started_at: tool.requires_approval ? null : new Date().toISOString(),
                  })
                  .select()
                  .single();

                if (tool.requires_approval && toolRun) {
                  await supabase.from("tool_approvals").insert({
                    tool_run_id: toolRun.id,
                    status: "pending",
                  });
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "approval_required", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
                  hasApprovalPending = true;
                } else if (toolRun) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
                  await executeToolRun(supabase, toolRun.id, tool, parsedArgs, user.id, conversation_id);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", tool_run_id: toolRun.id })}\n\n`));

                  const { data: completedRun } = await supabase
                    .from("tool_runs")
                    .select("output, status, tool_call_id")
                    .eq("id", toolRun.id)
                    .single();

                  if (completedRun) {
                    const resultContent = completedRun.output?.markdown_content || JSON.stringify(completedRun.output || {});
                    toolResultMessages.push({
                      role: "tool",
                      content: typeof resultContent === 'string' ? resultContent.substring(0, 10000) : JSON.stringify(resultContent).substring(0, 10000),
                      tool_call_id: completedRun.tool_call_id,
                    });
                  }
                }
              }

              // If approval is pending, stop the loop
              if (hasApprovalPending) break;

              // If no tool results, stop
              if (toolResultMessages.length === 0) break;

              // Build follow-up messages for next LLM call
              loopMessages = [
                ...loopMessages,
                {
                  role: "assistant",
                  content: currentContent || null,
                  tool_calls: currentToolCalls.map((tc) => ({
                    id: tc.id, type: "function",
                    function: { name: tc.function.name, arguments: tc.function.arguments }
                  }))
                },
                ...toolResultMessages,
              ];

              // Save tool result messages to DB
              for (const trm of toolResultMessages) {
                await supabase.from("messages").insert({
                  conversation_id,
                  user_id: user.id,
                  role: "tool",
                  content: trm.content,
                  tool_call_id: trm.tool_call_id,
                });
              }

              const followUpBody: any = {
                model,
                messages: loopMessages,
                stream: true,
              };
              if (llmTools.length > 0) followUpBody.tools = llmTools;

              const followUpResp = await fetchWithRetry(
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${geminiApiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(followUpBody),
                }
              );

              if (!followUpResp.ok) break;

              // Parse follow-up response
              const followReader = followUpResp.body!.getReader();
              const followDecoder = new TextDecoder();
              let followBuffer = "";
              let followContent = "";
              let followToolCalls: Record<number, { id: string; function: { name: string; arguments: string } }> = {};
              let followFinish = "";

              while (true) {
                const { done: fDone, value: fValue } = await followReader.read();
                if (fDone) break;
                followBuffer += followDecoder.decode(fValue, { stream: true });

                let fIdx: number;
                while ((fIdx = followBuffer.indexOf("\n")) !== -1) {
                  let fLine = followBuffer.slice(0, fIdx);
                  followBuffer = followBuffer.slice(fIdx + 1);
                  if (fLine.endsWith("\r")) fLine = fLine.slice(0, -1);
                  if (!fLine.startsWith("data: ") || fLine.trim() === "") continue;
                  const fJson = fLine.slice(6).trim();
                  if (fJson === "[DONE]") continue;

                  try {
                    const fParsed = JSON.parse(fJson);
                    const fChoice = fParsed.choices?.[0];
                    if (!fChoice) continue;
                    if (fChoice.finish_reason) followFinish = fChoice.finish_reason;
                    const fDelta = fChoice.delta;
                    if (!fDelta) continue;

                    if (fDelta.content) {
                      followContent += fDelta.content;
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(fParsed)}\n\n`));
                    }
                    if (fDelta.tool_calls) {
                      for (const tc of fDelta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!followToolCalls[idx]) {
                          followToolCalls[idx] = { id: tc.id || "", function: { name: "", arguments: "" } };
                        }
                        if (tc.id) followToolCalls[idx].id = tc.id;
                        if (tc.function?.name) followToolCalls[idx].function.name += tc.function.name;
                        if (tc.function?.arguments) followToolCalls[idx].function.arguments += tc.function.arguments;
                      }
                    }
                  } catch {}
                }
              }

              // Save follow-up assistant message
              const followToolCallsList = Object.values(followToolCalls);
              if (followContent || followToolCallsList.length > 0) {
                await supabase.from("messages").insert({
                  conversation_id,
                  user_id: user.id,
                  role: "assistant",
                  content: followContent || null,
                  tool_calls: followToolCallsList.length > 0 ? followToolCallsList : null,
                });
              }

              // If the follow-up also has tool calls, continue the loop
              if (followToolCallsList.length > 0) {
                currentToolCalls = followToolCallsList;
                currentContent = followContent;
                continue; // next iteration of agent loop
              }

              // Otherwise, we're done - AI gave a text response
              break;
            }
          }

          // Update conversation title if it's the first exchange
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function executeToolRun(
  supabase: any,
  toolRunId: string,
  tool: ToolDef,
  input: Record<string, unknown>,
  userId: string,
  conversationId: string
) {
  try {
    // Get endpoint
    const { data: endpoint } = await supabase
      .from("tool_endpoints")
      .select("*")
      .eq("tool_id", tool.id)
      .single();

    if (!endpoint) {
      await supabase.from("tool_runs").update({
        status: "failed",
        error: "No endpoint configured",
        completed_at: new Date().toISOString(),
      }).eq("id", toolRunId);
      return;
    }

    const ep = endpoint as ToolEndpoint;

    // Resolve N8N_WEBHOOK_BASE_URL placeholder in endpoint URL
    let resolvedUrl = ep.endpoint_url;
    const n8nBase = Deno.env.get("N8N_WEBHOOK_BASE_URL");
    if (n8nBase && resolvedUrl.includes("{N8N_WEBHOOK_BASE_URL}")) {
      resolvedUrl = resolvedUrl.replace("{N8N_WEBHOOK_BASE_URL}", n8nBase.replace(/\/$/, ""));
    }

    const payload = {
      meta: { tool_name: tool.name, tool_run_id: toolRunId, user_id: userId, conversation_id: conversationId },
      input,
    };

    let lastError: string = "";
    for (let attempt = 0; attempt <= ep.max_retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ep.timeout_ms);

        const resp = await fetch(resolvedUrl, {
          method: ep.http_method,
          headers: { "Content-Type": "application/json", ...(ep.headers as Record<string, string>) },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}: ${await resp.text()}`;
          if (resp.status >= 500 && attempt < ep.max_retries) {
            await delay(Math.pow(2, attempt) * 500 + Math.random() * 500);
            continue;
          }
          throw new Error(lastError);
        }

        const result = await resp.json();
        await supabase.from("tool_runs").update({
          status: "completed",
          output: result,
          completed_at: new Date().toISOString(),
        }).eq("id", toolRunId);

        // Insert tool result as message
        const resultContent = result.markdown_content || JSON.stringify(result);
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "tool",
          content: resultContent,
          tool_call_id: (await supabase.from("tool_runs").select("tool_call_id").eq("id", toolRunId).single()).data?.tool_call_id,
        });

        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          lastError = "Request timed out";
          if (attempt < ep.max_retries) {
            await delay(Math.pow(2, attempt) * 500);
            continue;
          }
        }
        lastError = err.message;
      }
    }

    await supabase.from("tool_runs").update({
      status: "failed",
      error: lastError,
      completed_at: new Date().toISOString(),
    }).eq("id", toolRunId);
  } catch (e: any) {
    await supabase.from("tool_runs").update({
      status: "failed",
      error: e.message,
      completed_at: new Date().toISOString(),
    }).eq("id", toolRunId);
  }
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
