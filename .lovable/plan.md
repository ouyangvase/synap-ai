

## Plan: Complete Meta Ads Hub with Real Meta API Integration

### Current State
The Meta Ads Hub has all 8 UI tabs built with local database CRUD. However, **nothing actually calls the Meta Marketing API**. All operations (create campaign, edit ad set, etc.) only save to the local database. The `meta-api` edge function exists as a proxy but no frontend code invokes it.

### What Needs to Be Done

**1. Create a `useMetaApi` hook** — central helper that calls the `meta-api` edge function, retrieves the stored access token from `connected_meta_accounts`, and handles errors/logging.

**2. Add "Sync from Meta" to each tab** — Campaigns, Ad Sets, Ads tabs get a "Sync" button that pulls real data from Meta API via the edge function, then upserts into the local DB (matching on `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`).

**3. Add "Push to Meta" on create/edit** — When creating or editing a campaign/adset/ad, the save action first calls the Meta API (create or update), then stores the returned Meta ID in the local DB. Local-only drafts remain supported (prefix `local_`).

**4. Auto-discover Ad Accounts in Settings** — After connecting a Meta account, add a "Fetch Ad Accounts" button that calls `get_ad_accounts` via the edge function, letting users pick which ones to link instead of manually entering IDs.

**5. Build `meta-sync` edge function** — A dedicated edge function that syncs campaigns, ad sets, ads, and daily insights for all active ad accounts. Logs results to `meta_sync_logs`. Can be triggered manually or via cron.

**6. Build `meta-automation-eval` edge function** — Evaluates active automation rules against the latest `ad_insights_daily` data, creates alerts in `meta_automation_alerts`, and optionally executes actions (pause via Meta API).

**7. Add error logging** — Update `meta-api` edge function to log failed requests to `meta_api_error_logs` table using the service role client.

**8. Secure token retrieval** — The `meta-api` edge function should accept a `meta_account_id` instead of raw `access_token` from the frontend, and fetch the token server-side from `connected_meta_accounts` using the service role. This keeps tokens out of the browser.

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/hooks/useMetaApi.ts` | **Create** — Hook wrapping `supabase.functions.invoke("meta-api", ...)` |
| `src/components/meta-ads/MetaCampaignsTab.tsx` | **Edit** — Add Sync button, push-to-Meta on save |
| `src/components/meta-ads/MetaAdSetsTab.tsx` | **Edit** — Add Sync button, push-to-Meta on save |
| `src/components/meta-ads/MetaAdsTab.tsx` | **Edit** — Add Sync button, push-to-Meta on save |
| `src/components/meta-ads/MetaSettingsTab.tsx` | **Edit** — Add "Fetch Ad Accounts" auto-discovery |
| `src/components/meta-ads/MetaOverviewTab.tsx` | **Edit** — Add manual sync trigger |
| `supabase/functions/meta-api/index.ts` | **Edit** — Fetch token server-side, log errors to DB |
| `supabase/functions/meta-sync/index.ts` | **Create** — Full sync: campaigns + adsets + ads + insights |
| `supabase/functions/meta-automation-eval/index.ts` | **Create** — Rule evaluation engine |
| `supabase/config.toml` | **Edit** — Register new edge functions |

### Technical Details

**Token Security Flow:**
```text
Frontend → meta-api edge function (sends meta_account_id)
  → Edge function uses service role to SELECT access_token_encrypted FROM connected_meta_accounts
  → Edge function calls Meta Graph API with the token
  → Returns data to frontend (token never exposed)
```

**Sync Flow:**
```text
meta-sync edge function:
  1. SELECT all active connected_meta_accounts + their ad accounts
  2. For each ad account:
     a. GET /campaigns → upsert into meta_campaigns
     b. GET /adsets → upsert into meta_adsets  
     c. GET /ads → upsert into meta_ads
     d. GET /insights (last 7d) → upsert into ad_insights_daily
  3. Log sync results to meta_sync_logs
```

**Automation Eval Flow:**
```text
meta-automation-eval edge function:
  1. SELECT active rules from meta_automation_rules
  2. For each rule, query ad_insights_daily (last 24h aggregate)
  3. Evaluate condition (metric operator threshold)
  4. If triggered → INSERT alert into meta_automation_alerts
  5. If action_type is pause_* → call meta-api to pause the object
```

**Push-to-Meta on Save (Campaigns example):**
- If creating new: call `create_campaign` via edge function → get back Meta campaign ID → save to DB with real `meta_campaign_id`
- If editing existing with real Meta ID: call `update_campaign` → update local DB
- If Meta API fails: save locally, show error toast, log to error table

### Database Migration
One migration needed to add a unique constraint for upsert support:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_campaigns_account_meta_id 
  ON meta_campaigns(ad_account_id, meta_campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_adsets_account_meta_id 
  ON meta_adsets(ad_account_id, meta_adset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ads_account_meta_id 
  ON meta_ads(ad_account_id, meta_ad_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_daily_unique 
  ON ad_insights_daily(ad_account_id, campaign_id, date_start, date_stop);
```

