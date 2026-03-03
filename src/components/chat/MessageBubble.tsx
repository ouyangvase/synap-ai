import ReactMarkdown from "react-markdown";
import { Bot, User, CheckCircle2, Circle } from "lucide-react";
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
  completedSteps?: number[];
}

function isPlanMessage(content: string): boolean {
  // Detect numbered plan format: lines starting with 1. 2. 3. etc.
  const lines = content.split("\n").filter(l => l.trim());
  const numberedLines = lines.filter(l => /^\s*\d+\.\s/.test(l));
  return numberedLines.length >= 3 && content.toLowerCase().includes("plan");
}

function renderPlanContent(content: string, completedSteps: number[]) {
  const lines = content.split("\n");
  let stepIndex = 0;

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const stepMatch = line.match(/^\s*(\d+)\.\s(.+)/);
        if (stepMatch) {
          const currentStep = stepIndex;
          stepIndex++;
          const isCompleted = completedSteps.includes(currentStep);
          return (
            <div key={i} className={cn(
              "flex items-start gap-2 py-1 px-2 rounded-lg transition-all",
              isCompleted && "bg-emerald-500/10"
            )}>
              {isCompleted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <span className={cn(
                "text-sm",
                isCompleted && "text-emerald-400 line-through opacity-70"
              )}>
                {stepMatch[2]}
              </span>
            </div>
          );
        }
        if (line.trim()) {
          return (
            <div key={i} className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1">
              <ReactMarkdown>{line}</ReactMarkdown>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export function MessageBubble({ message, isStreaming, completedSteps = [] }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem || message.role === "tool") return null;
  if (!message.content && !isStreaming) return null;

  const isPlan = message.content ? isPlanMessage(message.content) : false;
  const metadata = message.metadata as Record<string, unknown> | null;
  const isPlanMode = metadata?.plan_mode === true;

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
            : isPlan || isPlanMode
              ? "glass-card glow-border"
              : "glass-card glass-highlight"
        )}
      >
        {message.content ? (
          isPlan ? (
            renderPlanContent(message.content, completedSteps)
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_pre]:bg-secondary/80 [&_pre]:p-3 [&_pre]:rounded-xl [&_code]:text-primary [&_code]:font-mono [&_code]:text-xs">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )
        ) : null}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse-dot ml-0.5 align-middle rounded-full" />
        )}
      </div>
    </div>
  );
}
