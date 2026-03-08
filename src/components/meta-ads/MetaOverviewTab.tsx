import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { TrendingUp, Eye, MousePointer, DollarSign, Target, BarChart3, Activity, Users, RefreshCw } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

interface MetricCard { label: string; value: string; icon: React.ReactNode; }

export function MetaOverviewTab({ adAccount }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { if (adAccount) loadData(); }, [adAccount]);

  const loadData = async () => {
    if (!adAccount) return;
    const { data: camps } = await supabase.from("meta_campaigns").select("*").eq("ad_account_id", adAccount.id).order("updated_at", { ascending: false }).limit(5);
    setCampaigns(camps || []);

    const { data: alertData } = await supabase.from("meta_automation_alerts").select("*").eq("ad_account_id", adAccount.id).order("created_at", { ascending: false }).limit(5);
    setAlerts(alertData || []);

    const { data: insights } = await supabase.from("ad_insights_daily").select("impressions, reach, clicks, spend, ctr, cpc, cpm, conversions").eq("ad_account_id", adAccount.id).gte("date_start", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));

    if (insights && insights.length > 0) {
      const totals = insights.reduce((acc, r) => ({
        impressions: acc.impressions + Number(r.impressions || 0),
        reach: acc.reach + Number(r.reach || 0),
        clicks: acc.clicks + Number(r.clicks || 0),
        spend: acc.spend + Number(r.spend || 0),
        conversions: acc.conversions + Number(r.conversions || 0),
      }), { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0 });
      const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0";
      const cpc = totals.clicks > 0 ? (totals.spend / totals.clicks).toFixed(2) : "0";
      setMetrics([
        { label: "Impressions", value: totals.impressions.toLocaleString(), icon: <Eye className="w-4 h-4" /> },
        { label: "Reach", value: totals.reach.toLocaleString(), icon: <Users className="w-4 h-4" /> },
        { label: "Clicks", value: totals.clicks.toLocaleString(), icon: <MousePointer className="w-4 h-4" /> },
        { label: "Spend", value: `$${totals.spend.toFixed(2)}`, icon: <DollarSign className="w-4 h-4" /> },
        { label: "CTR", value: `${ctr}%`, icon: <Target className="w-4 h-4" /> },
        { label: "CPC", value: `$${cpc}`, icon: <BarChart3 className="w-4 h-4" /> },
        { label: "Conversions", value: totals.conversions.toLocaleString(), icon: <TrendingUp className="w-4 h-4" /> },
      ]);
    } else {
      setMetrics([
        { label: "Impressions", value: "0", icon: <Eye className="w-4 h-4" /> },
        { label: "Reach", value: "0", icon: <Users className="w-4 h-4" /> },
        { label: "Clicks", value: "0", icon: <MousePointer className="w-4 h-4" /> },
        { label: "Spend", value: "$0.00", icon: <DollarSign className="w-4 h-4" /> },
        { label: "CTR", value: "0%", icon: <Target className="w-4 h-4" /> },
        { label: "CPC", value: "$0.00", icon: <BarChart3 className="w-4 h-4" /> },
        { label: "Conversions", value: "0", icon: <TrendingUp className="w-4 h-4" /> },
      ]);
    }
  };

  const handleFullSync = async () => {
    if (!adAccount) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-sync", {
        body: { ad_account_id: adAccount.id },
      });
      if (error) throw error;
      toast({ title: "Full sync completed", description: `Results: ${JSON.stringify(data?.results?.map((r: any) => `${r.ad_account}: ${r.status} (${r.synced || 0} records)`) || [])}` });
      loadData();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  if (!adAccount) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Activity className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">No Ad Account Selected</p>
        <p className="text-sm mt-1">Connect a Meta account in the Settings tab to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Overview (Last 7 Days)</h2>
        <Button size="sm" variant="outline" onClick={handleFullSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          Full Sync from Meta
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {metrics.map(m => (
          <Card key={m.label} className="p-0">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">{m.icon}<span className="text-xs">{m.label}</span></div>
              <p className="text-lg font-bold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Top Campaigns</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {campaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No campaigns synced yet</p>
            ) : campaigns.map(c => (
              <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                <span className="text-sm truncate flex-1">{c.name}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant={c.meta_campaign_id?.startsWith("local_") ? "outline" : "default"} className="text-xs">
                    {c.meta_campaign_id?.startsWith("local_") ? "Local" : "Meta"}
                  </Badge>
                  <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Recent Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No alerts</p>
            ) : alerts.map(a => (
              <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} className="text-xs shrink-0 mt-0.5">{a.severity}</Badge>
                <span className="text-xs text-muted-foreground">{a.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
