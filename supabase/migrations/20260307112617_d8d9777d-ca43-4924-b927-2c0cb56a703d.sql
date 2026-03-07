
-- Connected Meta Business accounts
CREATE TABLE public.connected_meta_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_user_id text NOT NULL,
  meta_user_name text,
  access_token_encrypted text NOT NULL,
  token_expires_at timestamptz,
  scopes text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.connected_meta_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meta accounts" ON public.connected_meta_accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Connected Ad Accounts
CREATE TABLE public.connected_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_account_id uuid NOT NULL REFERENCES public.connected_meta_accounts(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  ad_account_name text,
  currency text DEFAULT 'USD',
  timezone text DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.connected_ad_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ad accounts" ON public.connected_ad_accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Campaign sync logs
CREATE TABLE public.meta_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.connected_ad_accounts(id) ON DELETE CASCADE,
  meta_campaign_id text NOT NULL,
  name text NOT NULL,
  objective text,
  buying_type text DEFAULT 'AUCTION',
  special_ad_categories text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'PAUSED',
  effective_status text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  stop_time timestamptz,
  meta_created_time timestamptz,
  meta_updated_time timestamptz,
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own campaigns" ON public.meta_campaigns FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Ad Sets
CREATE TABLE public.meta_adsets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.meta_campaigns(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.connected_ad_accounts(id) ON DELETE CASCADE,
  meta_adset_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'PAUSED',
  effective_status text,
  optimization_goal text,
  bid_strategy text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  end_time timestamptz,
  targeting jsonb DEFAULT '{}',
  placements jsonb DEFAULT '{}',
  attribution_setting jsonb DEFAULT '{}',
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_adsets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own adsets" ON public.meta_adsets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Ads
CREATE TABLE public.meta_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adset_id uuid NOT NULL REFERENCES public.meta_adsets(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES public.connected_ad_accounts(id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'PAUSED',
  effective_status text,
  creative_format text,
  primary_text text,
  headline text,
  description text,
  cta_type text,
  destination_url text,
  media_url text,
  tracking_specs jsonb DEFAULT '{}',
  utm_parameters jsonb DEFAULT '{}',
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ads" ON public.meta_ads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Daily insights
CREATE TABLE public.ad_insights_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid NOT NULL REFERENCES public.connected_ad_accounts(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  adset_id uuid REFERENCES public.meta_adsets(id) ON DELETE SET NULL,
  ad_id uuid REFERENCES public.meta_ads(id) ON DELETE SET NULL,
  date_start date NOT NULL,
  date_stop date NOT NULL,
  impressions bigint DEFAULT 0,
  reach bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  ctr numeric DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  spend numeric DEFAULT 0,
  conversions bigint DEFAULT 0,
  leads bigint DEFAULT 0,
  roas numeric DEFAULT 0,
  frequency numeric DEFAULT 0,
  raw_data jsonb DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.ad_insights_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own insights" ON public.ad_insights_daily FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Automation rules
CREATE TABLE public.meta_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid REFERENCES public.connected_ad_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  metric text NOT NULL,
  operator text NOT NULL,
  threshold numeric NOT NULL,
  action_type text NOT NULL DEFAULT 'alert',
  action_config jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own automation rules" ON public.meta_automation_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Automation alerts
CREATE TABLE public.meta_automation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.meta_automation_rules(id) ON DELETE CASCADE,
  ad_account_id uuid REFERENCES public.connected_ad_accounts(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.meta_campaigns(id) ON DELETE SET NULL,
  adset_id uuid REFERENCES public.meta_adsets(id) ON DELETE SET NULL,
  ad_id uuid REFERENCES public.meta_ads(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metric_value numeric,
  is_read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_automation_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own alerts" ON public.meta_automation_alerts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- API error logs
CREATE TABLE public.meta_api_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid REFERENCES public.connected_ad_accounts(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  method text DEFAULT 'GET',
  status_code integer,
  error_message text,
  request_body jsonb DEFAULT '{}',
  response_body jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_api_error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own error logs" ON public.meta_api_error_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sync logs
CREATE TABLE public.meta_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid REFERENCES public.connected_ad_accounts(id) ON DELETE SET NULL,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  records_synced integer DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.meta_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own sync logs" ON public.meta_sync_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated at triggers
CREATE TRIGGER update_connected_meta_accounts_updated_at BEFORE UPDATE ON public.connected_meta_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_connected_ad_accounts_updated_at BEFORE UPDATE ON public.connected_ad_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meta_campaigns_updated_at BEFORE UPDATE ON public.meta_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meta_adsets_updated_at BEFORE UPDATE ON public.meta_adsets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meta_ads_updated_at BEFORE UPDATE ON public.meta_ads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meta_automation_rules_updated_at BEFORE UPDATE ON public.meta_automation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
