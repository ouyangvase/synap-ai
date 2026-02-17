import { Monitor, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BrowserViewerProps {
  session: { id: string; status: string; vnc_url: string | null } | null;
  screenshotUrl: string | null;
  takeOver: boolean;
}

export function BrowserViewer({ session, screenshotUrl, takeOver }: BrowserViewerProps) {
  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-3">
          <Monitor className="w-16 h-16 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground text-sm">
            Start a browser session to begin
          </p>
        </div>
      </div>
    );
  }

  // If takeOver mode and live URL is available, show iframe + open-in-new-tab option
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
        <iframe
          src={session.vnc_url}
          className="flex-1 w-full border-0"
          title="Remote Browser"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  // Otherwise show latest screenshot
  return (
    <div className="flex-1 relative bg-muted/20 flex items-center justify-center overflow-hidden">
      {takeOver && !session.vnc_url && (
        <div className="absolute top-2 left-2 z-10 bg-accent text-accent-foreground text-xs px-2 py-1 rounded font-mono">
          Take Over active — No live URL available
        </div>
      )}
      {screenshotUrl ? (
        <img
          src={screenshotUrl}
          alt="Browser screenshot"
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <div className="text-center space-y-2">
          <Monitor className="w-12 h-12 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground text-xs">
            Waiting for screenshot…
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
