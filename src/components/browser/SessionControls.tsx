import { Button } from "@/components/ui/button";
import { Play, Square, Monitor, RefreshCw, LogIn, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SessionControlsProps {
  session: { id: string; status: string } | null;
  loading: boolean;
  takeOver: boolean;
  hasExistingProfile: boolean;
  onStart: (loginSetup?: boolean) => void;
  onStop: () => void;
  onTakeOver: () => void;
  onRefreshScreenshot: () => void;
  onSaveSession: () => void;
}

export function SessionControls({
  session,
  loading,
  takeOver,
  hasExistingProfile,
  onStart,
  onStop,
  onTakeOver,
  onRefreshScreenshot,
  onSaveSession,
}: SessionControlsProps) {
  const isLoginSetup = session?.status === "login_setup";

  return (
    <div className="p-4 space-y-3 border-b border-border">
      {!session ? (
        <div className="space-y-2">
          <Button
            onClick={() => onStart(false)}
            disabled={loading}
            className="w-full gap-2"
            variant="default"
          >
            <Play className="w-4 h-4" />
            {loading ? "Starting…" : "Start Browser Session"}
          </Button>
          <Button
            onClick={() => onStart(true)}
            disabled={loading}
            className="w-full gap-2"
            variant="secondary"
          >
            <LogIn className="w-4 h-4" />
            {loading ? "Starting…" : "Login Setup Mode"}
          </Button>
          {hasExistingProfile && (
            <p className="text-xs text-muted-foreground text-center">
              ✓ Saved session profile found — logins will persist
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${session.status === "running" ? "bg-green-500" : session.status === "login_setup" ? "bg-amber-500" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground font-mono">{session.id.slice(0, 8)}</span>
            <span className="text-muted-foreground">·</span>
            {isLoginSetup ? (
              <Badge variant="outline" className="text-amber-600 border-amber-600/50 text-[10px]">Login Setup</Badge>
            ) : (
              <span className="capitalize">{session.status}</span>
            )}
          </div>

          {isLoginSetup && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs space-y-2">
              <p className="font-medium text-amber-700">Login Setup Mode</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Click <strong>Take Over</strong> to control the browser</li>
                <li>Log in to your target sites manually</li>
                <li>Click <strong>Save Session</strong> to persist your login</li>
              </ol>
            </div>
          )}

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

          {isLoginSetup && (
            <Button
              onClick={onSaveSession}
              className="w-full gap-2"
              variant="default"
            >
              <Save className="w-4 h-4" />
              Save Session
            </Button>
          )}
        </>
      )}
    </div>
  );
}
