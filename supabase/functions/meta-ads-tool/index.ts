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

  // Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResp({ error: "Unauthorized" }, 401);
  const userId = user.id;

  try {
    const { action, params } = await req.json();

    switch (action) {
      case "list_accounts": {
        const { data: metaAccounts } = await adminClient
          .from("connected_meta_accounts")
          .select("id, meta_user_id, meta_user_name, status")
          .eq("user_id", userId)
          .eq("status", "active");

        const { data: adAccounts } = await adminClient
          .from("connected_ad_accounts")
          .select("id, ad_account_id, ad_account_name, meta_account_id, currency, timezone, status")
          .eq("user_id", userId);

        return jsonResp({
          markdown_content: `Found ${metaAccounts?.length || 0} Meta account(s) and ${adAccounts?.length || 0} ad account(s).`,
          meta_accounts: metaAccounts || [],
          ad_accounts: adAccounts || [],
        });
      }

      case "list_campaigns": {
        const adAccountId = params?.ad_account_id;
        if (!adAccountId) return jsonResp({ error: "ad_account_id required" }, 400);

        const { data: campaigns } = await adminClient
          .from("meta_campaigns")
          .select("id, name, status, effective_status, objective, daily_budget, lifetime_budget, meta_campaign_id")
          .eq("ad_account_id", adAccountId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        return jsonResp({
          markdown_content: `Found ${campaigns?.length || 0} campaigns.`,
          campaigns: campaigns || [],
        });
      }

      case "create_campaign": {
        // Needs meta_account_id and meta_ad_account_id (the act_xxx id)
        const { meta_account_id, meta_ad_account_id, name, objective, status: campStatus, daily_budget, special_ad_categories } = params || {};
        if (!meta_account_id || !meta_ad_account_id || !name || !objective) {
          return jsonResp({ error: "meta_account_id, meta_ad_account_id, name, and objective are required" }, 400);
        }

        // Get token
        const { data: ma } = await adminClient
          .from("connected_meta_accounts")
          .select("access_token_encrypted, status")
          .eq("id", meta_account_id)
          .eq("user_id", userId)
          .single();
        if (!ma || ma.status !== "active") return jsonResp({ error: "Meta account not found or inactive" }, 400);

        const campaignData: any = {
          name,
          objective,
          status: campStatus || "PAUSED",
          special_ad_categories: special_ad_categories || [],
        };
        if (daily_budget) campaignData.daily_budget = Math.round(daily_budget * 100);

        const url = `${META_API_BASE}/${meta_ad_account_id}/campaigns?access_token=${ma.access_token_encrypted}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaignData),
        });
        const result = await resp.json();
        if (!resp.ok || result.error) {
          return jsonResp({ error: result.error?.message || "Failed to create campaign", markdown_content: `❌ Failed: ${result.error?.message}` }, 400);
        }

        return jsonResp({
          markdown_content: `✅ Campaign "${name}" created successfully (ID: ${result.id}). Objective: ${objective}, Status: ${campStatus || "PAUSED"}`,
          campaign_id: result.id,
        });
      }

      case "update_campaign": {
        const { meta_account_id, campaign_meta_id, data: updateData } = params || {};
        if (!meta_account_id || !campaign_meta_id || !updateData) {
          return jsonResp({ error: "meta_account_id, campaign_meta_id, and data required" }, 400);
        }
        const { data: ma } = await adminClient
          .from("connected_meta_accounts")
          .select("access_token_encrypted, status")
          .eq("id", meta_account_id)
          .eq("user_id", userId)
          .single();
        if (!ma || ma.status !== "active") return jsonResp({ error: "Meta account not found or inactive" }, 400);

        const url = `${META_API_BASE}/${campaign_meta_id}?access_token=${ma.access_token_encrypted}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });
        const result = await resp.json();
        if (!resp.ok || result.error) {
          return jsonResp({ error: result.error?.message || "Failed to update campaign", markdown_content: `❌ Failed: ${result.error?.message}` }, 400);
        }
        return jsonResp({ markdown_content: `✅ Campaign ${campaign_meta_id} updated.`, success: true });
      }

      case "pause_campaign": {
        const { meta_account_id, campaign_meta_id } = params || {};
        if (!meta_account_id || !campaign_meta_id) {
          return jsonResp({ error: "meta_account_id and campaign_meta_id required" }, 400);
        }
        const { data: ma } = await adminClient
          .from("connected_meta_accounts")
          .select("access_token_encrypted, status")
          .eq("id", meta_account_id)
          .eq("user_id", userId)
          .single();
        if (!ma || ma.status !== "active") return jsonResp({ error: "Meta account not found or inactive" }, 400);

        const url = `${META_API_BASE}/${campaign_meta_id}?access_token=${ma.access_token_encrypted}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "PAUSED" }),
        });
        const result = await resp.json();
        if (!resp.ok || result.error) {
          return jsonResp({ error: result.error?.message || "Failed to pause", markdown_content: `❌ ${result.error?.message}` }, 400);
        }
        return jsonResp({ markdown_content: `✅ Campaign ${campaign_meta_id} paused.`, success: true });
      }

      case "sync_all": {
        return jsonResp({
          markdown_content: "ℹ️ To sync data, go to Meta Ads → Campaigns tab and click 'Sync from Meta'. Sync is not yet available via chat.",
        });
      }

      default:
        return jsonResp({ error: `Unknown action: ${action}`, markdown_content: `❌ Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error("meta-ads-tool error:", error);
    return jsonResp({ error: error.message || "Internal error", markdown_content: `❌ Error: ${error.message}` }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
