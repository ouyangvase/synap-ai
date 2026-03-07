import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import type { AdAccount } from "@/hooks/useMetaAccounts";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props { adAccount: AdAccount | null; }

export function MetaLogsTab({ adAccount }: Props) {
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [logTab, setLogTab] = useState("errors");

  useEffect(() => { if (adAccount) { loadErrorLogs(); loadSyncLogs(); } }, [adAccount]);

  const loadErrorLogs = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_api_error_logs").select("*").eq("ad_account_id", adAccount.id).order("created_at", { ascending: false }).limit(50);
    setErrorLogs(data || []);
  };

  const loadSyncLogs = async () => {
    if (!adAccount) return;
    const { data } = await supabase.from("meta_sync_logs").select("*").eq("ad_account_id", adAccount.id).order("created_at", { ascending: false }).limit(50);
    setSyncLogs(data || []);
  };

  if (!adAccount) return <p className="text-center text-muted-foreground py-10 text-sm">Select an ad account first.</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Logs</h2>

      <Tabs value={logTab} onValueChange={setLogTab}>
        <TabsList className="h-8">
          <TabsTrigger value="errors" className="text-xs gap-1"><AlertCircle className="w-3 h-3" />API Errors</TabsTrigger>
          <TabsTrigger value="sync" className="text-xs gap-1"><RefreshCw className="w-3 h-3" />Sync Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="errors">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errorLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No errors logged</TableCell></TableRow>
                  ) : errorLogs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-xs font-mono max-w-[200px] truncate">{l.endpoint}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{l.method}</Badge></TableCell>
                      <TableCell><Badge variant="destructive" className="text-xs">{l.status_code}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate">{l.error_message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No sync logs</TableCell></TableRow>
                  ) : syncLogs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{l.sync_type}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={l.status === "completed" ? "default" : l.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                          {l.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{l.records_synced}</TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate">{l.error_message || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
