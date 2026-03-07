import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { Plus, Zap, Bell, Trash2 } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

const METRICS = ["ctr", "cpc", "cpm", "spend", "impressions", "clicks", "roas", "frequency", "conversions"];
const OPERATORS = ["<", ">", "<=", ">=", "=="];
const ACTIONS = ["alert", "pause_campaign", "pause_adset", "pause_ad", "recommend_duplicate", "recommend_budget_increase"];

export function MetaAutomationTab({ adAccount }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", metric: "ctr", operator: "<", threshold: "", action_type: "alert" });

  useEffect(() => { if (adAccount) { loadRules(); loadAlerts(); } }, [adAccount]);

  const loadRules = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_automation_rules").select("*").eq("ad_account_id", adAccount.id).order("created_at", { ascending: false });
    setRules(data || []);
  };

  const loadAlerts = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_automation_alerts").select("*").eq("ad_account_id", adAccount.id).order("created_at", { ascending: false }).limit(20);
    setAlerts(data || []);
  };

  const handleCreate = async () => {
    if (!adAccount || !user) return;
    await supabase.from("meta_automation_rules").insert({
      ad_account_id: adAccount.id,
      name: form.name,
      description: form.description,
      metric: form.metric,
      operator: form.operator,
      threshold: Number(form.threshold),
      action_type: form.action_type,
      user_id: user.id,
    });
    toast({ title: "Rule created" });
    setShowCreate(false);
    loadRules();
  };

  const toggleRule = async (r: any) => {
    await supabase.from("meta_automation_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    loadRules();
  };

  const deleteRule = async (id: string) => {
    await supabase.from("meta_automation_rules").delete().eq("id", id);
    loadRules();
  };

  const markRead = async (id: string) => {
    await supabase.from("meta_automation_alerts").update({ is_read: true }).eq("id", id);
    loadAlerts();
  };

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-6">
      {/* Rules */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Zap className="w-5 h-5" /> Automation Rules</h2>
        <Button size="sm" onClick={() => { setForm({ name: "", description: "", metric: "ctr", operator: "<", threshold: "", action_type: "alert" }); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Add Rule
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No automation rules</TableCell></TableRow>
              ) : rules.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs font-mono">{r.metric} {r.operator} {r.threshold}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.action_type}</Badge></TableCell>
                  <TableCell><Switch checked={r.is_active} onCheckedChange={() => toggleRule(r)} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteRule(r.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Alerts */}
      <div>
        <h3 className="text-md font-semibold flex items-center gap-2 mb-3"><Bell className="w-4 h-4" /> Recent Alerts</h3>
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No alerts triggered</p>
          ) : alerts.map(a => (
            <Card key={a.id} className={`p-3 ${a.is_read ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Badge variant={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "default" : "secondary"} className="text-xs shrink-0">{a.severity}</Badge>
                  <div>
                    <p className="text-sm">{a.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Value: {a.metric_value} • {new Date(a.created_at).toLocaleString()}</p>
                  </div>
                </div>
                {!a.is_read && <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => markRead(a.id)}>Mark read</Button>}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Rule Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Low CTR Alert" /></div>
            <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Metric</Label>
                <Select value={form.metric} onValueChange={v => setForm(f => ({ ...f, metric: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{METRICS.map(m => <SelectItem key={m} value={m} className="text-xs">{m.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Operator</Label>
                <Select value={form.operator} onValueChange={v => setForm(f => ({ ...f, operator: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERATORS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Threshold</Label><Input type="number" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))} className="h-8 text-xs" /></div>
            </div>
            <div><Label className="text-xs">Action</Label>
              <Select value={form.action_type} onValueChange={v => setForm(f => ({ ...f, action_type: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTIONS.map(a => <SelectItem key={a} value={a} className="text-xs">{a.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.threshold}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
