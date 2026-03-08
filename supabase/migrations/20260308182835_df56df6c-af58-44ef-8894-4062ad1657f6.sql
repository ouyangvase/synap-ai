CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_campaigns_account_meta_id ON meta_campaigns(ad_account_id, meta_campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_adsets_account_meta_id ON meta_adsets(ad_account_id, meta_adset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ads_account_meta_id ON meta_ads(ad_account_id, meta_ad_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_daily_unique ON ad_insights_daily(ad_account_id, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), date_start, date_stop);