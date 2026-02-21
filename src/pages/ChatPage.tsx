import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { ChatPane } from "@/components/chat/ChatPane";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (conversationId) setActiveConversationId(conversationId);
  }, [conversationId]);

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    navigate(`/c/${id}`);
  };

  const handleNewConversation = async () => {
    if (!user) return;
    // Get default agent
    const { data: agents } = await supabase.from("agents").select("id").eq("is_active", true).limit(1);
    const agentId = agents?.[0]?.id ?? null;

    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, agent_id: agentId, title: "New conversation" })
      .select()
      .single();
    
    if (data && !error) {
      handleSelectConversation(data.id);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile toggle */}
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          className="fixed top-3 left-3 z-50 md:hidden glass rounded-xl h-10 w-10"
        >
          <Menu className="w-5 h-5" />
        </Button>
      )}
      
      <ConversationSidebar
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      
      <ChatPane
        conversationId={activeConversationId}
        onNewChat={handleNewConversation}
      />
    </div>
  );
}
