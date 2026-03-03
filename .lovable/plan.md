
Goal: fix the persistent `401 Unauthorized — invalid token` loop and make browser tasks (including your `tomy.my` login + order assignment flow) complete reliably.

1) Root-cause findings (from code + DB)
- `chat` edge function executes tools directly (`executeToolRun`) and still sends **service-role bearer** to internal browser calls.
- `browser-proxy` validates user identity with `auth.getUser()` for authenticated routes, so service-role bearer becomes `Unauthorized — invalid token`.
- `browser_do` endpoint in DB is misconfigured to:
  - `{SUPABASE_URL}/functions/v1/browser-proxy`
  - but chat payload format (`{meta,input}`) is designed for:
  - `{SUPABASE_URL}/functions/v1/browser-proxy/agent-action`
- `browser_do` input schema in DB is too narrow (action/selector/value only), so model emits malformed steps (e.g. `WAIT_FOR_ELEMENT`) and retries poorly.

2) Implementation plan
- Update `supabase/functions/chat/index.ts`:
  - Forward original user JWT for internal authenticated endpoints.
  - For service-to-service endpoint `/agent-action`, use endpoint header config only (no user auth required).
  - Add explicit auth-failure classification: if tool error contains 401/invalid token, stop retries and emit actionable message.
- Database migration:
  - Fix `browser_do` `tool_endpoints.endpoint_url` to `/functions/v1/browser-proxy/agent-action`.
  - Expand `browser_do.input_schema` to supported actions (`login`, `click_by_text`, `fill_by_*`, `wait_for_text`, `wait_for_url`, `press`, `get_html`, `screenshot`, etc.).
  - Increase guardrails in tool description to enforce small phased calls and supported step names only.
- Prompt hardening (agent system prompt):
  - Add strict “allowed browser_do actions” section.
  - Add deterministic strategy for your task type:
    - login → open Ready Sales → search `YX184` → open order row → assign runner `YC` → verification screenshot/extract text.
  - Require evidence-based completion (“done” only if UI confirmation or status text appears).

3) Reliability upgrades
- In chat tool loop:
  - Do not append misleading “split steps” advice for auth failures.
  - Retry only transient errors (5xx/timeout), not 401/400 schema errors.
- In browser result handling:
  - Return structured failure reason (`auth_error`, `schema_error`, `site_error`, `selector_error`) to improve self-correction.

4) Validation plan (end-to-end)
- Test from the same conversation:
  1. Run a minimal `browser_do` screenshot call (should no longer 401).
  2. Run login-only flow to `www.tomy.my` (proof screenshot).
  3. Run navigation/search flow for order `YX184`.
  4. Run assignment action to runner `YC`.
  5. Confirm completion by extracting visible confirmation text + final screenshot URL.
- Success criteria:
  - zero 401 invalid-token errors,
  - tool status `completed`,
  - final output includes visual/text proof of assignment.

5) Technical details (for implementation)
```text
Current failing path:
chat.executeToolRun -> fetch(browser-proxy root) + service-role bearer
-> browser-proxy authenticated branch -> auth.getUser() fails -> 401 invalid token

Target path:
chat.executeToolRun -> fetch(browser-proxy/agent-action) + {meta,input}
-> agent-action branch (service-to-service flow)
-> browser_do executes supported step schema
-> verified completion artifacts returned
```
