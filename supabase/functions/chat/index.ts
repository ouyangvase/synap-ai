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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

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
    const model = agent?.model || "google/gemini-3-flash-preview";

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
        strict: true,
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
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
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

          // Handle tool calls
          if (toolCallsList.length > 0) {
            for (const tc of toolCallsList) {
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
                // Create approval request
                await supabase.from("tool_approvals").insert({
                  tool_run_id: toolRun.id,
                  status: "pending",
                });
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "approval_required", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
              } else if (toolRun) {
                // Execute immediately
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_call", tool_run_id: toolRun.id, tool_name: tool.name })}\n\n`));
                await executeToolRun(supabase, toolRun.id, tool, parsedArgs, user.id, conversation_id);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool_result", tool_run_id: toolRun.id })}\n\n`));
              }
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
    const payload = {
      meta: { tool_name: tool.name, tool_run_id: toolRunId, user_id: userId, conversation_id: conversationId },
      input,
    };

    let lastError: string = "";
    for (let attempt = 0; attempt <= ep.max_retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ep.timeout_ms);

        const resp = await fetch(ep.endpoint_url, {
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
