import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { BrowserViewer } from "@/components/browser/BrowserViewer";
import { TaskPanel } from "@/components/browser/TaskPanel";
import { ApprovalModal } from "@/components/browser/ApprovalModal";
import { SessionControls } from "@/components/browser/SessionControls";
import { ActionTimeline } from "@/components/browser/ActionTimeline";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface BrowserSession {
  id: string;
  status: string;
  vnc_url: string | null;
  browser_profile_path: string | null;
  created_at: string;
}

interface BrowserAction {
  id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  status: string;
  result: unknown;
  screenshot_url: string | null;
  error: string | null;
  created_at: string;
}

interface BrowserApproval {
  id: string;
  action_id: string;
  status: string;
  reason: string | null;
}

export default function BrowserAgentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [actions, setActions] = useState<BrowserAction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(BrowserApproval & { action: BrowserAction })[]>([]);
  const [loading, setLoading] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [takeOver, setTakeOver] = useState(false);
  const [hasExistingProfile, setHasExistingProfile] = useState(false);

  const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/browser-proxy`;

  const getAuthHeaders = useCallback(async () => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSession?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  }, []);

  // Check for existing browser profile
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("browser_profile_path")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.browser_profile_path) setHasExistingProfile(true);
      });
  }, [user]);


  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`browser-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "browser_actions", filter: `session_id=eq.${session.id}` }, (payload) => {
        const action = payload.new as BrowserAction;
        setActions((prev) => {
          const idx = prev.findIndex((a) => a.id === action.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = action;
            return updated;
          }
          return [...prev, action];
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "browser_approvals" }, (payload) => {
        // Refresh pending approvals
        loadPendingApprovals();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "browser_sessions", filter: `id=eq.${session.id}` }, (payload) => {
        setSession(payload.new as BrowserSession);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  const loadPendingApprovals = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from("browser_approvals")
      .select("*, action:browser_actions(*)")
      .eq("status", "pending");

    if (data) {
      setPendingApprovals(
        data
          .filter((a: any) => a.action?.session_id === session.id)
          .map((a: any) => ({ ...a, action: a.action }))
      );
    }
  }, [session?.id]);

  useEffect(() => {
    if (session) loadPendingApprovals();
  }, [session, loadPendingApprovals]);

  const startSession = async (loginSetup = false) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${proxyUrl}/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ login_setup: loginSetup }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setSession(data);
        if (loginSetup) setTakeOver(true);
        refreshScreenshot(data.id);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveSession = async () => {
    if (!session) return;
    const headers = await getAuthHeaders();
    await fetch(`${proxyUrl}/save-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: session.id }),
    });
    setSession((prev) => prev ? { ...prev, status: "running" } : prev);
    setHasExistingProfile(true);
  };

  const confirmLogin = async () => {
    if (!session) return;
    const headers = await getAuthHeaders();
    const resp = await fetch(`${proxyUrl}/confirm-login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: session.id }),
    });
    if (resp.ok) {
      setSession((prev) => prev ? { ...prev, status: "running" } : prev);
    }
  };

  const stopSession = async () => {
    if (!session) return;
    const headers = await getAuthHeaders();
    await fetch(`${proxyUrl}/stop`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: session.id }),
    });
    setSession(null);
    setActions([]);
    setScreenshotUrl(null);
    setTakeOver(false);
  };

  const refreshScreenshot = async (sessionId?: string) => {
    const id = sessionId || session?.id;
    if (!id) return;
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const url = `${proxyUrl}/screenshot?session_id=${id}`;
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authSession?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (resp.ok) {
        const blob = await resp.blob();
        setScreenshotUrl(URL.createObjectURL(blob));
      }
    } catch {
      // Playwright service may not be running
    }
  };

  const submitTask = async (description: string) => {
    if (!session) return;
    const headers = await getAuthHeaders();
    await fetch(`${proxyUrl}/task`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: session.id, description }),
    });
  };

  const handleApproval = async (actionId: string, approved: boolean, reason?: string) => {
    const headers = await getAuthHeaders();
    await fetch(`${proxyUrl}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action_id: actionId, approved, reason }),
    });
    loadPendingApprovals();
    setTimeout(() => refreshScreenshot(), 1000);
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Left: Controls + Timeline */}
      <div className="w-80 border-r border-border glass-subtle flex flex-col">
        <div className="p-4 border-b border-border glass-subtle flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">Browser Agent</h1>
        </div>

        <SessionControls
          session={session}
          loading={loading}
          takeOver={takeOver}
          hasExistingProfile={hasExistingProfile}
          onStart={startSession}
          onStop={stopSession}
          onTakeOver={() => setTakeOver(!takeOver)}
          onRefreshScreenshot={() => refreshScreenshot()}
          onSaveSession={saveSession}
          onConfirmLogin={confirmLogin}
        />

        <div className="flex-1 overflow-y-auto">
          <ActionTimeline actions={actions} />
        </div>
      </div>

      {/* Center: Browser View */}
      <div className="flex-1 flex flex-col">
        <BrowserViewer
          session={session}
          screenshotUrl={screenshotUrl}
          takeOver={takeOver}
        />
      </div>

      {/* Right: Task Panel */}
      <div className="w-96 border-l border-border glass-subtle flex flex-col">
        <TaskPanel
          session={session}
          onSubmitTask={submitTask}
        />
      </div>

      {/* Approval Modal */}
      {pendingApprovals.length > 0 && (
        <ApprovalModal
          approval={pendingApprovals[0]}
          onApprove={(id) => handleApproval(id, true)}
          onReject={(id, reason) => handleApproval(id, false, reason)}
        />
      )}
    </div>
  );
}
