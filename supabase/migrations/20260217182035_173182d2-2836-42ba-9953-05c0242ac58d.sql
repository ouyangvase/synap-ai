
-- ============================================================
-- 001_init_agenthub.sql — Schema + RBAC + RLS
-- ============================================================

-- 1. Role enum & user_roles table (per security guidelines)
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  -- Default role: staff
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Helper functions (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
$$;

-- 4. Agents table
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful AI assistant.',
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- 5. Tools table
CREATE TABLE public.tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  input_schema JSONB NOT NULL DEFAULT '{}',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

-- 6. Tool endpoints
CREATE TABLE public.tool_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  http_method TEXT NOT NULL DEFAULT 'POST',
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  max_retries INTEGER NOT NULL DEFAULT 2,
  headers JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tool_endpoints ENABLE ROW LEVEL SECURITY;

-- 7. Agent-tool mapping
CREATE TABLE public.agent_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, tool_id)
);
ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

-- 8. Conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 9. Messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_call_id TEXT,
  tool_calls JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 10. Tool runs
CREATE TABLE public.tool_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'running', 'completed', 'failed', 'timed_out')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tool_runs ENABLE ROW LEVEL SECURITY;

-- 11. Tool approvals
CREATE TABLE public.tool_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_run_id UUID NOT NULL REFERENCES public.tool_runs(id) ON DELETE CASCADE UNIQUE,
  approver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE public.tool_approvals ENABLE ROW LEVEL SECURITY;

-- Enable realtime for messages and tool_runs
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_approvals;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON public.tools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- user_roles: admins see all, users see own
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Only admins manage roles" ON public.user_roles FOR ALL USING (public.is_admin());

-- profiles
CREATE POLICY "Users view own profile or admin" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "System inserts profiles" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- agents, tools, tool_endpoints, agent_tools: staff+ can read, admin can write
CREATE POLICY "Staff can view agents" ON public.agents FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages agents" ON public.agents FOR ALL USING (public.is_admin());

CREATE POLICY "Staff can view tools" ON public.tools FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages tools" ON public.tools FOR ALL USING (public.is_admin());

CREATE POLICY "Staff can view endpoints" ON public.tool_endpoints FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages endpoints" ON public.tool_endpoints FOR ALL USING (public.is_admin());

CREATE POLICY "Staff can view agent_tools" ON public.agent_tools FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages agent_tools" ON public.agent_tools FOR ALL USING (public.is_admin());

-- conversations: own or admin
CREATE POLICY "Users view own conversations" ON public.conversations FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users create own conversations" ON public.conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own conversations" ON public.conversations FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admin deletes conversations" ON public.conversations FOR DELETE USING (public.is_admin());

-- messages: own conversation or admin
CREATE POLICY "Users view own messages" ON public.messages FOR SELECT USING (
  public.is_admin() OR auth.uid() = (SELECT user_id FROM public.conversations WHERE id = conversation_id)
);
CREATE POLICY "Users insert own messages" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = user_id AND auth.uid() = (SELECT user_id FROM public.conversations WHERE id = conversation_id)
);
CREATE POLICY "Admin manages messages" ON public.messages FOR ALL USING (public.is_admin());

-- tool_runs: own or admin
CREATE POLICY "Users view own tool_runs" ON public.tool_runs FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users create own tool_runs" ON public.tool_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own tool_runs" ON public.tool_runs FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admin deletes tool_runs" ON public.tool_runs FOR DELETE USING (public.is_admin());

-- tool_approvals: conversation owner or admin
CREATE POLICY "Users view own approvals" ON public.tool_approvals FOR SELECT USING (
  public.is_admin() OR auth.uid() = (SELECT user_id FROM public.tool_runs WHERE id = tool_run_id)
);
CREATE POLICY "Users create approvals" ON public.tool_approvals FOR INSERT WITH CHECK (
  auth.uid() = (SELECT user_id FROM public.tool_runs WHERE id = tool_run_id)
);
CREATE POLICY "Users update own approvals" ON public.tool_approvals FOR UPDATE USING (
  public.is_admin() OR auth.uid() = (SELECT user_id FROM public.tool_runs WHERE id = tool_run_id)
);

-- Custom access token hook for RBAC JWT claim
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims JSONB;
  user_role TEXT;
BEGIN
  claims := event->'claims';
  
  SELECT role::TEXT INTO user_role
  FROM public.user_roles
  WHERE user_id = (event->>'user_id')::UUID
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 END
  LIMIT 1;
  
  claims := jsonb_set(claims, '{user_role}', to_jsonb(COALESCE(user_role, 'staff')));
  event := jsonb_set(event, '{claims}', claims);
  
  RETURN event;
END;
$$;

-- Grant necessary permissions for the hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
GRANT ALL ON TABLE public.user_roles TO supabase_auth_admin;
