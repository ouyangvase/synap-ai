-- ============================================================
-- 004_jobs_and_n8n.sql — Jobs scheduler + n8n config tables
-- ============================================================

-- 1. Jobs table (scheduled/recurring tasks)
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  schedule TEXT NOT NULL DEFAULT '0 22 * * *', -- cron expression (default: 6 AM UTC+8 = 22:00 UTC)
  workflow_name TEXT NOT NULL, -- n8n workflow to trigger
  workflow_payload JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view jobs" ON public.jobs FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages jobs" ON public.jobs FOR ALL USING (public.is_admin());

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Job runs table (execution history with idempotency)
CREATE TABLE public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  run_date DATE NOT NULL, -- for idempotency: one run per job per day
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, run_date) -- idempotency constraint
);
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view job_runs" ON public.job_runs FOR SELECT USING (public.is_staff_or_admin());
CREATE POLICY "Admin manages job_runs" ON public.job_runs FOR ALL USING (public.is_admin());

-- Enable realtime for job monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_runs;

-- 3. Seed: default agent + tools + endpoints for n8n
-- Default agent
INSERT INTO public.agents (id, name, description, system_prompt, model) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'AgentHub Assistant',
  'Default AI assistant with tool access',
  'You are AgentHub Assistant, an AI that helps users with tasks. You have access to tools that can search for links, check daily tasks, and summarize reports. Use the appropriate tool when the user asks for something that matches a tool''s capability. Always explain what you''re doing.',
  'google/gemini-3-flash-preview'
) ON CONFLICT DO NOTHING;

-- Tool: links-demo (now proxied to n8n)
INSERT INTO public.tools (id, name, description, input_schema, requires_approval) VALUES (
  '00000000-0000-0000-0000-000000000010',
  'links-demo',
  'Search and return useful links based on a query topic. Returns formatted results with URLs.',
  '{"type":"object","properties":{"query":{"type":"string","description":"The search query or topic to find links for"},"num_results":{"type":"number","description":"Number of results to return (default 5)"},"recency_days":{"type":"number","description":"Only return results from the last N days (optional)"}},"required":["query"]}',
  false
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  input_schema = EXCLUDED.input_schema;

-- Tool: tomu_daily_check
INSERT INTO public.tools (id, name, description, input_schema, requires_approval) VALUES (
  '00000000-0000-0000-0000-000000000011',
  'tomu_daily_check',
  'Check daily tasks and status for tomu.my operations. Returns pending tasks, deadlines, and action items.',
  '{"type":"object","properties":{"date":{"type":"string","description":"Date to check in YYYY-MM-DD format (defaults to today)"}},"required":[]}',
  false
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  input_schema = EXCLUDED.input_schema;

-- Tool: report_summarizer
INSERT INTO public.tools (id, name, description, input_schema, requires_approval) VALUES (
  '00000000-0000-0000-0000-000000000012',
  'report_summarizer',
  'Summarize a block of text into a concise report with key points, action items, and metrics.',
  '{"type":"object","properties":{"text":{"type":"string","description":"The text content to summarize"},"format":{"type":"string","description":"Output format: bullet_points, paragraph, or json (default: bullet_points)"}},"required":["text"]}',
  false
) ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  input_schema = EXCLUDED.input_schema;

-- Tool endpoints (pointing to n8n webhooks via env-based URL)
-- These use a placeholder base; the edge function resolves N8N_WEBHOOK_BASE_URL at runtime
INSERT INTO public.tool_endpoints (tool_id, endpoint_url, http_method, timeout_ms, max_retries) VALUES
  ('00000000-0000-0000-0000-000000000010', '{N8N_WEBHOOK_BASE_URL}/webhook/links-demo', 'POST', 30000, 2),
  ('00000000-0000-0000-0000-000000000011', '{N8N_WEBHOOK_BASE_URL}/webhook/tomu-daily-check', 'POST', 30000, 2),
  ('00000000-0000-0000-0000-000000000012', '{N8N_WEBHOOK_BASE_URL}/webhook/report-summarizer', 'POST', 30000, 2)
ON CONFLICT DO NOTHING;

-- Map tools to default agent
INSERT INTO public.agent_tools (agent_id, tool_id) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012')
ON CONFLICT DO NOTHING;

-- 4. Seed: default job for daily check
INSERT INTO public.jobs (name, description, schedule, workflow_name) VALUES (
  'tomu_daily_check',
  'Run daily tomu.my operations check at 6:00 AM MYT (UTC+8)',
  '0 22 * * *',
  'tomu-daily-check'
) ON CONFLICT (name) DO NOTHING;

-- 5. Cron extension for scheduled jobs (requires pg_cron)
-- NOTE: pg_cron must be enabled in Supabase dashboard under Database > Extensions
-- The cron job calls the daily-cron edge function
-- Run this manually in SQL editor after enabling pg_cron:
--
-- SELECT cron.schedule(
--   'daily-agenthub-cron',
--   '0 22 * * *',
--   $$SELECT net.http_post(
--     url := 'https://<PROJECT_ID>.supabase.co/functions/v1/daily-cron',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   )$$
-- );
