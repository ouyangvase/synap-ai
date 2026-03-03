import { useState } from "react";
import { Lightbulb, Brain, Cog, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface ThinkingStep {
  message: string;
  phase: "planning" | "reasoning" | "executing" | "verifying";
  timestamp: string;
  tool_name?: string;
}

interface Props {
  steps: ThinkingStep[];
  isActive: boolean;
}

const phaseConfig = {
  planning: { icon: Lightbulb, color: "text-amber-500", bg: "bg-amber-500/10", label: "Planning" },
  reasoning: { icon: Brain, color: "text-purple-500", bg: "bg-purple-500/10", label: "Reasoning" },
  executing: { icon: Cog, color: "text-blue-500", bg: "bg-blue-500/10", label: "Executing" },
  verifying: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Verifying" },
};

export function ThinkingPanel({ steps, isActive }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  if (steps.length === 0 && !isActive) return null;

  const latestStep = steps[steps.length - 1];
  const currentPhase = latestStep?.phase || "reasoning";
  const config = phaseConfig[currentPhase];
  const Icon = config.icon;

  return (
    <div className="max-w-3xl mx-auto px-2 py-1">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full">
          <div className={cn(
            "glass-card rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer hover:elevation-2 transition-all",
            isActive && "glow-border"
          )}>
            <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0", config.bg)}>
              <Icon className={cn("w-3.5 h-3.5", config.color, isActive && "animate-pulse")} />
            </div>
            <span className={cn("text-[10px] uppercase tracking-wider font-semibold", config.color)}>
              {config.label}
            </span>
            {latestStep && (
              <span className="text-xs text-muted-foreground truncate flex-1 text-left">
                {latestStep.message}
              </span>
            )}
            <div className="shrink-0">
              {isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
            {steps.length > 1 && (
              <span className="text-[9px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
                {steps.length}
              </span>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-1 glass rounded-xl p-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
            {steps.map((step, i) => {
              const stepConfig = phaseConfig[step.phase] || phaseConfig.reasoning;
              const StepIcon = stepConfig.icon;
              return (
                <div key={i} className="flex items-start gap-2 py-1 px-1">
                  <StepIcon className={cn("w-3 h-3 mt-0.5 shrink-0", stepConfig.color)} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-foreground/80">{step.message}</span>
                    {step.tool_name && (
                      <span className="ml-1 text-[9px] bg-primary/10 text-primary rounded px-1 py-0.5">
                        {step.tool_name}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {new Date(step.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
