
-- Add profile persistence columns to browser_sessions
ALTER TABLE public.browser_sessions
  ADD COLUMN IF NOT EXISTS browser_profile_path text,
  ADD COLUMN IF NOT EXISTS last_worker_endpoint text;

-- Add a profiles table for storing user browser profile paths
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS browser_profile_path text;
