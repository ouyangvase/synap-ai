-- ============================================================
-- Task State Machine & Self-Healing Browser Agent
-- ============================================================

-- 1. execution_state table (polymorphic tracker for job_runs and browser_tasks)
CREATE TABLE IF NOT EXISTS public.execution_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Polymorphic link: exactly one should be set
  job_run_id UUID REFERENCES public.job_runs(id) ON DELETE CASCADE,
  browser_task_id UUID REFERENCES public.browser_tasks(id) ON DELETE CASCADE,

  -- State machine
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'queued', 'running', 'waiting_for_login',
    'waiting_for_approval', 'retrying', 'paused',
    'failed', 'success', 'cancelled'
  )),

  -- Step tracking
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  execution_phase TEXT, -- e.g., 'login', 'navigation', 'data_extraction', 'form_fill'

  -- Retry tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  last_error_class TEXT, -- error classification: element_not_found, login_required, etc.

  -- Resume support
  resume_token JSONB NOT NULL DEFAULT '{}',
  -- { step_index, last_url, last_completed_step, form_state, steps }

  -- Execution log (append-only array of step results)
  execution_log JSONB NOT NULL DEFAULT '[]',
  -- Each entry: { step, phase, action, status, result, error, error_class,
  --               healing_attempts, started_at, completed_at, duration_ms }

  -- Healing history
  healing_log JSONB NOT NULL DEFAULT '[]',
  -- Each entry: { step, original_error, error_class, strategy, new_selector,
  --               llm_analysis, success, timestamp }

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Constraints: exactly one parent
  CONSTRAINT execution_state_one_parent CHECK (
    (job_run_id IS NOT NULL AND browser_task_id IS NULL) OR
    (job_run_id IS NULL AND browser_task_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_execution_state_job_run
  ON public.execution_state(job_run_id) WHERE job_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_execution_state_browser_task
  ON public.execution_state(browser_task_id) WHERE browser_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_execution_state_status
  ON public.execution_state(status);

-- RLS
ALTER TABLE public.execution_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
CREATE POLICY "Staff can view execution_state" ON public.execution_state
  FOR SELECT USING (public.is_staff_or_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE POLICY "Admin manages execution_state" ON public.execution_state
  FOR ALL USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Updated_at trigger
DO $$ BEGIN
CREATE TRIGGER update_execution_state_updated_at
  BEFORE UPDATE ON public.execution_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.execution_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- 2. Expand job_runs status CHECK to support new states
ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_status_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_status_check
  CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'success', 'skipped',
    'waiting_for_login', 'waiting_for_approval', 'retrying', 'paused', 'cancelled'
  ));


-- 3. Add self-healing columns to browser_actions
ALTER TABLE public.browser_actions
  ADD COLUMN IF NOT EXISTS healing_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.browser_actions
  ADD COLUMN IF NOT EXISTS healing_log JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public.browser_actions
  ADD COLUMN IF NOT EXISTS error_class TEXT;
ALTER TABLE public.browser_actions
  ADD COLUMN IF NOT EXISTS original_parameters JSONB;


-- 4. Add execution_phase and error_class to browser_tasks
ALTER TABLE public.browser_tasks
  ADD COLUMN IF NOT EXISTS execution_phase TEXT;
ALTER TABLE public.browser_tasks
  ADD COLUMN IF NOT EXISTS error_class TEXT;


-- 5. Add steps column to jobs (for browser_flow task type)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]';
  -- steps: [{ action, parameters, phase, max_retries, timeout_ms }]


-- 6. Allow users to view/manage their own execution_state via browser_tasks
DO $$ BEGIN
CREATE POLICY "Users view own execution_state via browser_tasks" ON public.execution_state
  FOR SELECT USING (
    browser_task_id IN (
      SELECT id FROM public.browser_tasks WHERE user_id = auth.uid()
    )
    OR public.is_staff_or_admin()
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
