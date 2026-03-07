import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_BASE = "https://graph.facebook.com/v21.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, access_token, params } = await req.json();

    if (!access_token) {
      return new Response(JSON.stringify({ error: "Missing access_token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any;

    switch (action) {
      // Account discovery
      case "get_ad_accounts": {
        const userId = params?.user_id || "me";
        const url = `${META_API_BASE}/${userId}/adaccounts?fields=id,name,currency,timezone_name,account_status&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }

      // Campaigns
      case "get_campaigns": {
        const url = `${META_API_BASE}/${params.ad_account_id}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,start_time,stop_time,created_time,updated_time&limit=100&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }
      case "create_campaign": {
        const url = `${META_API_BASE}/${params.ad_account_id}/campaigns?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }
      case "update_campaign": {
        const url = `${META_API_BASE}/${params.campaign_id}?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }

      // Ad Sets
      case "get_adsets": {
        const url = `${META_API_BASE}/${params.ad_account_id}/adsets?fields=id,name,status,effective_status,optimization_goal,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting,campaign_id&limit=100&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }
      case "create_adset": {
        const url = `${META_API_BASE}/${params.ad_account_id}/adsets?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }
      case "update_adset": {
        const url = `${META_API_BASE}/${params.adset_id}?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }

      // Ads
      case "get_ads": {
        const url = `${META_API_BASE}/${params.ad_account_id}/ads?fields=id,name,status,effective_status,creative,adset_id&limit=100&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }
      case "create_ad": {
        const url = `${META_API_BASE}/${params.ad_account_id}/ads?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }
      case "update_ad": {
        const url = `${META_API_BASE}/${params.ad_id}?access_token=${access_token}`;
        result = await metaFetch(url, "POST", params.data);
        break;
      }

      // Insights
      case "get_insights": {
        const level = params.level || "campaign";
        const datePreset = params.date_preset;
        const timeRange = params.time_range;
        let url = `${META_API_BASE}/${params.object_id}/insights?fields=impressions,reach,clicks,ctr,cpc,cpm,spend,actions,cost_per_action_type,frequency&level=${level}`;
        if (datePreset) url += `&date_preset=${datePreset}`;
        if (timeRange) url += `&time_range=${JSON.stringify(timeRange)}`;
        url += `&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }

      // Status changes
      case "update_status": {
        const url = `${META_API_BASE}/${params.object_id}?access_token=${access_token}`;
        result = await metaFetch(url, "POST", { status: params.status });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Meta API proxy error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function metaFetch(url: string, method = "GET", body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(data.error?.message || `Meta API error [${resp.status}]`);
  }
  return data;
}
