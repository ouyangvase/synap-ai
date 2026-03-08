

## Plan: Fix Meta Ads Hub — Make It Actually Work

### Root Causes Found

1. **Auth broken in `meta-api` edge function**: Uses `userClient.auth.getClaims(token)` which does NOT exist in `@supabase/supabase-js@2.49.1`. Every call returns "Unauthorized" silently. Must use `getUser()` instead.

2. **Connected account status is "disconnected"**: The test account in the DB has `status: "disconnected"`, so even with fixed auth, the edge function rejects with "Meta account is disconnected". The Settings tab reconnect button only flips status — it doesn't validate.

3. **No user feedback on failures**: Sync/Create buttons fail silently because the `meta-api` returns 401 and the toast shows a generic error.

### Fixes

**1. Fix `supabase/functions/meta-api/index.ts`** — Replace `getClaims()` with `getUser()`:
```typescript
const { data: { user }, error: authErr } = await userClient.auth.getUser();
if (authErr || !user) return jsonResp({ error: "Unauthorized" }, 401);
const userId = user.id;
```

**2. Fix `supabase/functions/meta-sync/index.ts`** — Add auth validation (currently has none — it runs with service role but should accept user JWT for manual triggers).

**3. Fix `supabase/functions/meta-automation-eval/index.ts`** — Same: add basic auth header validation.

**4. Update `MetaSettingsTab.tsx`** — When connecting, set `status: "active"` explicitly. The current code already does this via default, but the "Reconnect" button should also prompt for a new token if the old one expired.

**5. Improve error handling in `useMetaApi.ts`** — Surface the actual error message from the edge function response body (currently swallowed).

### Files to Edit

| File | Change |
|------|--------|
| `supabase/functions/meta-api/index.ts` | Replace `getClaims()` → `getUser()` |
| `supabase/functions/meta-sync/index.ts` | Add user auth validation for manual triggers |
| `supabase/functions/meta-automation-eval/index.ts` | Add auth validation |
| `src/components/meta-ads/MetaSettingsTab.tsx` | Add token update on reconnect, better validation |
| `src/hooks/useMetaApi.ts` | Better error surfacing from edge function responses |

