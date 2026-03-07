import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { BarChart3 } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

type DatePreset = "today" | "yesterday" | "last_7d" | "last_30d" | "this_month" | "custom";

function getDateRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case "today": return { start: fmt(now), end: fmt(now) };
    case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); return { start: fmt(y), end: fmt(y) }; }
    case "last_7d": { const d = new Date(now); d.setDate(d.getDate() - 7); return { start: fmt(d), end: fmt(now) }; }
    case "last_30d": { const d = new Date(now); d.setDate(d.getDate() - 30); return { start: fmt(d), end: fmt(now) }; }
    case "this_month": { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { start: fmt(d), end: fmt(now) }; }
    default: return { start: fmt(now), end: fmt(now) };
  }
}

const spendConfig = { spend: { label: "Spend", color: "hsl(var(--primary))" } };
const impressionsConfig = { impressions: { label: "Impressions", color: "hsl(var(--accent))" } };
const ctrConfig = { ctr: { label: "CTR %", color: "hsl(142 76% 36%)" } };

export function MetaReportsTab({ adAccount }: Props) {
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [insights, setInsights] = useState<any[]>([]);
  const [groupBy, setGroupBy] = useState<"campaign" | "adset" | "ad">("campaign");

  useEffect(() => { if (adAccount) loadInsights(); }, [adAccount, datePreset, customStart, customEnd, groupBy]);

  const loadInsights = async () => {
    if (!adAccount) return;
    const range = datePreset === "custom" ? { start: customStart, end: customEnd } : getDateRange(datePreset);
    if (!range.start || !range.end) return;

    const { data } = await supabase
      .from("ad_insights_daily")
      .select("*")
      .eq("ad_account_id", adAccount.id)
      .gte("date_start", range.start)
      .lte("date_stop", range.end)
      .order("date_start", { ascending: true });
    setInsights(data || []);
  };

  const chartData = useMemo(() =>
    insights.map(r => ({
      date: r.date_start,
      spend: Number(r.spend || 0),
      impressions: Number(r.impressions || 0),
      ctr: Number(r.ctr || 0),
      clicks: Number(r.clicks || 0),
    })),
  [insights]);

  const totals = insights.reduce((acc, r) => ({
    impressions: acc.impressions + Number(r.impressions || 0),
    reach: acc.reach + Number(r.reach || 0),
    clicks: acc.clicks + Number(r.clicks || 0),
    spend: acc.spend + Number(r.spend || 0),
    conversions: acc.conversions + Number(r.conversions || 0),
    leads: acc.leads + Number(r.leads || 0),
  }), { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0, leads: 0 });

  const ctr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0.00";
  const cpc = totals.clicks > 0 ? (totals.spend / totals.clicks).toFixed(2) : "0.00";
  const cpm = totals.impressions > 0 ? ((totals.spend / totals.impressions) * 1000).toFixed(2) : "0.00";

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Date Range</Label>
              <Select value={datePreset} onValueChange={v => setDatePreset(v as DatePreset)}>
                <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today" className="text-xs">Today</SelectItem>
                  <SelectItem value="yesterday" className="text-xs">Yesterday</SelectItem>
                  <SelectItem value="last_7d" className="text-xs">Last 7 Days</SelectItem>
                  <SelectItem value="last_30d" className="text-xs">Last 30 Days</SelectItem>
                  <SelectItem value="this_month" className="text-xs">This Month</SelectItem>
                  <SelectItem value="custom" className="text-xs">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {datePreset === "custom" && (
              <>
                <div><Label className="text-xs">Start</Label><Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-xs w-[140px]" /></div>
                <div><Label className="text-xs">End</Label><Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-xs w-[140px]" /></div>
              </>
            )}
            <Button size="sm" variant="outline" onClick={loadInsights} className="h-8"><BarChart3 className="w-3.5 h-3.5 mr-1" />Refresh</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Impressions", val: totals.impressions.toLocaleString() },
          { label: "Reach", val: totals.reach.toLocaleString() },
          { label: "Clicks", val: totals.clicks.toLocaleString() },
          { label: "CTR", val: `${ctr}%` },
          { label: "CPC", val: `$${cpc}` },
          { label: "CPM", val: `$${cpm}` },
          { label: "Spend", val: `$${totals.spend.toFixed(2)}` },
        ].map(m => (
          <Card key={m.label} className="p-0">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-bold">{m.val}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Spend Area Chart */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Spend Trend</CardTitle></CardHeader>
            <CardContent className="p-2">
              <ChartContainer config={spendConfig} className="h-[200px] w-full">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="spend" fill="var(--color-spend)" fillOpacity={0.2} stroke="var(--color-spend)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Impressions Bar Chart */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Impressions</CardTitle></CardHeader>
            <CardContent className="p-2">
              <ChartContainer config={impressionsConfig} className="h-[200px] w-full">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="impressions" fill="var(--color-impressions)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* CTR Line Chart */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">CTR %</CardTitle></CardHeader>
            <CardContent className="p-2">
              <ChartContainer config={ctrConfig} className="h-[200px] w-full">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="ctr" stroke="var(--color-ctr)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>Reach</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>CPC</TableHead>
                <TableHead>CPM</TableHead>
                <TableHead>Spend</TableHead>
                <TableHead>Conversions</TableHead>
                <TableHead>Frequency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insights.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No insight data available</TableCell></TableRow>
              ) : insights.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.date_start}</TableCell>
                  <TableCell>{Number(r.impressions).toLocaleString()}</TableCell>
                  <TableCell>{Number(r.reach).toLocaleString()}</TableCell>
                  <TableCell>{Number(r.clicks).toLocaleString()}</TableCell>
                  <TableCell>{Number(r.ctr).toFixed(2)}%</TableCell>
                  <TableCell>${Number(r.cpc).toFixed(2)}</TableCell>
                  <TableCell>${Number(r.cpm).toFixed(2)}</TableCell>
                  <TableCell>${Number(r.spend).toFixed(2)}</TableCell>
                  <TableCell>{Number(r.conversions)}</TableCell>
                  <TableCell>{Number(r.frequency).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}