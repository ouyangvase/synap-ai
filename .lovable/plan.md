

## Plan: Delete with Double Confirm, Real Facebook Setup, Chat-to-Campaign

### 1. Delete Account with Double Confirmation

**File: `src/components/meta-ads/MetaSettingsTab.tsx`**

- Add a "Delete" button (red, destructive) next to Disconnect/Reconnect for each Meta account
- First click opens a confirmation dialog: "Are you sure you want to permanently delete this account and all linked ad accounts?"
- Second confirm button in dialog requires typing the account name to confirm (similar to GitHub repo delete pattern)
- On confirm: DELETE from `connected_ad_accounts` where `meta_account_id`, then DELETE from `connected_meta_accounts` by id
- Also add delete button for individual linked ad accounts with a simpler confirm dialog

### 2. Real Facebook Connection Setup

Currently the Connect dialog asks for manual User ID + Token. This needs a proper guided flow:

- Replace the raw token input with a step-by-step guide inside the Connect dialog:
  1. Link to Facebook's Graph API Explorer or Business Settings to generate a token
  2. After pasting the token, **validate it immediately** by calling `meta-api` with `get_ad_accounts` action
  3. Auto-populate the User ID and Display Name from the validated token response (`/me?fields=id,name`)
- Add a new `validate_token` action to the `meta-api` edge function that calls `GET /me?fields=id,name` to verify the token and return user info
- On successful validation: save the account as "active" and auto-fetch ad accounts
- On failure: show clear error (expired token, invalid permissions, etc.)

**File: `supabase/functions/meta-api/index.ts`**
- Add `validate_token` action (accepts raw token in params since account doesn't exist yet) — calls `/me?fields=id,name` and returns user info
- This is the ONLY action that accepts a raw token; all others use stored tokens

### 3. Chat Can Create Campaigns via Meta API

Register a new tool `meta_ads_manage` so the chat agent can interact with Meta Ads:

**New edge function: `supabase/functions/meta-ads-tool/index.ts`**
- Accepts actions: `list_accounts`, `list_campaigns`, `create_campaign`, `update_campaign`, `sync_all`
- Uses the same server-side token retrieval pattern as `meta-api`
- Returns structured results the LLM can understand

**Database: Insert tool + endpoint + link to agent**
- Insert into `tools` table: name=`meta_ads_manage`, description explaining what it can do
- Insert into `tool_endpoints`: pointing to the new edge function
- Insert into `agent_tools`: linking the tool to MuleRun Agent

### Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/meta-ads/MetaSettingsTab.tsx` | Add delete with double confirm, improve connect flow with token validation |
| `supabase/functions/meta-api/index.ts` | Add `validate_token` action |
| `supabase/functions/meta-ads-tool/index.ts` | **Create** — Tool endpoint for chat agent to manage Meta Ads |
| DB migration | Insert `meta_ads_manage` tool, endpoint, and agent_tools link |

### Technical Details

**Delete flow:**
```text
User clicks Delete → Dialog opens "Type account name to confirm"
→ User types name → "Permanently Delete" button enables
→ DELETE connected_ad_accounts WHERE meta_account_id = X
→ DELETE connected_meta_accounts WHERE id = X
→ Refresh
```

**Token validation flow:**
```text
User pastes token → Frontend calls meta-api validate_token (raw token)
→ Edge function calls GET /me?fields=id,name with that token
→ Returns { id: "123", name: "My Business" }
→ Frontend auto-fills User ID + Name, saves to DB, fetches ad accounts
```

**Chat tool schema:**
```json
{
  "name": "meta_ads_manage",
  "description": "Manage Meta (Facebook/Instagram) ad campaigns. Actions: list_accounts, list_campaigns, create_campaign, update_campaign, pause_campaign, sync_all.",
  "input_schema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["list_accounts", "list_campaigns", "create_campaign", "update_campaign", "pause_campaign", "sync_all"] },
      "params": { "type": "object" }
    },
    "required": ["action"]
  }
}
```

