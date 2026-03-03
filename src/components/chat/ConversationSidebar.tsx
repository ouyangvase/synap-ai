import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, MessageSquare, LogOut, X, Monitor, Calendar, Trash2, Sparkles, Search, Pencil, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const fetchConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("tool_runs").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);
    if (activeId === id) {
      navigate("/");
    }
    fetchConversations();
  };

  const handleStartRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditTitle(c.title);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const handleSaveRename = async (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversations.find(c => c.id === id)?.title) {
      await supabase.from("conversations").update({ title: trimmed }).eq("id", id);
      fetchConversations();
    }
    setEditingId(null);
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
        "flex flex-col h-full glass-strong border-r border-border/50 transition-all duration-300",
        open ? "w-72" : "w-0 overflow-hidden",
        "md:relative fixed z-40 inset-y-0 left-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30 safe-top">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg overflow-hidden elevation-glow animate-glow-pulse">
            <img src="/logo.png" alt="HahaRun" className="w-full h-full object-cover" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-gradient">HahaRun</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={onClose} className="md:hidden h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div className="p-3 space-y-1">
        <Button onClick={onNew} variant="outline" className="w-full justify-start gap-2 text-sm border-dashed rounded-xl h-9 glass hover:translate-y-[-1px] hover:elevation-2 transition-all">
          <Plus className="w-4 h-4" />
          New conversation
        </Button>
        {[
          { icon: Monitor, label: "Browser Agent", path: "/browser" },
          { icon: Sparkles, label: "Image Generator", path: "/images" },
          { icon: Calendar, label: "Jobs & Automation", path: "/jobs" },
          { icon: Search, label: "Verified Search", path: "/search" },
        ].map((item) => (
          <Button
            key={item.path}
            onClick={() => navigate(item.path)}
            variant="ghost"
            className="w-full justify-start gap-2 text-sm rounded-xl h-9 hover:translate-y-[-1px] hover:elevation-1 transition-all"
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 space-y-0.5">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all group relative",
              activeId === c.id
                ? "glass-card border-l-2 border-l-primary text-foreground"
                : "text-muted-foreground hover:glass hover:translate-y-[-1px]"
            )}
          >
            {editingId === c.id ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Input
                  ref={editInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => handleSaveRename(c.id)}
                  className="h-7 text-sm rounded-lg px-2 py-0"
                />
                <button onClick={() => handleSaveRename(c.id)} className="p-1 rounded-lg hover:bg-primary/20 text-primary shrink-0">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate pr-12">{c.title}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 ml-5.5">
                  {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                </p>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                  <span role="button" onClick={(e) => handleStartRename(e, c)} className="p-1 rounded-lg hover:bg-accent">
                    <Pencil className="w-3 h-3" />
                  </span>
                  <span role="button" onClick={(e) => handleDelete(e, c.id)} className="p-1 rounded-lg hover:bg-destructive/20 hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                </div>
              </>
            )}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border/30 safe-bottom glass-subtle">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate max-w-[180px]">
            {user?.email}
          </span>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-7 w-7 rounded-lg">
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
