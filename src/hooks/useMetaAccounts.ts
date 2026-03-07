import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface MetaAccount {
  id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  status: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface AdAccount {
  id: string;
  meta_account_id: string;
  ad_account_id: string;
  ad_account_name: string | null;
  currency: string | null;
  timezone: string | null;
  status: string;
  last_synced_at: string | null;
}

export function useMetaAccounts() {
  const { user } = useAuth();
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [selectedAdAccount, setSelectedAdAccount] = useState<AdAccount | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: ma } = await supabase
        .from("connected_meta_accounts")
        .select("id, meta_user_id, meta_user_name, status, token_expires_at, last_synced_at, created_at")
        .order("created_at", { ascending: false });
      setMetaAccounts((ma as MetaAccount[]) || []);

      const { data: aa } = await supabase
        .from("connected_ad_accounts")
        .select("id, meta_account_id, ad_account_id, ad_account_name, currency, timezone, status, last_synced_at")
        .order("created_at", { ascending: false });
      const accounts = (aa as AdAccount[]) || [];
      setAdAccounts(accounts);
      if (!selectedAdAccount && accounts.length > 0) {
        setSelectedAdAccount(accounts[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [user, selectedAdAccount]);

  useEffect(() => { refresh(); }, [user]);

  return { metaAccounts, adAccounts, selectedAdAccount, setSelectedAdAccount, loading, refresh };
}
