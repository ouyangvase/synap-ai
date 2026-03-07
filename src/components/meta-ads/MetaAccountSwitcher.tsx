import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdAccount } from "@/hooks/useMetaAccounts";

interface Props {
  adAccounts: AdAccount[];
  selected: AdAccount | null;
  onSelect: (a: AdAccount) => void;
}

export function MetaAccountSwitcher({ adAccounts, selected, onSelect }: Props) {
  if (adAccounts.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2">No ad accounts connected</div>
    );
  }

  return (
    <Select
      value={selected?.id || ""}
      onValueChange={(val) => {
        const acc = adAccounts.find(a => a.id === val);
        if (acc) onSelect(acc);
      }}
    >
      <SelectTrigger className="w-[220px] h-8 text-xs rounded-lg">
        <SelectValue placeholder="Select ad account" />
      </SelectTrigger>
      <SelectContent>
        {adAccounts.map(a => (
          <SelectItem key={a.id} value={a.id} className="text-xs">
            {a.ad_account_name || a.ad_account_id} ({a.currency})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
