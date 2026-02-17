import { Monitor } from "lucide-react";

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

  // If takeOver mode and VNC URL is available, embed noVNC iframe
  if (takeOver && session.vnc_url) {
    return (
      <div className="flex-1 relative">
        <div className="absolute top-2 left-2 z-10 bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded font-mono animate-pulse">
          LIVE — You have control
        </div>
        <iframe
          src={session.vnc_url}
          className="w-full h-full border-0"
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
          Take Over active — No VNC URL available. Configure your Playwright service to provide a VNC endpoint.
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
          <p className="text-muted-foreground/60 text-xs max-w-xs">
            Ensure your Playwright service is running and accessible at the configured BROWSER_SERVICE_URL.
          </p>
        </div>
      )}
    </div>
  );
}
