import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMetaApi } from "@/hooks/useMetaApi";
import type { MetaAccount, AdAccount } from "@/hooks/useMetaAccounts";
import { Link2, Unlink, Plus, Shield, Clock, AlertTriangle, Download, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  metaAccounts: MetaAccount[];
  adAccounts: AdAccount[];
  onRefresh: () => void;
}

export function MetaSettingsTab({ metaAccounts, adAccounts, onRefresh }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const metaApi = useMetaApi();
  const [showConnect, setShowConnect] = useState(false);
  const [showAddAd, setShowAddAd] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<string | null>(null);
  const [connectForm, setConnectForm] = useState({ meta_user_id: "", meta_user_name: "", access_token: "" });
  const [adForm, setAdForm] = useState({ ad_account_id: "", ad_account_name: "", currency: "USD", timezone: "UTC" });
  const [fetchingAccounts, setFetchingAccounts] = useState(false);
  const [discoveredAccounts, setDiscoveredAccounts] = useState<any[]>([]);
  const [showDiscovered, setShowDiscovered] = useState(false);

  const handleConnect = async () => {
    if (!user) return;
    const { error } = await supabase.from("connected_meta_accounts").insert({
      user_id: user.id,
      meta_user_id: connectForm.meta_user_id,
      meta_user_name: connectForm.meta_user_name,
      access_token_encrypted: connectForm.access_token,
      scopes: ["ads_read", "ads_management"],
      status: "active",
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Meta account connected" });
    setShowConnect(false);
    setConnectForm({ meta_user_id: "", meta_user_name: "", access_token: "" });
    onRefresh();
  };

  const handleFetchAdAccounts = async (metaAccountId: string) => {
    setFetchingAccounts(true);
    setSelectedMeta(metaAccountId);
    const res = await metaApi.call({
      action: "get_ad_accounts",
      meta_account_id: metaAccountId,
      params: {},
    });
    setFetchingAccounts(false);

    if (res.error?.toLowerCase().includes("disconnected")) {
      setReconnectId(metaAccountId);
      setReconnectToken("");
      setShowReconnect(true);
      return;
    }

    if (res.data?.data) {
      setDiscoveredAccounts(res.data.data);
      setShowDiscovered(true);
    }
  };

  const handleLinkDiscovered = async (acc: any) => {
    if (!user || !selectedMeta) return;
    const { error } = await supabase.from("connected_ad_accounts").insert({
      meta_account_id: selectedMeta,
      ad_account_id: acc.id,
      ad_account_name: acc.name || acc.id,
      currency: acc.currency || "USD",
      timezone: acc.timezone_name || "UTC",
      user_id: user.id,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Linked ${acc.name || acc.id}` });
    onRefresh();
  };

  const handleAddAdAccount = async () => {
    if (!user || !selectedMeta) return;
    const { error } = await supabase.from("connected_ad_accounts").insert({
      meta_account_id: selectedMeta,
      ad_account_id: adForm.ad_account_id,
      ad_account_name: adForm.ad_account_name,
      currency: adForm.currency,
      timezone: adForm.timezone,
      user_id: user.id,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Ad account linked" });
    setShowAddAd(false);
    setAdForm({ ad_account_id: "", ad_account_name: "", currency: "USD", timezone: "UTC" });
    onRefresh();
  };

  const handleDisconnect = async (id: string) => {
    await supabase.from("connected_meta_accounts").update({ status: "disconnected" }).eq("id", id);
    toast({ title: "Account disconnected" }); onRefresh();
  };

  const [showReconnect, setShowReconnect] = useState(false);
  const [reconnectId, setReconnectId] = useState<string | null>(null);
  const [reconnectToken, setReconnectToken] = useState("");

  const handleReconnect = (id: string) => {
    setReconnectId(id);
    setReconnectToken("");
    setShowReconnect(true);
  };

  const handleReconnectSubmit = async () => {
    if (!reconnectId) return;
    const updates: any = { status: "active" };
    if (reconnectToken.trim()) {
      updates.access_token_encrypted = reconnectToken.trim();
    }
    await supabase.from("connected_meta_accounts").update(updates).eq("id", reconnectId);
    toast({ title: "Account reconnected" });
    setShowReconnect(false);
    onRefresh();
  };

  const isTokenExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Shield className="w-5 h-5" /> Connection Setup</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Connect Meta Business accounts and link ad accounts.</p>
        </div>
        <Button size="sm" onClick={() => setShowConnect(true)}><Plus className="w-4 h-4 mr-1" /> Connect Account</Button>
      </div>

      {metaAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Link2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">No Meta accounts connected yet.</p>
            <Button size="sm" className="mt-3" onClick={() => setShowConnect(true)}>Connect Meta Account</Button>
          </CardContent>
        </Card>
      ) : metaAccounts.map(ma => (
        <Card key={ma.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">{ma.meta_user_name || ma.meta_user_id}</CardTitle>
                <CardDescription className="text-xs">ID: {ma.meta_user_id}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={ma.status === "active" ? "default" : "secondary"} className="text-xs">{ma.status}</Badge>
                {ma.token_expires_at && (
                  <Badge variant={isTokenExpired(ma.token_expires_at) ? "destructive" : "outline"} className="text-xs">
                    {isTokenExpired(ma.token_expires_at) ? <><AlertTriangle className="w-3 h-3 mr-1" />Expired</> : <><Clock className="w-3 h-3 mr-1" />Expires {formatDistanceToNow(new Date(ma.token_expires_at), { addSuffix: true })}</>}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Last synced: {ma.last_synced_at ? formatDistanceToNow(new Date(ma.last_synced_at), { addSuffix: true }) : "Never"}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium">Linked Ad Accounts</p>
              {adAccounts.filter(a => a.meta_account_id === ma.id).map(aa => (
                <div key={aa.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/30 text-xs">
                  <span>{aa.ad_account_name || aa.ad_account_id}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{aa.currency} • {aa.timezone}</span>
                    <Badge variant={aa.status === "active" ? "default" : "secondary"} className="text-xs">{aa.status}</Badge>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleFetchAdAccounts(ma.id)} disabled={fetchingAccounts}>
                  <Download className={`w-3 h-3 mr-1 ${fetchingAccounts ? "animate-spin" : ""}`} /> Fetch from Meta
                </Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setSelectedMeta(ma.id); setShowAddAd(true); }}>
                  <Plus className="w-3 h-3 mr-1" /> Add Manually
                </Button>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-border/30">
              {ma.status === "active" ? (
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleDisconnect(ma.id)}>
                  <Unlink className="w-3 h-3 mr-1" /> Disconnect
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleReconnect(ma.id)}>
                  <Link2 className="w-3 h-3 mr-1" /> Reconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Connect Dialog */}
      <Dialog open={showConnect} onOpenChange={setShowConnect}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Meta Account</DialogTitle>
            <DialogDescription>Enter your Meta Business user ID and a long-lived access token.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Meta User ID</Label><Input value={connectForm.meta_user_id} onChange={e => setConnectForm(f => ({ ...f, meta_user_id: e.target.value }))} placeholder="123456789" /></div>
            <div><Label className="text-xs">Display Name</Label><Input value={connectForm.meta_user_name} onChange={e => setConnectForm(f => ({ ...f, meta_user_name: e.target.value }))} placeholder="My Business" /></div>
            <div><Label className="text-xs">Access Token</Label><Input type="password" value={connectForm.access_token} onChange={e => setConnectForm(f => ({ ...f, access_token: e.target.value }))} placeholder="EAABs..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConnect(false)}>Cancel</Button>
            <Button onClick={handleConnect} disabled={!connectForm.meta_user_id || !connectForm.access_token}>Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discovered Ad Accounts Dialog */}
      <Dialog open={showDiscovered} onOpenChange={setShowDiscovered}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discovered Ad Accounts</DialogTitle>
            <DialogDescription>Click to link an ad account to your workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {discoveredAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No ad accounts found.</p>
            ) : discoveredAccounts.map(acc => {
              const alreadyLinked = adAccounts.some(a => a.ad_account_id === acc.id);
              return (
                <div key={acc.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 text-xs">
                  <div>
                    <p className="font-medium">{acc.name || acc.id}</p>
                    <p className="text-muted-foreground">{acc.id} • {acc.currency} • {acc.timezone_name}</p>
                  </div>
                  {alreadyLinked ? (
                    <Badge variant="secondary" className="text-xs">Linked</Badge>
                  ) : (
                    <Button size="sm" className="text-xs h-7" onClick={() => handleLinkDiscovered(acc)}>Link</Button>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDiscovered(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Ad Account Manually Dialog */}
      <Dialog open={showAddAd} onOpenChange={setShowAddAd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link Ad Account</DialogTitle>
            <DialogDescription>Enter the Meta ad account ID (e.g. act_123456789).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Ad Account ID</Label><Input value={adForm.ad_account_id} onChange={e => setAdForm(f => ({ ...f, ad_account_id: e.target.value }))} placeholder="act_123456789" /></div>
            <div><Label className="text-xs">Account Name</Label><Input value={adForm.ad_account_name} onChange={e => setAdForm(f => ({ ...f, ad_account_name: e.target.value }))} placeholder="My Ad Account" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Currency</Label><Input value={adForm.currency} onChange={e => setAdForm(f => ({ ...f, currency: e.target.value }))} /></div>
              <div><Label className="text-xs">Timezone</Label><Input value={adForm.timezone} onChange={e => setAdForm(f => ({ ...f, timezone: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAd(false)}>Cancel</Button>
            <Button onClick={handleAddAdAccount} disabled={!adForm.ad_account_id}>Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Reconnect Dialog */}
      <Dialog open={showReconnect} onOpenChange={setShowReconnect}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reconnect Account</DialogTitle>
            <DialogDescription>Optionally update the access token. Leave blank to keep existing token.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">New Access Token (optional)</Label><Input type="password" value={reconnectToken} onChange={e => setReconnectToken(e.target.value)} placeholder="EAABs... (leave blank to keep current)" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReconnect(false)}>Cancel</Button>
            <Button onClick={handleReconnectSubmit}>Reconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
