import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot } from "lucide-react";

interface TaskPanelProps {
  session: { id: string; status: string } | null;
  onSubmitTask: (description: string) => void;
}

export function TaskPanel({ session, onSubmitTask }: TaskPanelProps) {
  const [input, setInput] = useState("");
  const [tasks, setTasks] = useState<{ description: string; time: string }[]>([]);

  const handleSubmit = () => {
    if (!input.trim() || !session) return;
    onSubmitTask(input.trim());
    setTasks((prev) => [...prev, { description: input.trim(), time: new Date().toLocaleTimeString() }]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border glass-subtle">
        <h2 className="text-sm font-bold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
          <Bot className="w-4 h-4" />
          Task Panel
        </h2>
      </div>

      {/* Task history */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tasks.length === 0 && (
          <p className="text-muted-foreground text-xs text-center py-8">
            Describe a task for the browser agent to complete.
            <br />
            <span className="text-muted-foreground/60">
              e.g. "Check my inbox", "Download the Q4 report"
            </span>
          </p>
        )}
        {tasks.map((task, i) => (
          <div key={i} className="glass-subtle rounded-xl p-3 space-y-1">
            <p className="text-sm">{task.description}</p>
            <p className="text-xs text-muted-foreground">{task.time}</p>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-border glass-subtle">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={session ? "Describe a task…" : "Start a session first"}
            disabled={!session}
            className="min-h-[60px] resize-none bg-muted/30 rounded-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={!session || !input.trim()}
            size="icon"
            className="shrink-0 self-end rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
