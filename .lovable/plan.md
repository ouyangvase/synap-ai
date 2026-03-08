

## Plan: Harden Agent Reliability — Fallback-First + Service Visibility

### Root Causes of the Failures in Screenshot

1. **`echo` tool endpoint → `localhost:5678`**: Points to local n8n which doesn't exist in production. Every echo call fails with "Connection refused".
2. **`fetch_json` tool endpoint → `localhost:5678`**: Same problem.
3. **`browser_do` fails 503**: When Browserless is down, agent says "I'm completely blocked" instead of using alternative tools.
4. **No `search_web` tool linked to agent**: The `search-web` edge function exists but is NOT registered as a tool the agent can use.
5. **System prompt lacks fallback instructions**: Agent doesn't know it should try web search when browser fails.
6. **No health visibility**: User has no idea which services are up or down.

### Fixes

**1. Register `search_web` tool + fix broken endpoints (DB)**

- Insert `search_web` tool into `tools` table
- Insert `tool_endpoints` for search_web → `{SUPABASE_URL}/functions/v1/search-web`
- Link to MuleRun Agent via `agent_tools`
- Update `echo` endpoint from `localhost:5678` to `{SUPABASE_URL}/functions/v1/chat` (or disable it)
- Update `fetch_json` endpoint similarly or deactivate the tool

**2. Update system prompt with fallback strategy**

Update the MuleRun Agent's `system_prompt` in DB to include:

```text
## FALLBACK STRATEGY (CRITICAL)
- If browser_do returns 503/unavailable: DO NOT give up. Use search_web to find the answer instead.
- If a tool fails 3 times: switch to an alternative tool or explain what you need from the user.
- NEVER say "I am blocked" or "I cannot do anything". Always offer an alternative path.
- Available fallback chain: browser_do → search_web → explain how user can do it manually.
```

**3. Harden `executeToolRun` in chat/index.ts**

When a tool returns 503, inject a richer error message into the tool result that tells the LLM about available fallback tools:

```typescript
// In the error message back to LLM:
if (resp.status === 503) {
  failureMsg += "\n\nFALLBACK: This service is temporarily down. Use search_web tool instead to find the information, or try a different approach.";
}
```

**4. Create simple internal echo function**

Create `supabase/functions/echo/index.ts` — a simple echo endpoint so the echo tool works without n8n. Update the endpoint URL.

**5. Add service health badges to ChatPane UI**

Add a small status bar in ChatPane showing colored dots for key services:
- Browser (check `/browser-proxy/health`)
- AI (always on via Lovable gateway)
- Tools (check if tool_endpoints resolve)

Shown as compact icons in the chat header area.

### Files to Create/Modify

| File | Change |
|------|--------|
| `supabase/functions/echo/index.ts` | **Create** — simple echo endpoint |
| `supabase/functions/chat/index.ts` | Add fallback hints in 503 error messages |
| `src/components/chat/ChatPane.tsx` | Add service health indicator badges |
| DB: `tools` | Insert `search_web` tool |
| DB: `tool_endpoints` | Insert search_web endpoint, update echo/fetch_json endpoints |
| DB: `agent_tools` | Link search_web to MuleRun Agent |
| DB: `agents` | Update system_prompt with fallback instructions |
| `supabase/config.toml` | Add `[functions.echo]` |

