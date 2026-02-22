-- Browser run tracking tables for proof-gated completion, checkpoints, and resume
-- These tables store detailed browser automation run state for UI display

-- Main browser run record (one per browser_do invocation)
CREATE TABLE IF NOT EXISTS public.browser_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  tool_run_id UUID REFERENCES public.tool_runs(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'running',
  total_steps INT,
  completed_steps INT DEFAULT 0,
  failed_step_index INT,
  final_screenshot_url TEXT,
  last_url TEXT,
  error_message TEXT,
  checkpoints JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Per-step tracking (each step in the browser_do steps array)
CREATE TABLE IF NOT EXISTS public.browser_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_run_id UUID REFERENCES public.browser_runs(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  action TEXT NOT NULL,
  status TEXT,
  selector TEXT,
  url TEXT,
  value TEXT,
  error TEXT,
  screenshot_url TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Checkpoints for resume capability
CREATE TABLE IF NOT EXISTS public.browser_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_run_id UUID REFERENCES public.browser_runs(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  checkpoint_name TEXT,
  url TEXT,
  screenshot_url TEXT,
  page_state JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.browser_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_checkpoints ENABLE ROW LEVEL SECURITY;

-- Service role policies (edge functions use service role)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access browser_runs') THEN
    CREATE POLICY "Service role full access browser_runs" ON public.browser_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access browser_run_steps') THEN
    CREATE POLICY "Service role full access browser_run_steps" ON public.browser_run_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access browser_checkpoints') THEN
    CREATE POLICY "Service role full access browser_checkpoints" ON public.browser_checkpoints FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Storage bucket for browser screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('browser-screenshots', 'browser-screenshots', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
