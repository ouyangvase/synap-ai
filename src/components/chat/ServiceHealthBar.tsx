import { useState, useEffect, useCallback } from "react";
import { Activity, WifiOff, Brain, Wrench, Globe } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface ServiceStatus {
  name: string;
  status: "online" | "degraded" | "offline" | "checking";
  label: string;
}

export function ServiceHealthBar() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: "ai", status: "checking", label: "AI" },
    { name: "browser", status: "checking", label: "Browser" },
    { name: "tools", status: "checking", label: "Tools" },
  ]);

  const checkHealth = useCallback(async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      apikey,
    };

    const results: ServiceStatus[] = [];
    results.push({ name: "ai", status: "online", label: "AI" });

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/browser-proxy/health`, {
        method: "GET",
        headers: baseHeaders,
        signal: AbortSignal.timeout(5000),
      });

      results.push({
        name: "browser",
        status: resp.ok ? "online" : resp.status === 503 ? "offline" : "degraded",
        label: "Browser",
      });
    } catch {
      results.push({ name: "browser", status: "offline", label: "Browser" });
    }

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/echo`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ input: { ping: true } }),
        signal: AbortSignal.timeout(5000),
      });

      results.push({
        name: "tools",
        status: resp.ok ? "online" : "degraded",
        label: "Tools",
      });
    } catch {
      results.push({ name: "tools", status: "offline", label: "Tools" });
    }

    setServices(results);
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const statusColor = (status: ServiceStatus["status"]) => {
    switch (status) {
      case "online":
        return "bg-success";
      case "degraded":
        return "bg-warning";
      case "offline":
        return "bg-destructive";
      default:
        return "bg-muted-foreground animate-pulse";
    }
  };

  const allOnline = services.every((s) => s.status === "online");
  const anyOffline = services.some((s) => s.status === "offline");

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 cursor-default">
              {anyOffline ? <WifiOff className="w-3 h-3 text-destructive" /> : <Activity className="w-3 h-3 text-muted-foreground" />}
              <div className="flex items-center gap-1">
                {services.map((s) => (
                  <div key={s.name} className={`w-1.5 h-1.5 rounded-full ${statusColor(s.status)}`} />
                ))}
              </div>
              <span className={`text-[10px] ${anyOffline ? "text-destructive" : "text-muted-foreground"}`}>
                {allOnline ? "All systems go" : anyOffline ? "Service issue" : "Checking…"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="space-y-1">
              {services.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  {s.name === "ai" ? <Brain className="w-3 h-3 text-muted-foreground" /> : s.name === "browser" ? <Globe className="w-3 h-3 text-muted-foreground" /> : <Wrench className="w-3 h-3 text-muted-foreground" />}
                  <div className={`w-2 h-2 rounded-full ${statusColor(s.status)}`} />
                  <span>{s.label}</span>
                  <span className="text-muted-foreground capitalize">{s.status}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
