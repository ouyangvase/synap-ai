-- ============================================================
-- DAG Workflow System
-- Replaces linear steps[] with node+edge graph workflows
-- ============================================================

-- 1. Add workflow column to jobs (nodes + edges graph)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS workflow JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}';
-- workflow: {
--   nodes: [{ id, type, label, position: {x,y}, data: {action, parameters, phase, max_retries, timeout_ms, condition, delay_seconds, webhook_url, webhook_method, transform_expression} }],
--   edges: [{ id, source, target, sourceHandle?, label?, condition? }]
-- }

-- 2. Add DAG tracking columns to execution_state
ALTER TABLE public.execution_state
  ADD COLUMN IF NOT EXISTS current_node_id TEXT;

ALTER TABLE public.execution_state
  ADD COLUMN IF NOT EXISTS completed_nodes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.execution_state
  ADD COLUMN IF NOT EXISTS failed_nodes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.execution_state
  ADD COLUMN IF NOT EXISTS node_results JSONB NOT NULL DEFAULT '{}';

-- 3. Expand execution_state status CHECK to include waiting_for_delay
ALTER TABLE public.execution_state DROP CONSTRAINT IF EXISTS execution_state_status_check;
DO $$ BEGIN
  ALTER TABLE public.execution_state DROP CONSTRAINT IF EXISTS execution_state_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Re-check: the original constraint was inline in CREATE TABLE, named differently
-- We need to find and drop the actual constraint name
DO $$ BEGIN
  EXECUTE (
    SELECT 'ALTER TABLE public.execution_state DROP CONSTRAINT ' || conname
    FROM pg_constraint
    WHERE conrelid = 'public.execution_state'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
    LIMIT 1
  );
EXCEPTION WHEN undefined_object THEN NULL;
          WHEN no_data_found THEN NULL;
END $$;

ALTER TABLE public.execution_state ADD CONSTRAINT execution_state_status_check CHECK (status IN (
  'created', 'queued', 'running', 'waiting_for_login',
  'waiting_for_approval', 'waiting_for_delay', 'retrying', 'paused',
  'failed', 'success', 'cancelled'
));

-- 4. Expand job_runs status CHECK to include waiting_for_delay
ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_status_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_status_check CHECK (status IN (
  'pending', 'running', 'completed', 'failed', 'success', 'skipped',
  'waiting_for_login', 'waiting_for_approval', 'waiting_for_delay',
  'retrying', 'paused', 'cancelled'
));
