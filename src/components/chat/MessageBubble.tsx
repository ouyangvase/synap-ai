import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface Props {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem || message.role === "tool") return null;
  if (!message.content && !isStreaming) return null;

  return (
    <div className={cn("flex gap-3 px-2 py-3 max-w-3xl mx-auto animate-slide-up", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-all",
          isUser ? "glass elevation-1" : "bg-primary/10 glow-dot-primary"
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5 text-muted-foreground" /> : <Bot className="w-3.5 h-3.5 text-primary" />}
      </div>
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] transition-all",
          isUser
            ? "bg-primary text-primary-foreground elevation-2 depth-shadow"
            : "glass-card glass-highlight"
        )}
      >
        {message.content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_pre]:bg-secondary/80 [&_pre]:p-3 [&_pre]:rounded-xl [&_code]:text-primary [&_code]:font-mono [&_code]:text-xs">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        ) : null}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse-dot ml-0.5 align-middle rounded-full" />
        )}
      </div>
    </div>
  );
}
