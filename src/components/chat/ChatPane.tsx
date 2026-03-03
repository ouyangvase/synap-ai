import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send, Bot, Plus, Monitor, X, Image as ImageIcon, Globe,
  Hand, Play, Loader2, RefreshCw, Brain, ListChecks, Check
} from "lucide-react";
import { ToolCard } from "./ToolCard";
import { MessageBubble } from "./MessageBubble";
import { ThinkingPanel, ThinkingStep } from "./ThinkingPanel";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

interface Message {
  id: string;
  role: string;
  content: string | null;
  tool_calls: Json | null;
  tool_call_id: string | null;
  metadata: Json;
  created_at: string;
}

interface ToolRun {
  id: string;
  tool_id: string;
  tool_call_id: string;
  status: string;
  input: Json;
  output: Json | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Props {
  conversationId: string | null;
  onNewChat: () => void;
}

export function ChatPane({ conversationId, onNewChat }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<{ data: string; url: string; title: string; time: string }[]>([]);
  const [screenshotPanelOpen, setScreenshotPanelOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [takeOverMode, setTakeOverMode] = useState(false);
  const [livePolling, setLivePolling] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const hasRunningBrowserTool = useMemo(() => {
    return toolRuns.some(r => r.status === "running");
  }, [toolRuns]);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [conversationId]);

  const fetchToolRuns = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from("tool_runs")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (data) setToolRuns(data as ToolRun[]);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) { setMessages([]); setToolRuns([]); setLatestScreenshot(null); setScreenshots([]); setBrowserUrl(null); setThinkingSteps([]); setAwaitingApproval(false); return; }
    fetchMessages();
    fetchToolRuns();

    const msgChannel = supabase
      .channel(`messages-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => fetchMessages())
      .subscribe();

    const runChannel = supabase
      .channel(`tool-runs-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tool_runs", filter: `conversation_id=eq.${conversationId}` }, () => fetchToolRuns())
      .subscribe();

    const approvalChannel = supabase
      .channel(`approvals-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tool_approvals" }, () => fetchToolRuns())
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(runChannel);
      supabase.removeChannel(approvalChannel);
    };
  }, [conversationId, fetchMessages, fetchToolRuns]);

  useEffect(() => { scrollToBottom(); }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    if (hasRunningBrowserTool && !takeOverMode) {
      setLivePolling(true);
      setScreenshotPanelOpen(true);
      pollRef.current = setInterval(() => fetchToolRuns(), 3000);
    } else {
      setLivePolling(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [hasRunningBrowserTool, takeOverMode, fetchToolRuns]);

  useEffect(() => {
    const newScreenshots: { data: string; url: string; title: string; time: string }[] = [];
    let latestUrl: string | null = null;

    for (const run of toolRuns) {
      const output = run.output as Record<string, unknown> | null;
      if (!output) continue;
      if (output.url && typeof output.url === "string") latestUrl = output.url as string;

      if (output.screenshot_url && typeof output.screenshot_url === "string") {
        newScreenshots.push({
          data: output.screenshot_url as string,
          url: (output.url as string) || (output.last_url as string) || "",
          title: (output.title as string) || "",
          time: run.completed_at || run.created_at,
        });
      } else if (output.screenshot && typeof output.screenshot === "string") {
        const screenshotData = output.screenshot as string;
        if (screenshotData.length > 100) {
          const dataWithPrefix = screenshotData.startsWith("data:") ? screenshotData : `data:image/png;base64,${screenshotData}`;
          newScreenshots.push({
            data: dataWithPrefix,
            url: (output.url as string) || (output.last_url as string) || "",
            title: (output.title as string) || "",
            time: run.completed_at || run.created_at,
          });
        }
      }
    }

    if (newScreenshots.length > 0) {
      setScreenshots(newScreenshots);
      setLatestScreenshot(newScreenshots[newScreenshots.length - 1].data);
      setScreenshotPanelOpen(true);
    }
    if (latestUrl) setBrowserUrl(latestUrl);
  }, [toolRuns]);

  // Detect plan messages that need approval
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.content) {
      const metadata = lastMsg.metadata as Record<string, unknown> | null;
      const isPlanMode = metadata?.plan_mode === true;
      const hasPlanFormat = lastMsg.content.toLowerCase().includes("plan") && 
        /\d+\.\s/.test(lastMsg.content) &&
        (lastMsg.content.match(/^\s*\d+\.\s/gm)?.length || 0) >= 3;
      setAwaitingApproval(isPlanMode && hasPlanFormat);
    }
  }, [messages]);

  const handleTakeOver = async () => {
    if (!conversationId || !user) return;
    setTakeOverMode(true);
    toast({ title: "Take Over", description: "Automation paused. You have manual control." });
  };

  const handleApprove = async () => {
    if (!conversationId || !user) return;
    setAwaitingApproval(false);
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: "Approved. Execute the plan step by step.",
    });
    streamResponse();
  };

  const handleResume = async () => {
    if (!conversationId || !user) return;
    setTakeOverMode(false);
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: "Continue from where you left off. Resume the automation.",
    });
    toast({ title: "Resumed", description: "Automation resumed." });
    streamResponse();
  };

  const streamResponse = async () => {
    if (!conversationId) return;
    setIsStreaming(true);
    setStreamingContent("");
    setThinkingSteps([]);

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: conversationId, plan_mode: planMode }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        let errMsg = "Failed to get response";
        try { errMsg = JSON.parse(errBody).error || errMsg; } catch {}
        if (resp.status === 429) errMsg = "Rate limited — please try again shortly.";
        if (resp.status === 402) errMsg = "AI credits exhausted — please top up.";
        throw new Error(errMsg);
      }

      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantSoFar = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.type === "tool_call" || parsed.type === "approval_required" || parsed.type === "tool_result") {
              setThinkingMessage(null);
              await fetchToolRuns();
              continue;
            }
            if (parsed.type === "thinking") {
              setThinkingMessage(parsed.message || "Thinking...");
              setThinkingSteps(prev => [...prev, {
                message: parsed.message || "Thinking...",
                phase: parsed.phase || "reasoning",
                timestamp: new Date().toISOString(),
                tool_name: parsed.tool_name,
              }]);
              continue;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              setThinkingMessage(null);
              assistantSoFar += content;
              setStreamingContent(assistantSoFar);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      await fetchMessages();
      await fetchToolRuns();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setThinkingMessage(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !conversationId || !user || isStreaming) return;
    const userMessage = planMode ? `[PLAN] ${input.trim()}` : input.trim();
    setInput("");

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: userMessage,
    });

    streamResponse();
  };

  const timelineItems = buildTimeline(messages, toolRuns);

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="glass elevation-1 rounded-2xl p-8 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Bot className="w-8 h-8 text-primary/40" />
          </div>
          <p className="text-muted-foreground text-sm">Select or start a conversation</p>
          <Button onClick={onNewChat} variant="outline" className="gap-2 rounded-xl">
            <Plus className="w-4 h-4" /> New conversation
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0">
      <div className={`flex flex-col min-w-0 ${screenshotPanelOpen && latestScreenshot ? "w-1/2" : "flex-1"}`}>
        {/* Browser state indicator */}
        {browserUrl && (
          <div className="px-4 py-1.5 border-b border-border glass-subtle flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${hasRunningBrowserTool ? "bg-amber-500" : "bg-emerald-500"} animate-pulse`} />
            <Globe className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground truncate flex-1">{browserUrl}</span>
            {hasRunningBrowserTool && (
              <span className="text-[10px] text-amber-500 font-medium">Executing...</span>
            )}
            {latestScreenshot && !screenshotPanelOpen && (
              <Button variant="ghost" size="sm" onClick={() => setScreenshotPanelOpen(true)} className="h-6 text-[10px] px-2 rounded-lg">
                View
              </Button>
            )}
          </div>
        )}

        {/* Take Over / Resume control bar */}
        {(hasRunningBrowserTool || takeOverMode) && (
          <div className="px-4 py-2 border-b border-border glass-subtle flex items-center justify-between">
            <div className="flex items-center gap-2">
              {takeOverMode ? (
                <>
                  <Hand className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium text-amber-500">Manual Control Active</span>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  <span className="text-xs font-medium text-muted-foreground">Browser automation running</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!takeOverMode && hasRunningBrowserTool && (
                <Button variant="outline" size="sm" onClick={handleTakeOver} className="h-7 text-xs gap-1 rounded-xl border-amber-500/30 text-amber-600 hover:bg-amber-500/10">
                  <Hand className="w-3 h-3" /> Take Over
                </Button>
              )}
              {takeOverMode && (
                <Button variant="outline" size="sm" onClick={handleResume} disabled={isStreaming} className="h-7 text-xs gap-1 rounded-xl border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10">
                  <Play className="w-3 h-3" /> Resume Auto
                </Button>
              )}
            </div>
          </div>
        )}

        {latestScreenshot && !screenshotPanelOpen && !browserUrl && (
          <div className="p-2 border-b border-border glass-subtle">
            <Button variant="outline" size="sm" onClick={() => setScreenshotPanelOpen(true)} className="gap-2 text-xs rounded-xl">
              <Monitor className="w-3.5 h-3.5" /> Show Browser Screenshot
            </Button>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-1">
          {timelineItems.map((item) => {
            if (item.type === "message") {
              return <MessageBubble key={item.data.id} message={item.data as Message} />;
            }
            if (item.type === "tool_run") {
              return (
                <ToolCard
                  key={item.data.id}
                  toolRun={item.data as ToolRun}
                  conversationId={conversationId}
                  onTakeOver={handleTakeOver}
                  onResume={handleResume}
                />
              );
            }
            return null;
          })}

          {/* Plan approval buttons */}
          {awaitingApproval && !isStreaming && (
            <div className="max-w-3xl mx-auto px-2 py-2">
              <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-3">
                <ListChecks className="w-5 h-5 text-primary shrink-0" />
                <span className="text-sm text-muted-foreground flex-1">Plan ready for review</span>
                <Button size="sm" onClick={handleApprove} className="gap-1.5 rounded-xl h-8">
                  <Check className="w-3.5 h-3.5" /> Approve & Execute
                </Button>
              </div>
            </div>
          )}

          {/* Thinking panel */}
          {(thinkingSteps.length > 0 || (isStreaming && thinkingMessage)) && (
            <ThinkingPanel steps={thinkingSteps} isActive={isStreaming} />
          )}

          {/* Streaming content */}
          {isStreaming && streamingContent && (
            <MessageBubble
              message={{
                id: "streaming",
                role: "assistant",
                content: streamingContent,
                tool_calls: null,
                tool_call_id: null,
                metadata: planMode ? { plan_mode: true } : {},
                created_at: new Date().toISOString(),
              }}
              isStreaming
            />
          )}

          {isStreaming && !streamingContent && !thinkingMessage && (
            <div className="max-w-3xl mx-auto px-2 py-2">
              <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot" />
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot [animation-delay:0.3s]" />
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot [animation-delay:0.6s]" />
                </div>
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border/30 p-4 glass-strong">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2 max-w-3xl mx-auto"
          >
            {/* Plan Mode toggle */}
            <Button
              type="button"
              variant={planMode ? "default" : "ghost"}
              size="icon"
              onClick={() => setPlanMode(!planMode)}
              className={`rounded-2xl h-11 w-11 shrink-0 transition-all ${planMode ? "elevation-glow" : ""}`}
              title={planMode ? "Plan mode ON — agent will plan before executing" : "Plan mode OFF"}
            >
              <ListChecks className="w-4 h-4" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={planMode ? "Describe the task to plan…" : takeOverMode ? "Type instructions for the agent..." : "Message the agent…"}
              disabled={isStreaming}
              className="flex-1 glass-input border-border/30 rounded-2xl h-11"
            />
            <Button type="submit" size="icon" disabled={isStreaming || !input.trim()} className="rounded-2xl h-11 w-11 shrink-0 elevation-glow active:translate-y-[1px] transition-all">
              <Send className="w-4 h-4" />
            </Button>
          </form>
          {planMode && (
            <div className="max-w-3xl mx-auto mt-1.5 px-1">
              <span className="text-[10px] text-primary/70 flex items-center gap-1">
                <ListChecks className="w-3 h-3" /> Plan mode — agent will create a step-by-step plan before executing
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Browser Screenshot Panel */}
      {screenshotPanelOpen && latestScreenshot && (
        <div className="w-1/2 flex flex-col border-l border-border bg-background">
          <div className="flex items-center justify-between p-2 border-b border-border glass-subtle">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-xs font-medium shrink-0">Browser View</span>
              {livePolling && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Live
                </span>
              )}
              {screenshots.length > 0 && screenshots[screenshots.length - 1].url && (
                <span className="text-[10px] text-muted-foreground truncate">
                  {screenshots[screenshots.length - 1].url}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {screenshots.length > 1 && (
                <span className="text-[10px] text-muted-foreground">{screenshots.length} captures</span>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => setScreenshotPanelOpen(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3">
            <div className="relative">
              <img
                src={latestScreenshot?.startsWith("data:") || latestScreenshot?.startsWith("http") ? latestScreenshot : `data:image/png;base64,${latestScreenshot}`}
                alt="Browser screenshot"
                className="max-w-full rounded-xl border border-border elevation-1"
              />
              {livePolling && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded-full">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  LIVE
                </div>
              )}
            </div>
            {screenshots.length > 1 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">History</p>
                <div className="flex gap-2 flex-wrap">
                  {screenshots.slice(0, -1).reverse().map((s, i) => (
                    <button key={i} onClick={() => setLatestScreenshot(s.data)} className="group relative">
                      <img
                        src={s.data.startsWith("data:") || s.data.startsWith("http") ? s.data : `data:image/png;base64,${s.data}`}
                        alt={`Screenshot ${screenshots.length - 1 - i}`}
                        className="w-24 h-16 object-cover rounded-lg border border-border opacity-70 group-hover:opacity-100 transition-opacity"
                      />
                      {s.url && (
                        <span className="absolute bottom-0.5 left-0.5 right-0.5 text-[8px] text-white bg-black/60 rounded px-0.5 truncate">
                          {new URL(s.url).pathname}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildTimeline(messages: Message[], toolRuns: ToolRun[]) {
  const items: { type: string; data: Message | ToolRun; time: string }[] = [];
  messages.forEach((m) => items.push({ type: "message", data: m, time: m.created_at }));
  toolRuns.forEach((r) => items.push({ type: "tool_run", data: r, time: r.created_at }));
  items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return items;
}
