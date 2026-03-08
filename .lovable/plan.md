

## Root Cause

The `search-web` edge function uses a **`GEMINI_API_KEY`** that is not configured as a secret. This means the entire fallback chain is broken:

```text
browser_do → 503 (Browserless quota exhausted)
search_web → 503 (GEMINI_API_KEY missing)
Agent → "I am completely blocked"
```

The project already has `LOVABLE_API_KEY` configured, which provides access to Gemini and other models through the Lovable AI Gateway.

## Fix

**1. Rewrite `supabase/functions/search-web/index.ts`** to use the Lovable AI Gateway (`LOVABLE_API_KEY`) instead of a direct `GEMINI_API_KEY`. This uses `google/gemini-2.5-flash` via the gateway with Google Search grounding, matching existing patterns in the `chat` function.

**2. Harden `ServiceHealthBar.tsx`** to silently catch any fetch errors (including CORS or network issues) so the health bar never triggers error toasts or popups.

**3. Add error boundary protection in `ChatPane.tsx`** — wrap the stream response error handler to never throw unhandled exceptions that crash the app.

### Files to modify
| File | Change |
|------|--------|
| `supabase/functions/search-web/index.ts` | Replace GEMINI_API_KEY with Lovable AI Gateway |
| `src/components/chat/ServiceHealthBar.tsx` | Add outer try/catch to prevent any unhandled errors |
| `src/components/chat/ChatPane.tsx` | Ensure stream errors never cause app crash |

