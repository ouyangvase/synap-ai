import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface MetaApiParams {
  action: string;
  meta_account_id: string;
  params?: Record<string, any>;
}

export function useMetaApi() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const call = useCallback(async ({ action, meta_account_id, params }: MetaApiParams) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-api", {
        body: { action, meta_account_id, params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { data, error: null };
    } catch (err: any) {
      const msg = err?.context?.body?.error || err?.message || "Meta API request failed";
      toast({ title: "Meta API Error", description: String(msg), variant: "destructive" });
      return { data: null, error: String(msg) };
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const syncCampaigns = useCallback(async (metaAccountId: string, adAccountId: string, metaAdAccountId: string, userId: string) => {
    const res = await call({ action: "get_campaigns", meta_account_id: metaAccountId, params: { ad_account_id: metaAdAccountId } });
    if (!res.data?.data) return res;

    for (const c of res.data.data) {
      await supabase.from("meta_campaigns").upsert({
        ad_account_id: adAccountId,
        meta_campaign_id: c.id,
        name: c.name,
        objective: c.objective || null,
        status: c.status || "PAUSED",
        effective_status: c.effective_status || null,
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        buying_type: c.buying_type || "AUCTION",
        special_ad_categories: c.special_ad_categories || [],
        start_time: c.start_time || null,
        stop_time: c.stop_time || null,
        meta_created_time: c.created_time || null,
        meta_updated_time: c.updated_time || null,
        raw_data: c,
        synced_at: new Date().toISOString(),
        user_id: userId,
      }, { onConflict: "ad_account_id,meta_campaign_id" });
    }
    return { data: res.data.data, error: null };
  }, [call]);

  const syncAdsets = useCallback(async (metaAccountId: string, adAccountId: string, metaAdAccountId: string, userId: string) => {
    const res = await call({ action: "get_adsets", meta_account_id: metaAccountId, params: { ad_account_id: metaAdAccountId } });
    if (!res.data?.data) return res;

    // Get campaign mapping
    const { data: localCampaigns } = await supabase
      .from("meta_campaigns")
      .select("id, meta_campaign_id")
      .eq("ad_account_id", adAccountId);
    const campMap = new Map((localCampaigns || []).map(c => [c.meta_campaign_id, c.id]));

    for (const a of res.data.data) {
      const localCampaignId = campMap.get(a.campaign_id);
      if (!localCampaignId) continue;
      await supabase.from("meta_adsets").upsert({
        ad_account_id: adAccountId,
        campaign_id: localCampaignId,
        meta_adset_id: a.id,
        name: a.name,
        status: a.status || "PAUSED",
        effective_status: a.effective_status || null,
        optimization_goal: a.optimization_goal || null,
        bid_strategy: a.bid_strategy || null,
        daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
        start_time: a.start_time || null,
        end_time: a.end_time || null,
        targeting: a.targeting || {},
        raw_data: a,
        synced_at: new Date().toISOString(),
        user_id: userId,
      }, { onConflict: "ad_account_id,meta_adset_id" });
    }
    return { data: res.data.data, error: null };
  }, [call]);

  const syncAds = useCallback(async (metaAccountId: string, adAccountId: string, metaAdAccountId: string, userId: string) => {
    const res = await call({ action: "get_ads", meta_account_id: metaAccountId, params: { ad_account_id: metaAdAccountId } });
    if (!res.data?.data) return res;

    const { data: localAdsets } = await supabase
      .from("meta_adsets")
      .select("id, meta_adset_id")
      .eq("ad_account_id", adAccountId);
    const adsetMap = new Map((localAdsets || []).map(a => [a.meta_adset_id, a.id]));

    for (const ad of res.data.data) {
      const localAdsetId = adsetMap.get(ad.adset_id);
      if (!localAdsetId) continue;
      await supabase.from("meta_ads").upsert({
        ad_account_id: adAccountId,
        adset_id: localAdsetId,
        meta_ad_id: ad.id,
        name: ad.name,
        status: ad.status || "PAUSED",
        effective_status: ad.effective_status || null,
        raw_data: ad,
        synced_at: new Date().toISOString(),
        user_id: userId,
      }, { onConflict: "ad_account_id,meta_ad_id" });
    }
    return { data: res.data.data, error: null };
  }, [call]);

  const syncInsights = useCallback(async (metaAccountId: string, adAccountId: string, metaAdAccountId: string, userId: string) => {
    const res = await call({
      action: "get_insights",
      meta_account_id: metaAccountId,
      params: { object_id: metaAdAccountId, level: "campaign", date_preset: "last_7d" },
    });
    if (!res.data?.data) return res;

    for (const row of res.data.data) {
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const clicks = Number(row.clicks || 0);
      const reach = Number(row.reach || 0);
      const ctr = Number(row.ctr || 0);
      const cpc = Number(row.cpc || 0);
      const cpm = Number(row.cpm || 0);
      const frequency = Number(row.frequency || 0);

      await supabase.from("ad_insights_daily").upsert({
        ad_account_id: adAccountId,
        campaign_id: null,
        date_start: row.date_start,
        date_stop: row.date_stop,
        impressions, reach, clicks, spend, ctr, cpc, cpm, frequency,
        raw_data: row,
        synced_at: new Date().toISOString(),
        user_id: userId,
      }, { onConflict: "ad_account_id,campaign_id,date_start,date_stop", ignoreDuplicates: false });
    }
    return { data: res.data.data, error: null };
  }, [call]);

  const pushToMeta = useCallback(async (
    action: string,
    metaAccountId: string,
    params: Record<string, any>,
  ) => {
    return call({ action, meta_account_id: metaAccountId, params });
  }, [call]);

  return { call, loading, syncCampaigns, syncAdsets, syncAds, syncInsights, pushToMeta };
}
