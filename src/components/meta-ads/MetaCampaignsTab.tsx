import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMetaApi } from "@/hooks/useMetaApi";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { Plus, Play, Pause, Copy, Pencil, RefreshCw, Upload } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

const OBJECTIVES = ["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_APP_PROMOTION"];
const STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"];

export function MetaCampaignsTab({ adAccount }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const metaApi = useMetaApi();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ name: "", objective: "OUTCOME_TRAFFIC", buying_type: "AUCTION", status: "PAUSED", daily_budget: "", lifetime_budget: "", start_time: "", stop_time: "", special_ad_categories: "" });

  useEffect(() => { if (adAccount) loadCampaigns(); }, [adAccount]);

  const loadCampaigns = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_campaigns").select("*").eq("ad_account_id", adAccount.id).order("updated_at", { ascending: false });
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
    const { data, error } = await metaApi.syncCampaigns(metaAccountId, adAccount.id, adAccount.ad_account_id, user.id);
    setSyncing(false);
    if (error) return;
    toast({ title: `Synced ${data?.length || 0} campaigns from Meta` });
    loadCampaigns();
  };

  const handleSave = async () => {
    if (!adAccount || !user) return;
    const metaAccountId = await getMetaAccountId();
    const isLocal = !editCampaign || editCampaign.meta_campaign_id?.startsWith("local_");

    // Try push to Meta if we have a linked account
    let metaCampaignId = editCampaign?.meta_campaign_id || `local_${Date.now()}`;
    if (metaAccountId) {
      const metaData: any = {
        name: form.name,
        objective: form.objective,
        status: form.status,
        special_ad_categories: form.special_ad_categories ? form.special_ad_categories.split(",").map(s => s.trim()) : ["NONE"],
      };
      if (form.daily_budget) metaData.daily_budget = Math.round(Number(form.daily_budget) * 100);
      if (form.lifetime_budget) metaData.lifetime_budget = Math.round(Number(form.lifetime_budget) * 100);

      if (editCampaign && !isLocal) {
        // Update existing on Meta
        const res = await metaApi.pushToMeta("update_campaign", metaAccountId, {
          campaign_id: editCampaign.meta_campaign_id, data: metaData,
        });
        if (res.error) toast({ title: "Saved locally (Meta update failed)", description: res.error });
      } else {
        // Create new on Meta
        const res = await metaApi.pushToMeta("create_campaign", metaAccountId, {
          ad_account_id: adAccount.ad_account_id, data: metaData,
        });
        if (res.data?.id) {
          metaCampaignId = res.data.id;
          toast({ title: "Campaign created on Meta" });
        } else {
          toast({ title: "Saved locally (Meta create failed)", description: res.error || undefined });
        }
      }
    }

    const payload = {
      ad_account_id: adAccount.id, name: form.name, objective: form.objective,
      buying_type: form.buying_type, status: form.status,
      daily_budget: form.daily_budget ? Number(form.daily_budget) : null,
      lifetime_budget: form.lifetime_budget ? Number(form.lifetime_budget) : null,
      start_time: form.start_time || null, stop_time: form.stop_time || null,
      special_ad_categories: form.special_ad_categories ? form.special_ad_categories.split(",").map(s => s.trim()) : [],
      user_id: user.id, meta_campaign_id: metaCampaignId,
    };

    if (editCampaign) {
      await supabase.from("meta_campaigns").update(payload).eq("id", editCampaign.id);
      toast({ title: "Campaign updated" });
    } else {
      await supabase.from("meta_campaigns").insert(payload);
      toast({ title: "Campaign created" });
    }
    setShowCreate(false); setEditCampaign(null); resetForm(); loadCampaigns();
  };

  const resetForm = () => setForm({ name: "", objective: "OUTCOME_TRAFFIC", buying_type: "AUCTION", status: "PAUSED", daily_budget: "", lifetime_budget: "", start_time: "", stop_time: "", special_ad_categories: "" });

  const openEdit = (c: any) => {
    setEditCampaign(c);
    setForm({
      name: c.name, objective: c.objective || "OUTCOME_TRAFFIC", buying_type: c.buying_type || "AUCTION",
      status: c.status, daily_budget: c.daily_budget?.toString() || "", lifetime_budget: c.lifetime_budget?.toString() || "",
      start_time: c.start_time ? new Date(c.start_time).toISOString().slice(0, 16) : "",
      stop_time: c.stop_time ? new Date(c.stop_time).toISOString().slice(0, 16) : "",
      special_ad_categories: (c.special_ad_categories || []).join(", "),
    });
    setShowCreate(true);
  };

  const toggleStatus = async (c: any) => {
    const newStatus = c.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    // Push status change to Meta if real campaign
    if (!c.meta_campaign_id?.startsWith("local_")) {
      const metaAccountId = await getMetaAccountId();
      if (metaAccountId) {
        await metaApi.pushToMeta("update_status", metaAccountId, {
          object_id: c.meta_campaign_id, status: newStatus,
        });
      }
    }
    await supabase.from("meta_campaigns").update({ status: newStatus }).eq("id", c.id);
    loadCampaigns();
  };

  const duplicate = async (c: any) => {
    if (!user) return;
    const { id, created_at, updated_at, synced_at, meta_campaign_id, ...rest } = c;
    await supabase.from("meta_campaigns").insert({ ...rest, name: `${c.name} (Copy)`, meta_campaign_id: `local_${Date.now()}`, user_id: user.id });
    toast({ title: "Campaign duplicated" }); loadCampaigns();
  };

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Campaigns</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
          </Button>
          <Button size="sm" onClick={() => { resetForm(); setEditCampaign(null); setShowCreate(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Create Campaign
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Objective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Daily Budget</TableHead>
                <TableHead>Lifetime Budget</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No campaigns yet</TableCell></TableRow>
              ) : campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-xs">{c.objective?.replace("OUTCOME_", "")}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "ACTIVE" ? "default" : c.status === "PAUSED" ? "secondary" : "outline"} className="text-xs">{c.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.meta_campaign_id?.startsWith("local_") ? "outline" : "default"} className="text-xs">
                      {c.meta_campaign_id?.startsWith("local_") ? "Local" : "Meta"}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.daily_budget ? `$${c.daily_budget}` : "—"}</TableCell>
                  <TableCell>{c.lifetime_budget ? `$${c.lifetime_budget}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(c)}>
                        {c.status === "ACTIVE" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicate(c)}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editCampaign ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Campaign Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Campaign" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Objective</Label>
                <Select value={form.objective} onValueChange={v => setForm(f => ({ ...f, objective: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{OBJECTIVES.map(o => <SelectItem key={o} value={o} className="text-xs">{o.replace("OUTCOME_", "")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Daily Budget ($)</Label><Input type="number" value={form.daily_budget} onChange={e => setForm(f => ({ ...f, daily_budget: e.target.value }))} /></div>
              <div><Label className="text-xs">Lifetime Budget ($)</Label><Input type="number" value={form.lifetime_budget} onChange={e => setForm(f => ({ ...f, lifetime_budget: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Start</Label><Input type="datetime-local" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} /></div>
              <div><Label className="text-xs">End</Label><Input type="datetime-local" value={form.stop_time} onChange={e => setForm(f => ({ ...f, stop_time: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Special Ad Categories (comma separated)</Label><Input value={form.special_ad_categories} onChange={e => setForm(f => ({ ...f, special_ad_categories: e.target.value }))} placeholder="HOUSING, CREDIT" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || metaApi.loading}>
              {metaApi.loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {editCampaign ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
