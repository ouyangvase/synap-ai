import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, LogOut, X, Bot, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  open: boolean;
  onClose: () => void;
}

export function ConversationSidebar({ activeId, onSelect, onNew, open, onClose }: Props) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const fetchConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  useEffect(() => {
    fetchConversations();

    const channel = supabase
      .channel("conversations-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200",
        open ? "w-72" : "w-0 overflow-hidden",
        "md:relative fixed z-40 inset-y-0 left-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">AgentHub</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="md:hidden h-7 w-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* New chat */}
      <div className="p-3">
        <Button onClick={onNew} variant="outline" className="w-full justify-start gap-2 text-sm border-dashed">
          <Plus className="w-4 h-4" />
          New conversation
        </Button>
        <Button onClick={() => navigate("/browser")} variant="outline" className="w-full justify-start gap-2 text-sm">
          <Monitor className="w-4 h-4" />
          Browser Agent
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-0.5">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors group",
              activeId === c.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{c.title}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 ml-5.5">
              {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
            </p>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate max-w-[180px]">
            {user?.email}
          </span>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-7 w-7">
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
