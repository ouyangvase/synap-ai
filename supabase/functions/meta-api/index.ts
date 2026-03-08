import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_API_BASE = "https://graph.facebook.com/v21.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Validate user
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;

  try {
    const { action, meta_account_id, params } = await req.json();

    // Fetch access token server-side
    const { data: metaAccount, error: maErr } = await adminClient
      .from("connected_meta_accounts")
      .select("access_token_encrypted, meta_user_id, status")
      .eq("id", meta_account_id)
      .eq("user_id", userId)
      .single();

    if (maErr || !metaAccount) {
      return jsonResp({ error: "Meta account not found or access denied" }, 404);
    }
    if (metaAccount.status !== "active") {
      return jsonResp({ error: "Meta account is disconnected" }, 400);
    }

    const access_token = metaAccount.access_token_encrypted;
    let result: any;

    switch (action) {
      case "get_ad_accounts": {
        const uid = params?.user_id || metaAccount.meta_user_id || "me";
        const url = `${META_API_BASE}/${uid}/adaccounts?fields=id,name,currency,timezone_name,account_status&access_token=${access_token}`;
        result = await metaFetch(url);
        break;
      }
      case "get_campaigns": {
        const url = `${META_API_BASE}/${params.ad_account_id}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,start_time,stop_time,created_time,updated_time&limit=500&access_token=${access_token}`;
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
      case "get_adsets": {
        const url = `${META_API_BASE}/${params.ad_account_id}/adsets?fields=id,name,status,effective_status,optimization_goal,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting,campaign_id&limit=500&access_token=${access_token}`;
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
      case "get_ads": {
        const url = `${META_API_BASE}/${params.ad_account_id}/ads?fields=id,name,status,effective_status,creative,adset_id&limit=500&access_token=${access_token}`;
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
      case "update_status": {
        const url = `${META_API_BASE}/${params.object_id}?access_token=${access_token}`;
        result = await metaFetch(url, "POST", { status: params.status });
        break;
      }
      default:
        return jsonResp({ error: `Unknown action: ${action}` }, 400);
    }

    return jsonResp(result);
  } catch (error: any) {
    console.error("Meta API proxy error:", error);

    // Log to error table
    try {
      const body = await req.clone().json().catch(() => ({}));
      await adminClient.from("meta_api_error_logs").insert({
        user_id: userId,
        endpoint: body?.action || "unknown",
        method: "POST",
        error_message: error.message || "Unknown error",
        ad_account_id: body?.params?.ad_account_id_local || null,
        request_body: body?.params || {},
        response_body: {},
        status_code: 500,
      });
    } catch (_) {}

    return jsonResp({ error: error.message || "Internal error" }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
