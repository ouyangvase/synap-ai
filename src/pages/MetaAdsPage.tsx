import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { MetaOverviewTab } from "@/components/meta-ads/MetaOverviewTab";
import { MetaCampaignsTab } from "@/components/meta-ads/MetaCampaignsTab";
import { MetaAdSetsTab } from "@/components/meta-ads/MetaAdSetsTab";
import { MetaAdsTab } from "@/components/meta-ads/MetaAdsTab";
import { MetaReportsTab } from "@/components/meta-ads/MetaReportsTab";
import { MetaAutomationTab } from "@/components/meta-ads/MetaAutomationTab";
import { MetaSettingsTab } from "@/components/meta-ads/MetaSettingsTab";
import { MetaLogsTab } from "@/components/meta-ads/MetaLogsTab";
import { MetaAccountSwitcher } from "@/components/meta-ads/MetaAccountSwitcher";
import { useMetaAccounts } from "@/hooks/useMetaAccounts";

export default function MetaAdsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const {
    metaAccounts,
    adAccounts,
    selectedAdAccount,
    setSelectedAdAccount,
    loading,
    refresh,
  } = useMetaAccounts();

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/50 glass-subtle safe-top">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-8 w-8 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">M</div>
          <h1 className="text-lg font-semibold tracking-tight">Meta Ads Hub</h1>
        </div>
        <div className="flex-1" />
        <MetaAccountSwitcher
          adAccounts={adAccounts}
          selected={selectedAdAccount}
          onSelect={setSelectedAdAccount}
        />
        <Button variant="ghost" size="icon" onClick={refresh} className="h-8 w-8 rounded-lg" disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </header>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-2 border-b border-border/30">
          <TabsList className="bg-transparent h-9 p-0 gap-0">
            {["overview","campaigns","adsets","ads","reports","automation","settings","logs"].map(t => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-3 py-1.5 text-xs capitalize"
              >
                {t === "adsets" ? "Ad Sets" : t}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <TabsContent value="overview" className="mt-0"><MetaOverviewTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="campaigns" className="mt-0"><MetaCampaignsTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="adsets" className="mt-0"><MetaAdSetsTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="ads" className="mt-0"><MetaAdsTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="reports" className="mt-0"><MetaReportsTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="automation" className="mt-0"><MetaAutomationTab adAccount={selectedAdAccount} /></TabsContent>
          <TabsContent value="settings" className="mt-0"><MetaSettingsTab metaAccounts={metaAccounts} adAccounts={adAccounts} onRefresh={refresh} /></TabsContent>
          <TabsContent value="logs" className="mt-0"><MetaLogsTab adAccount={selectedAdAccount} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
