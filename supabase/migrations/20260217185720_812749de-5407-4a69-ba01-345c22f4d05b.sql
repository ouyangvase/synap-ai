
-- Browser agent sessions
CREATE TABLE public.browser_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting', -- starting, running, paused, stopped, error
  vnc_url TEXT,
  playwright_url TEXT, -- internal URL to the Playwright service
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ
);

ALTER TABLE public.browser_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own sessions" ON public.browser_sessions FOR SELECT USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Users create own sessions" ON public.browser_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sessions" ON public.browser_sessions FOR UPDATE USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Admin deletes sessions" ON public.browser_sessions FOR DELETE USING (is_admin());

CREATE TRIGGER update_browser_sessions_updated_at BEFORE UPDATE ON public.browser_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Browser tasks (high-level user requests)
CREATE TABLE public.browser_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.browser_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, cancelled
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.browser_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tasks" ON public.browser_tasks FOR SELECT USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Users create own tasks" ON public.browser_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own tasks" ON public.browser_tasks FOR UPDATE USING (auth.uid() = user_id OR is_admin());

CREATE TRIGGER update_browser_tasks_updated_at BEFORE UPDATE ON public.browser_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Browser actions (individual agent steps)
CREATE TABLE public.browser_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.browser_tasks(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.browser_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL, -- click, type, navigate, screenshot, scroll, wait
  parameters JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, awaiting_approval, approved, executing, completed, failed, rejected
  result JSONB,
  screenshot_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.browser_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own actions" ON public.browser_actions FOR SELECT USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Users create own actions" ON public.browser_actions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own actions" ON public.browser_actions FOR UPDATE USING (auth.uid() = user_id OR is_admin());

-- Browser approvals
CREATE TABLE public.browser_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action_id UUID NOT NULL REFERENCES public.browser_actions(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.browser_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own approvals" ON public.browser_approvals FOR SELECT USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Users create own approvals" ON public.browser_approvals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own approvals" ON public.browser_approvals FOR UPDATE USING (auth.uid() = user_id OR is_admin());

-- Browser artifacts (downloaded files, screenshots)
CREATE TABLE public.browser_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.browser_sessions(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.browser_tasks(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  artifact_type TEXT NOT NULL, -- screenshot, download, html_snapshot
  file_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.browser_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own artifacts" ON public.browser_artifacts FOR SELECT USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "Users create own artifacts" ON public.browser_artifacts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_approvals;
