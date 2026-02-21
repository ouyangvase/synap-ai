import { useEffect, useRef } from "react";
import { Monitor, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BrowserViewerProps {
  session: { id: string; status: string; vnc_url: string | null } | null;
  screenshotUrl: string | null;
  takeOver: boolean;
}

export function BrowserViewer({ session, screenshotUrl, takeOver }: BrowserViewerProps) {
  const prevTakeOverRef = useRef(false);

  // Auto-open: when takeOver is first toggled ON and vnc_url exists, open the tab automatically
  useEffect(() => {
    if (takeOver && !prevTakeOverRef.current && session?.vnc_url) {
      window.open(session.vnc_url, "_blank");
    }
    prevTakeOverRef.current = takeOver;
  }, [takeOver, session?.vnc_url]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3 glass elevation-1 rounded-2xl p-8">
          <Monitor className="w-16 h-16 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground text-sm">
            Start a browser session to begin
          </p>
        </div>
      </div>
    );
  }

  // When takeOver is active and we have a live URL, show a panel instead of an iframe.
  // Browserless's /live page sets X-Frame-Options headers that block iframe embedding,
  // so we direct the user to open the live browser in a new tab.
  if (takeOver && session.vnc_url) {
    return (
      <div className="flex-1 relative flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
          <span className="text-destructive text-xs font-mono font-medium animate-pulse">
            LIVE — You have control
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs text-muted-foreground"
            onClick={() => window.open(session.vnc_url!, "_blank")}
          >
            <ExternalLink className="w-3 h-3" />
            Open in new tab
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center bg-muted/20">
          <div className="text-center space-y-6 max-w-md px-6 glass elevation-2 rounded-2xl p-8">
            <div className="relative mx-auto w-20 h-20">
              <Globe className="w-20 h-20 text-destructive/60" />
              <span className="absolute top-0 right-0 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 bg-destructive" />
              </span>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                Live Browser Active
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The live browser opens in a new tab. Navigate and log in there.
              </p>
            </div>
            <Button
              size="lg"
              className="gap-2"
              onClick={() => window.open(session.vnc_url!, "_blank")}
            >
              <Globe className="w-4 h-4" />
              Open Live Browser
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // When takeOver is active but no vnc_url is available
  if (takeOver && !session.vnc_url) {
    return (
      <div className="flex-1 relative bg-muted/20 flex items-center justify-center overflow-hidden">
        <div className="absolute top-2 left-2 z-10 bg-accent text-accent-foreground text-xs px-2 py-1 rounded font-mono">
          Take Over active — No live URL available
        </div>
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="Browser screenshot"
            className="max-w-full max-h-full object-contain rounded-xl elevation-1"
          />
        ) : (
          <div className="text-center space-y-2">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground text-xs">
              Waiting for screenshot...
            </p>
          </div>
        )}
      </div>
    );
  }

  // Default: takeOver is false — show screenshot or placeholder
  return (
    <div className="flex-1 relative bg-muted/20 flex items-center justify-center overflow-hidden">
      {screenshotUrl ? (
        <img
          src={screenshotUrl}
          alt="Browser screenshot"
          className="max-w-full max-h-full object-contain rounded-xl elevation-1"
        />
      ) : (
        <div className="text-center space-y-2">
          <Monitor className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground text-xs">
            Waiting for screenshot...
          </p>
          {session.vnc_url && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => window.open(session.vnc_url!, "_blank")}
            >
              <ExternalLink className="w-3 h-3" />
              Open live browser
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
