import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMetaApi } from "@/hooks/useMetaApi";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { Plus, Play, Pause, Copy, Pencil, RefreshCw, Upload } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

const OPT_GOALS = ["IMPRESSIONS", "REACH", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "OFFSITE_CONVERSIONS", "LEAD_GENERATION", "VALUE"];
const BID_STRATEGIES = ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "MINIMUM_ROAS"];

export function MetaAdSetsTab({ adAccount }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const metaApi = useMetaApi();
  const [adsets, setAdsets] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editAdset, setEditAdset] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    name: "", campaign_id: "", status: "PAUSED", optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP", daily_budget: "", lifetime_budget: "",
    start_time: "", end_time: "", targeting: "{}", placements: "{}",
  });

  useEffect(() => { if (adAccount) { loadAdsets(); loadCampaigns(); } }, [adAccount]);

  const loadAdsets = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_adsets").select("*, meta_campaigns(name)").eq("ad_account_id", adAccount.id).order("updated_at", { ascending: false });
    setAdsets(data || []);
  };

  const loadCampaigns = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_campaigns").select("id, name").eq("ad_account_id", adAccount.id);
    setCampaigns(data || []);
  };

  const getMetaAccountId = async (): Promise<string | null> => {
    if (!adAccount) return null;
    const { data } = await supabase.from("connected_ad_accounts").select("meta_account_id").eq("id", adAccount.id).single();
    return data?.meta_account_id || null;
  };

  const handleSync = async () => {
    if (!adAccount || !user) return;
    const metaAccountId = await getMetaAccountId();
    if (!metaAccountId) { toast({ title: "No linked Meta account", variant: "destructive" }); return; }
    setSyncing(true);
    const { data, error } = await metaApi.syncAdsets(metaAccountId, adAccount.id, adAccount.ad_account_id, user.id);
    setSyncing(false);
    if (error) return;
    toast({ title: `Synced ${data?.length || 0} ad sets from Meta` });
    loadAdsets();
  };

  const handleSave = async () => {
    if (!adAccount || !user || !form.campaign_id) return;
    const metaAccountId = await getMetaAccountId();
    const isLocal = !editAdset || editAdset.meta_adset_id?.startsWith("local_");
    let metaAdsetId = editAdset?.meta_adset_id || `local_${Date.now()}`;

    if (metaAccountId) {
      // Get the meta campaign ID for the selected local campaign
      const { data: camp } = await supabase.from("meta_campaigns").select("meta_campaign_id").eq("id", form.campaign_id).single();
      const metaData: any = {
        name: form.name, status: form.status, optimization_goal: form.optimization_goal,
        bid_strategy: form.bid_strategy, campaign_id: camp?.meta_campaign_id,
      };
      if (form.daily_budget) metaData.daily_budget = Math.round(Number(form.daily_budget) * 100);
      if (form.lifetime_budget) metaData.lifetime_budget = Math.round(Number(form.lifetime_budget) * 100);
      try {
        const targeting = JSON.parse(form.targeting || "{}");
        if (Object.keys(targeting).length > 0) metaData.targeting = JSON.stringify(targeting);
      } catch {}

      if (editAdset && !isLocal) {
        const res = await metaApi.pushToMeta("update_adset", metaAccountId, { adset_id: editAdset.meta_adset_id, data: metaData });
        if (res.error) toast({ title: "Saved locally (Meta update failed)" });
      } else {
        const res = await metaApi.pushToMeta("create_adset", metaAccountId, { ad_account_id: adAccount.ad_account_id, data: metaData });
        if (res.data?.id) { metaAdsetId = res.data.id; toast({ title: "Ad Set created on Meta" }); }
        else toast({ title: "Saved locally (Meta create failed)" });
      }
    }

    const payload = {
      ad_account_id: adAccount.id, campaign_id: form.campaign_id, name: form.name,
      status: form.status, optimization_goal: form.optimization_goal, bid_strategy: form.bid_strategy,
      daily_budget: form.daily_budget ? Number(form.daily_budget) : null,
      lifetime_budget: form.lifetime_budget ? Number(form.lifetime_budget) : null,
      start_time: form.start_time || null, end_time: form.end_time || null,
      targeting: JSON.parse(form.targeting || "{}"), placements: JSON.parse(form.placements || "{}"),
      user_id: user.id, meta_adset_id: metaAdsetId,
    };
    if (editAdset) {
      await supabase.from("meta_adsets").update(payload).eq("id", editAdset.id);
      toast({ title: "Ad Set updated" });
    } else {
      await supabase.from("meta_adsets").insert(payload);
      toast({ title: "Ad Set created" });
    }
    setShowCreate(false); setEditAdset(null); loadAdsets();
  };

  const toggleStatus = async (a: any) => {
    const newStatus = a.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (!a.meta_adset_id?.startsWith("local_")) {
      const metaAccountId = await getMetaAccountId();
      if (metaAccountId) await metaApi.pushToMeta("update_status", metaAccountId, { object_id: a.meta_adset_id, status: newStatus });
    }
    await supabase.from("meta_adsets").update({ status: newStatus }).eq("id", a.id);
    loadAdsets();
  };

  const duplicate = async (a: any) => {
    if (!user) return;
    const { id, created_at, updated_at, synced_at, meta_adset_id, meta_campaigns, ...rest } = a;
    await supabase.from("meta_adsets").insert({ ...rest, name: `${a.name} (Copy)`, meta_adset_id: `local_${Date.now()}`, user_id: user.id });
    toast({ title: "Ad Set duplicated" }); loadAdsets();
  };

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ad Sets</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
          </Button>
          <Button size="sm" onClick={() => { setEditAdset(null); setForm({ name: "", campaign_id: "", status: "PAUSED", optimization_goal: "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", daily_budget: "", lifetime_budget: "", start_time: "", end_time: "", targeting: "{}", placements: "{}" }); setShowCreate(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Create Ad Set
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Optimization</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adsets.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No ad sets yet</TableCell></TableRow>
              ) : adsets.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-xs">{a.meta_campaigns?.name || "—"}</TableCell>
                  <TableCell><Badge variant={a.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">{a.status}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={a.meta_adset_id?.startsWith("local_") ? "outline" : "default"} className="text-xs">
                      {a.meta_adset_id?.startsWith("local_") ? "Local" : "Meta"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{a.optimization_goal}</TableCell>
                  <TableCell className="text-xs">{a.daily_budget ? `$${a.daily_budget}/day` : a.lifetime_budget ? `$${a.lifetime_budget} lifetime` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(a)}>{a.status === "ACTIVE" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditAdset(a); setForm({ name: a.name, campaign_id: a.campaign_id, status: a.status, optimization_goal: a.optimization_goal || "LINK_CLICKS", bid_strategy: a.bid_strategy || "LOWEST_COST_WITHOUT_CAP", daily_budget: a.daily_budget?.toString() || "", lifetime_budget: a.lifetime_budget?.toString() || "", start_time: a.start_time ? new Date(a.start_time).toISOString().slice(0, 16) : "", end_time: a.end_time ? new Date(a.end_time).toISOString().slice(0, 16) : "", targeting: JSON.stringify(a.targeting || {}), placements: JSON.stringify(a.placements || {}) }); setShowCreate(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicate(a)}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editAdset ? "Edit Ad Set" : "Create Ad Set"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Campaign</Label>
              <Select value={form.campaign_id} onValueChange={v => setForm(f => ({ ...f, campaign_id: v }))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select campaign" /></SelectTrigger>
                <SelectContent>{campaigns.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Optimization Goal</Label>
                <Select value={form.optimization_goal} onValueChange={v => setForm(f => ({ ...f, optimization_goal: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPT_GOALS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Bid Strategy</Label>
                <Select value={form.bid_strategy} onValueChange={v => setForm(f => ({ ...f, bid_strategy: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{BID_STRATEGIES.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Daily Budget ($)</Label><Input type="number" value={form.daily_budget} onChange={e => setForm(f => ({ ...f, daily_budget: e.target.value }))} /></div>
              <div><Label className="text-xs">Lifetime Budget ($)</Label><Input type="number" value={form.lifetime_budget} onChange={e => setForm(f => ({ ...f, lifetime_budget: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Start</Label><Input type="datetime-local" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} /></div>
              <div><Label className="text-xs">End</Label><Input type="datetime-local" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Targeting (JSON)</Label><Textarea rows={3} value={form.targeting} onChange={e => setForm(f => ({ ...f, targeting: e.target.value }))} className="font-mono text-xs" /></div>
            <div><Label className="text-xs">Placements (JSON)</Label><Textarea rows={2} value={form.placements} onChange={e => setForm(f => ({ ...f, placements: e.target.value }))} className="font-mono text-xs" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.campaign_id || metaApi.loading}>
              {metaApi.loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {editAdset ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
