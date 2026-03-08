import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMetaApi } from "@/hooks/useMetaApi";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { Plus, Play, Pause, Copy, Pencil, ExternalLink, RefreshCw, Upload } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

const CTA_TYPES = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "DOWNLOAD", "CONTACT_US", "GET_OFFER", "BOOK_NOW", "APPLY_NOW", "SUBSCRIBE", "NO_BUTTON"];
const CREATIVE_FORMATS = ["IMAGE", "VIDEO", "CAROUSEL", "COLLECTION", "INSTANT_EXPERIENCE"];

export function MetaAdsTab({ adAccount }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const metaApi = useMetaApi();
  const [ads, setAds] = useState<any[]>([]);
  const [adsets, setAdsets] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editAd, setEditAd] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    name: "", adset_id: "", status: "PAUSED", creative_format: "IMAGE",
    primary_text: "", headline: "", description: "", cta_type: "LEARN_MORE",
    destination_url: "", media_url: "", utm_parameters: "{}",
  });

  useEffect(() => { if (adAccount) { loadAds(); loadAdsets(); } }, [adAccount]);

  const loadAds = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_ads").select("*, meta_adsets(name)").eq("ad_account_id", adAccount.id).order("updated_at", { ascending: false });
    setAds(data || []);
  };

  const loadAdsets = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_adsets").select("id, name").eq("ad_account_id", adAccount.id);
    setAdsets(data || []);
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
    const { data, error } = await metaApi.syncAds(metaAccountId, adAccount.id, adAccount.ad_account_id, user.id);
    setSyncing(false);
    if (error) return;
    toast({ title: `Synced ${data?.length || 0} ads from Meta` });
    loadAds();
  };

  const handleSave = async () => {
    if (!adAccount || !user || !form.adset_id) return;
    const metaAccountId = await getMetaAccountId();
    const isLocal = !editAd || editAd.meta_ad_id?.startsWith("local_");
    let metaAdId = editAd?.meta_ad_id || `local_${Date.now()}`;

    if (metaAccountId) {
      const { data: adsetData } = await supabase.from("meta_adsets").select("meta_adset_id").eq("id", form.adset_id).single();
      const metaData: any = { name: form.name, status: form.status, adset_id: adsetData?.meta_adset_id };

      if (editAd && !isLocal) {
        const res = await metaApi.pushToMeta("update_ad", metaAccountId, { ad_id: editAd.meta_ad_id, data: metaData });
        if (res.error) toast({ title: "Saved locally (Meta update failed)" });
      } else {
        const res = await metaApi.pushToMeta("create_ad", metaAccountId, { ad_account_id: adAccount.ad_account_id, data: metaData });
        if (res.data?.id) { metaAdId = res.data.id; toast({ title: "Ad created on Meta" }); }
        else toast({ title: "Saved locally (Meta create failed)" });
      }
    }

    const payload = {
      ad_account_id: adAccount.id, adset_id: form.adset_id, name: form.name,
      status: form.status, creative_format: form.creative_format,
      primary_text: form.primary_text, headline: form.headline, description: form.description,
      cta_type: form.cta_type, destination_url: form.destination_url, media_url: form.media_url,
      utm_parameters: JSON.parse(form.utm_parameters || "{}"),
      user_id: user.id, meta_ad_id: metaAdId,
    };
    if (editAd) {
      await supabase.from("meta_ads").update(payload).eq("id", editAd.id);
      toast({ title: "Ad updated" });
    } else {
      await supabase.from("meta_ads").insert(payload);
      toast({ title: "Ad created" });
    }
    setShowCreate(false); setEditAd(null); loadAds();
  };

  const toggleStatus = async (a: any) => {
    const newStatus = a.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    if (!a.meta_ad_id?.startsWith("local_")) {
      const metaAccountId = await getMetaAccountId();
      if (metaAccountId) await metaApi.pushToMeta("update_status", metaAccountId, { object_id: a.meta_ad_id, status: newStatus });
    }
    await supabase.from("meta_ads").update({ status: newStatus }).eq("id", a.id);
    loadAds();
  };

  const duplicate = async (a: any) => {
    if (!user) return;
    const { id, created_at, updated_at, synced_at, meta_ad_id, meta_adsets, ...rest } = a;
    await supabase.from("meta_ads").insert({ ...rest, name: `${a.name} (Copy)`, meta_ad_id: `local_${Date.now()}`, user_id: user.id });
    toast({ title: "Ad duplicated" }); loadAds();
  };

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ads</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
          </Button>
          <Button size="sm" onClick={() => { setEditAd(null); setForm({ name: "", adset_id: "", status: "PAUSED", creative_format: "IMAGE", primary_text: "", headline: "", description: "", cta_type: "LEARN_MORE", destination_url: "", media_url: "", utm_parameters: "{}" }); setShowCreate(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Create Ad
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Ad Set</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>CTA</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ads.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No ads yet</TableCell></TableRow>
              ) : ads.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-xs">{a.meta_adsets?.name || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{a.creative_format}</Badge></TableCell>
                  <TableCell><Badge variant={a.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">{a.status}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={a.meta_ad_id?.startsWith("local_") ? "outline" : "default"} className="text-xs">
                      {a.meta_ad_id?.startsWith("local_") ? "Local" : "Meta"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{a.cta_type}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(a)}>{a.status === "ACTIVE" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditAd(a); setForm({ name: a.name, adset_id: a.adset_id, status: a.status, creative_format: a.creative_format || "IMAGE", primary_text: a.primary_text || "", headline: a.headline || "", description: a.description || "", cta_type: a.cta_type || "LEARN_MORE", destination_url: a.destination_url || "", media_url: a.media_url || "", utm_parameters: JSON.stringify(a.utm_parameters || {}) }); setShowCreate(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicate(a)}><Copy className="w-3.5 h-3.5" /></Button>
                      {a.destination_url && <a href={a.destination_url} target="_blank" rel="noopener"><Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="w-3.5 h-3.5" /></Button></a>}
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
          <DialogHeader><DialogTitle>{editAd ? "Edit Ad" : "Create Ad"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Ad Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Ad Set</Label>
              <Select value={form.adset_id} onValueChange={v => setForm(f => ({ ...f, adset_id: v }))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select ad set" /></SelectTrigger>
                <SelectContent>{adsets.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Creative Format</Label>
                <Select value={form.creative_format} onValueChange={v => setForm(f => ({ ...f, creative_format: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CREATIVE_FORMATS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">CTA</Label>
                <Select value={form.cta_type} onValueChange={v => setForm(f => ({ ...f, cta_type: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CTA_TYPES.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Primary Text</Label><Textarea rows={2} value={form.primary_text} onChange={e => setForm(f => ({ ...f, primary_text: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Headline</Label><Input value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} /></div>
              <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Destination URL</Label><Input value={form.destination_url} onChange={e => setForm(f => ({ ...f, destination_url: e.target.value }))} /></div>
            <div><Label className="text-xs">Media URL</Label><Input value={form.media_url} onChange={e => setForm(f => ({ ...f, media_url: e.target.value }))} /></div>
            <div><Label className="text-xs">UTM Parameters (JSON)</Label><Textarea rows={2} value={form.utm_parameters} onChange={e => setForm(f => ({ ...f, utm_parameters: e.target.value }))} className="font-mono text-xs" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.adset_id || metaApi.loading}>
              {metaApi.loading ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {editAd ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
