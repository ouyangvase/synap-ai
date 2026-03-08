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
    // Get all active rules
    const { data: rules } = await admin
      .from("meta_automation_rules")
      .select("*")
      .eq("is_active", true);

    if (!rules?.length) return jsonResp({ message: "No active rules", alerts: 0 });

    let alertsCreated = 0;

    for (const rule of rules) {
      // Get latest insights (last 24h aggregate) for the ad account
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);

      let query = admin
        .from("ad_insights_daily")
        .select("*")
        .gte("date_start", yesterday)
        .lte("date_stop", today);

      if (rule.ad_account_id) query = query.eq("ad_account_id", rule.ad_account_id);

      const { data: insights } = await query;
      if (!insights?.length) continue;

      // Aggregate metrics
      const totals = insights.reduce((acc: any, r: any) => ({
        impressions: acc.impressions + Number(r.impressions || 0),
        clicks: acc.clicks + Number(r.clicks || 0),
        spend: acc.spend + Number(r.spend || 0),
        reach: acc.reach + Number(r.reach || 0),
        conversions: acc.conversions + Number(r.conversions || 0),
        frequency: acc.frequency + Number(r.frequency || 0),
      }), { impressions: 0, clicks: 0, spend: 0, reach: 0, conversions: 0, frequency: 0 });

      // Compute derived metrics
      const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
      const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
      const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
      const roas = totals.spend > 0 ? totals.conversions / totals.spend : 0;

      const metricValues: Record<string, number> = {
        ctr, cpc, cpm, roas, spend: totals.spend, impressions: totals.impressions,
        clicks: totals.clicks, reach: totals.reach, conversions: totals.conversions,
        frequency: totals.frequency / (insights.length || 1),
      };

      const metricValue = metricValues[rule.metric];
      if (metricValue === undefined) continue;

      // Evaluate condition
      let triggered = false;
      switch (rule.operator) {
        case "gt": case ">": triggered = metricValue > rule.threshold; break;
        case "lt": case "<": triggered = metricValue < rule.threshold; break;
        case "gte": case ">=": triggered = metricValue >= rule.threshold; break;
        case "lte": case "<=": triggered = metricValue <= rule.threshold; break;
        case "eq": case "=": triggered = metricValue === rule.threshold; break;
      }

      if (!triggered) continue;

      // Determine severity
      const severity = rule.action_type === "alert" ? "warning" : "critical";

      // Create alert
      await admin.from("meta_automation_alerts").insert({
        rule_id: rule.id,
        user_id: rule.user_id,
        ad_account_id: rule.ad_account_id,
        message: `Rule "${rule.name}" triggered: ${rule.metric} is ${metricValue.toFixed(2)} (threshold: ${rule.operator} ${rule.threshold})`,
        severity,
        metric_value: metricValue,
      });
      alertsCreated++;

      // Update last triggered
      await admin.from("meta_automation_rules").update({
        last_triggered_at: new Date().toISOString(),
      }).eq("id", rule.id);

      // Execute action if pause type
      if (rule.action_type.startsWith("pause_") && rule.action_config) {
        const config = rule.action_config as any;
        const objectId = config.object_id;
        if (objectId) {
          try {
            // Get the meta account for this ad account
            const { data: aa } = await admin
              .from("connected_ad_accounts")
              .select("meta_account_id")
              .eq("id", rule.ad_account_id)
              .single();
            if (aa) {
              const { data: ma } = await admin
                .from("connected_meta_accounts")
                .select("access_token_encrypted")
                .eq("id", aa.meta_account_id)
                .single();
              if (ma) {
                await fetch(`${META_API_BASE}/${objectId}?access_token=${ma.access_token_encrypted}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "PAUSED" }),
                });
              }
            }
          } catch (pauseErr: any) {
            console.warn("Auto-pause failed:", pauseErr.message);
          }
        }
      }
    }

    return jsonResp({ alerts_created: alertsCreated, rules_evaluated: rules.length });
  } catch (error: any) {
    console.error("meta-automation-eval error:", error);
    return jsonResp({ error: error.message }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
