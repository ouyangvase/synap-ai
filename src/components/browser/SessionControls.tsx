import { Button } from "@/components/ui/button";
import { Play, Square, Monitor, RefreshCw } from "lucide-react";

interface SessionControlsProps {
  session: { id: string; status: string } | null;
  loading: boolean;
  takeOver: boolean;
  onStart: () => void;
  onStop: () => void;
  onTakeOver: () => void;
  onRefreshScreenshot: () => void;
}

export function SessionControls({
  session,
  loading,
  takeOver,
  onStart,
  onStop,
  onTakeOver,
  onRefreshScreenshot,
}: SessionControlsProps) {
  return (
    <div className="p-4 space-y-3 border-b border-border">
      {!session ? (
        <Button
          onClick={onStart}
          disabled={loading}
          className="w-full gap-2"
          variant="default"
        >
          <Play className="w-4 h-4" />
          {loading ? "Starting…" : "Start Browser Session"}
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${session.status === "running" ? "bg-green-500" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground font-mono">{session.id.slice(0, 8)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="capitalize">{session.status}</span>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onTakeOver}
              variant={takeOver ? "destructive" : "secondary"}
              size="sm"
              className="flex-1 gap-1"
            >
              <Monitor className="w-3 h-3" />
              {takeOver ? "Release" : "Take Over"}
            </Button>
            <Button onClick={onRefreshScreenshot} variant="outline" size="sm">
              <RefreshCw className="w-3 h-3" />
            </Button>
            <Button onClick={onStop} variant="outline" size="sm">
              <Square className="w-3 h-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
