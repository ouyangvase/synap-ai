import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, Plus, Monitor, X } from "lucide-react";
import { ToolCard } from "./ToolCard";
import { MessageBubble } from "./MessageBubble";
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
  const [browserLiveUrl, setBrowserLiveUrl] = useState<string | null>(null);
  const [browserPanelOpen, setBrowserPanelOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [conversationId]);

  // Fetch tool runs
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
    if (!conversationId) { setMessages([]); setToolRuns([]); return; }
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

  // Detect live browser URL from tool runs
  useEffect(() => {
    for (const run of toolRuns) {
      const output = run.output as Record<string, unknown> | null;
      if (output?.live_url && typeof output.live_url === "string") {
        if (output.live_url !== browserLiveUrl) {
          setBrowserLiveUrl(output.live_url as string);
          setBrowserPanelOpen(true);
        }
      }
      // Detect browser_stop
      if (output?.stopped === true) {
        setBrowserLiveUrl(null);
        setBrowserPanelOpen(false);
      }
    }
  }, [toolRuns]);

  const handleSend = async () => {
    if (!input.trim() || !conversationId || !user || isStreaming) return;
    const userMessage = input.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    try {
      // Insert user message
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: userMessage,
      });

      // Stream from edge function
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
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
            // Check for tool_call events
            if (parsed.type === "tool_call") {
              await fetchToolRuns();
              continue;
            }
            if (parsed.type === "approval_required") {
              await fetchToolRuns();
              continue;
            }
            if (parsed.type === "tool_result") {
              await fetchToolRuns();
              continue;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setStreamingContent(assistantSoFar);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Refresh messages from DB
      await fetchMessages();
      await fetchToolRuns();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  // Build timeline: merge messages and tool runs
  const timelineItems = buildTimeline(messages, toolRuns);

  if (!conversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <Bot className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">Select or start a conversation</p>
        <Button onClick={onNewChat} variant="outline" className="gap-2">
          <Plus className="w-4 h-4" /> New conversation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0">
      {/* Chat column */}
      <div className={`flex flex-col min-w-0 ${browserPanelOpen ? "w-1/2" : "flex-1"}`}>
        {/* Browser panel toggle button */}
        {browserLiveUrl && !browserPanelOpen && (
          <div className="p-2 border-b border-border bg-primary/5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBrowserPanelOpen(true)}
              className="gap-2 text-xs"
            >
              <Monitor className="w-3.5 h-3.5" />
              Show Live Browser
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
              />
            );
          }
          return null;
        })}

        {/* Streaming indicator */}
        {isStreaming && streamingContent && (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent,
              tool_calls: null,
              tool_call_id: null,
              metadata: {},
              created_at: new Date().toISOString(),
            }}
            isStreaming
          />
        )}

        {isStreaming && !streamingContent && (
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot" />
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot [animation-delay:0.3s]" />
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse-dot [animation-delay:0.6s]" />
            </div>
            <span className="text-xs text-muted-foreground">Thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2 max-w-3xl mx-auto"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the agent…"
            disabled={isStreaming}
            className="flex-1 bg-secondary border-border"
          />
          <Button type="submit" size="icon" disabled={isStreaming || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>

      {/* Live Browser Panel */}
      {browserPanelOpen && browserLiveUrl && (
        <div className="w-1/2 flex flex-col border-l border-border bg-background">
          <div className="flex items-center justify-between p-2 border-b border-border bg-muted/50">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium">Live Browser</span>
              <span className="text-xs text-muted-foreground">Watch the agent work</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setBrowserPanelOpen(false)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <iframe
            src={browserLiveUrl}
            className="flex-1 w-full"
            title="Live Browser View"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
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
