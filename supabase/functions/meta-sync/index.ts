import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_API_BASE = "https://graph.facebook.com/v21.0";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Optional: scope to specific user/account via body
    const body = await req.json().catch(() => ({}));
    const targetUserId = body.user_id;
    const targetAdAccountId = body.ad_account_id;

    // Get active meta accounts
    let query = admin.from("connected_meta_accounts").select("*").eq("status", "active");
    if (targetUserId) query = query.eq("user_id", targetUserId);
    const { data: metaAccounts } = await query;
    if (!metaAccounts?.length) return jsonResp({ message: "No active accounts" });

    const results: any[] = [];

    for (const ma of metaAccounts) {
      const token = ma.access_token_encrypted;
      let adAccountQuery = admin.from("connected_ad_accounts").select("*").eq("meta_account_id", ma.id).eq("status", "active");
      if (targetAdAccountId) adAccountQuery = adAccountQuery.eq("id", targetAdAccountId);
      const { data: adAccounts } = await adAccountQuery;
      if (!adAccounts?.length) continue;

      for (const aa of adAccounts) {
        const logId = crypto.randomUUID();
        await admin.from("meta_sync_logs").insert({
          id: logId, user_id: ma.user_id, ad_account_id: aa.id,
          sync_type: "full", status: "running", started_at: new Date().toISOString(),
        });

        let totalSynced = 0;
        try {
          // Sync campaigns
          const camps = await metaFetch(`${META_API_BASE}/${aa.ad_account_id}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,start_time,stop_time,created_time,updated_time&limit=500&access_token=${token}`);
          for (const c of (camps.data || [])) {
            await admin.from("meta_campaigns").upsert({
              ad_account_id: aa.id, meta_campaign_id: c.id, name: c.name,
              objective: c.objective, status: c.status || "PAUSED",
              effective_status: c.effective_status, buying_type: c.buying_type || "AUCTION",
              daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
              lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
              special_ad_categories: c.special_ad_categories || [],
              start_time: c.start_time, stop_time: c.stop_time,
              meta_created_time: c.created_time, meta_updated_time: c.updated_time,
              raw_data: c, synced_at: new Date().toISOString(), user_id: ma.user_id,
            }, { onConflict: "ad_account_id,meta_campaign_id" });
            totalSynced++;
          }

          // Get local campaign map
          const { data: localCamps } = await admin.from("meta_campaigns").select("id, meta_campaign_id").eq("ad_account_id", aa.id);
          const campMap = new Map((localCamps || []).map((c: any) => [c.meta_campaign_id, c.id]));

          // Sync adsets
          const adsets = await metaFetch(`${META_API_BASE}/${aa.ad_account_id}/adsets?fields=id,name,status,effective_status,optimization_goal,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting,campaign_id&limit=500&access_token=${token}`);
          for (const a of (adsets.data || [])) {
            const localCampId = campMap.get(a.campaign_id);
            if (!localCampId) continue;
            await admin.from("meta_adsets").upsert({
              ad_account_id: aa.id, campaign_id: localCampId, meta_adset_id: a.id,
              name: a.name, status: a.status || "PAUSED", effective_status: a.effective_status,
              optimization_goal: a.optimization_goal, bid_strategy: a.bid_strategy,
              daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
              lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
              start_time: a.start_time, end_time: a.end_time, targeting: a.targeting || {},
              raw_data: a, synced_at: new Date().toISOString(), user_id: ma.user_id,
            }, { onConflict: "ad_account_id,meta_adset_id" });
            totalSynced++;
          }

          // Get local adset map
          const { data: localAdsets } = await admin.from("meta_adsets").select("id, meta_adset_id").eq("ad_account_id", aa.id);
          const adsetMap = new Map((localAdsets || []).map((a: any) => [a.meta_adset_id, a.id]));

          // Sync ads
          const ads = await metaFetch(`${META_API_BASE}/${aa.ad_account_id}/ads?fields=id,name,status,effective_status,creative,adset_id&limit=500&access_token=${token}`);
          for (const ad of (ads.data || [])) {
            const localAdsetId = adsetMap.get(ad.adset_id);
            if (!localAdsetId) continue;
            await admin.from("meta_ads").upsert({
              ad_account_id: aa.id, adset_id: localAdsetId, meta_ad_id: ad.id,
              name: ad.name, status: ad.status || "PAUSED", effective_status: ad.effective_status,
              raw_data: ad, synced_at: new Date().toISOString(), user_id: ma.user_id,
            }, { onConflict: "ad_account_id,meta_ad_id" });
            totalSynced++;
          }

          // Sync insights (last 7 days)
          try {
            const insights = await metaFetch(`${META_API_BASE}/${aa.ad_account_id}/insights?fields=impressions,reach,clicks,ctr,cpc,cpm,spend,frequency&date_preset=last_7d&time_increment=1&access_token=${token}`);
            for (const row of (insights.data || [])) {
              await admin.from("ad_insights_daily").upsert({
                ad_account_id: aa.id, campaign_id: null,
                date_start: row.date_start, date_stop: row.date_stop,
                impressions: Number(row.impressions || 0), reach: Number(row.reach || 0),
                clicks: Number(row.clicks || 0), spend: Number(row.spend || 0),
                ctr: Number(row.ctr || 0), cpc: Number(row.cpc || 0),
                cpm: Number(row.cpm || 0), frequency: Number(row.frequency || 0),
                raw_data: row, synced_at: new Date().toISOString(), user_id: ma.user_id,
              }, { onConflict: "ad_account_id,campaign_id,date_start,date_stop", ignoreDuplicates: false });
              totalSynced++;
            }
          } catch (insightErr: any) {
            console.warn("Insights sync error:", insightErr.message);
          }

          // Update sync log
          await admin.from("meta_sync_logs").update({
            status: "completed", completed_at: new Date().toISOString(), records_synced: totalSynced,
          }).eq("id", logId);

          // Update last_synced_at
          await admin.from("connected_ad_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", aa.id);
          await admin.from("connected_meta_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", ma.id);

          results.push({ ad_account: aa.ad_account_id, synced: totalSynced, status: "completed" });
        } catch (syncErr: any) {
          await admin.from("meta_sync_logs").update({
            status: "failed", completed_at: new Date().toISOString(), error_message: syncErr.message,
          }).eq("id", logId);
          results.push({ ad_account: aa.ad_account_id, status: "failed", error: syncErr.message });
        }
      }
    }

    return jsonResp({ results });
  } catch (error: any) {
    console.error("meta-sync error:", error);
    return jsonResp({ error: error.message }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function metaFetch(url: string, method = "GET", body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `Meta API error [${resp.status}]`);
  return data;
}
