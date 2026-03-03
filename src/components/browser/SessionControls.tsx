import { Button } from "@/components/ui/button";
import { Play, Square, Monitor, RefreshCw, LogIn, Save, CheckCircle } from "lucide-react";
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
  onConfirmLogin: () => void;
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
  onConfirmLogin,
}: SessionControlsProps) {
  const isLoginSetup = session?.status === "login_setup";

  return (
    <div className="p-4 space-y-3 border-b border-border/30 glass-subtle">
      {!session ? (
        <div className="space-y-2">
          <Button
            onClick={() => onStart(false)}
            disabled={loading}
            className="w-full gap-2 rounded-xl elevation-glow active:translate-y-[1px] transition-all"
            variant="default"
          >
            <Play className="w-4 h-4" />
            {loading ? "Starting…" : "Start Browser Session"}
          </Button>
          <Button
            onClick={() => onStart(true)}
            disabled={loading}
            className="w-full gap-2 rounded-xl glass hover:elevation-2 active:translate-y-[1px] transition-all"
            variant="secondary"
          >
            <LogIn className="w-4 h-4" />
            {loading ? "Starting…" : "Login Setup Mode"}
          </Button>
          {hasExistingProfile && (
            <p className="text-xs text-muted-foreground text-center">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-success glow-dot-success mr-1 align-middle" />
              Saved session data found — logins may persist
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${session.status === "running" ? "bg-success glow-dot-success" : session.status === "login_setup" ? "bg-warning glow-dot-warning" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground font-mono">{session.id.slice(0, 8)}</span>
            <span className="text-muted-foreground">·</span>
            {isLoginSetup ? (
              <Badge variant="outline" className="text-warning border-warning/50 text-[10px]">Login Setup</Badge>
            ) : (
              <span className="capitalize">{session.status}</span>
            )}
          </div>

          {isLoginSetup && (
            <div className="glass-card rounded-xl p-3 text-xs space-y-2 border-warning/30">
              <p className="font-medium text-warning">Login Setup Mode</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Click <strong>Take Over</strong> to open the live browser</li>
                <li>Log in to your target sites manually</li>
                <li>Click <strong>I'm Logged In</strong> when done</li>
                <li>Optionally click <strong>Save Session</strong> to persist cookies</li>
              </ol>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={onTakeOver}
              variant={takeOver ? "destructive" : "secondary"}
              size="sm"
              className="flex-1 gap-1 rounded-xl glass hover:elevation-2 active:translate-y-[1px] transition-all"
            >
              <Monitor className="w-3 h-3" />
              {takeOver ? "Release" : "Take Over"}
            </Button>
            <Button onClick={onRefreshScreenshot} variant="outline" size="sm" className="rounded-xl glass">
              <RefreshCw className="w-3 h-3" />
            </Button>
            <Button onClick={onStop} variant="outline" size="sm" className="rounded-xl glass">
              <Square className="w-3 h-3" />
            </Button>
          </div>

          {isLoginSetup && (
            <div className="space-y-2">
              <Button
                onClick={onConfirmLogin}
                className="w-full gap-2 rounded-xl elevation-glow active:translate-y-[1px] transition-all"
                variant="default"
              >
                <CheckCircle className="w-4 h-4" />
                I'm Logged In
              </Button>
              <Button
                onClick={onSaveSession}
                className="w-full gap-2 rounded-xl glass hover:elevation-2 active:translate-y-[1px] transition-all"
                variant="secondary"
              >
                <Save className="w-4 h-4" />
                Save Session (optional)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
