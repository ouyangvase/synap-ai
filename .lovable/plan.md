

## Problem Analysis

After reviewing the conversation history, logs, and code, there are **three root issues**:

### 1. Screenshots appear "half image" — Viewport is 800x600
The `fullPage: true` fix was applied but that only captures the full scroll height. The real issue is **Browserless defaults to an 800x600 pixel viewport**, making websites render in a narrow cramped view that looks like "half an image." The fix is to set the viewport to 1280x800 at the start of the composite script.

### 2. Browser service returns 401 on health check — Agent can't execute
The edge function logs show `[browser_do] Health check failed: 401`. The health check calls `/json/version?token=XXX` but Browserless may require the token as a header instead. This causes the agent to get a 503 error and give up immediately.

### 3. Agent stops after errors instead of self-correcting
The LLM model is `google/gemini-2.5-flash` which is optimized for speed, not complex multi-step reasoning. Combined with the 503 errors, the agent never gets a chance to actually execute. When it does work, it needs a stronger model for autonomous task completion.

## Plan

### A. Set viewport to 1280x800 in composite script
In `supabase/functions/browser-proxy/index.ts`, add `page.setViewport({ width: 1280, height: 800 })` at the start of the `buildCompositeScript` function (right after `export default async function ({ page })`). This makes screenshots show the full desktop-width page.

### B. Fix health check 401 error
Update the health check in the `/agent-action` handler to use the correct Browserless endpoint. Instead of `/json/version?token=XXX`, try `/pressure?token=XXX` (Browserless v2 health endpoint). Add a fallback so if one fails, it tries the other. Also pass the token as a header if the query param approach fails.

### C. Upgrade agent model for better reasoning
Update the `agents` table to use `google/gemini-2.5-pro` instead of `google/gemini-2.5-flash`. The Pro model is significantly better at multi-step reasoning, tool calling, and autonomous task completion — exactly what's needed for the browser automation workflow.

### D. Fix tool_id lookup for session continuity
The `currentUrl` resolution in `/agent-action` uses hardcoded UUIDs (`00000000-0000-0000-0001-*`) that don't match the actual `browser_do` tool ID (`00000000-0000-0000-0000-000000000020`). Fix this to include the correct ID so the agent can resume from the last URL.

### Technical Details

**Viewport fix** (browser-proxy/index.ts line ~2976):
```javascript
export default async function ({ page }) {
  await page.setViewport({ width: 1280, height: 800 });
  // ... rest of script
```

**Health check fix** (browser-proxy/index.ts lines ~780-807):
Replace `/json/version` with `/pressure` and add token-as-header fallback.

**Model upgrade** (database):
```sql
UPDATE agents SET model = 'google/gemini-2.5-pro' WHERE is_active = true;
```

**Tool ID fix** (browser-proxy/index.ts line ~741):
Add `"00000000-0000-0000-0000-000000000020"` to the `tool_id` filter list.

