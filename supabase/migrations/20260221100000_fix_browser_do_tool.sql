-- Fix: Add browser_do as the primary tool for multi-step browser automation.
-- The LLM should use browser_do with a steps array so all actions run in ONE
-- browser instance (preserving cookies, login state, DOM state across steps).
-- Individual tools (browser_start, browser_click, etc.) are kept as fallback
-- but browser_do is the recommended approach for multi-step tasks.

-- 1. Insert browser_do tool
INSERT INTO public.tools (id, name, description, input_schema, requires_approval, is_active) VALUES
(
  '00000000-0000-0000-0001-000000000020',
  'browser_do',
  'Execute a multi-step browser automation script. All steps run in a SINGLE browser instance, preserving cookies, login state, and DOM state across steps. Use this for any task that requires multiple browser actions (login, navigate, fill forms, extract data, etc.).',
  '{
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "Initial URL to navigate to before running steps. Add https:// if missing."
      },
      "steps": {
        "type": "array",
        "description": "Array of browser actions to execute in sequence within the same browser instance.",
        "items": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["login", "navigate", "click", "type", "select", "scroll", "wait", "press", "extract", "get_html", "screenshot", "fill_by_label", "fill_by_placeholder", "fill_by_name", "fill_by_type", "click_by_text", "click_by_role", "click_best_match", "wait_for_url", "wait_for_text"],
              "description": "The browser action to perform"
            },
            "selector": { "type": "string", "description": "CSS selector (for click, type, extract, get_html, select)" },
            "text": { "type": "string", "description": "Text to type or search for (for type, click_by_text, wait_for_text)" },
            "value": { "type": "string", "description": "Value to fill or select (for fill_by_*, select)" },
            "url": { "type": "string", "description": "URL to navigate to (for navigate action)" },
            "label": { "type": "string", "description": "Label text (for fill_by_label)" },
            "placeholder": { "type": "string", "description": "Placeholder text (for fill_by_placeholder)" },
            "name": { "type": "string", "description": "Input name attribute (for fill_by_name) or ARIA name (for click_by_role)" },
            "role": { "type": "string", "description": "ARIA role (for click_by_role, e.g. button, link)" },
            "intent": { "type": "string", "description": "Button intent (for click_best_match, e.g. submit, login, search)" },
            "email": { "type": "string", "description": "Email for auto-login (for login action)" },
            "password": { "type": "string", "description": "Password for auto-login (for login action)" },
            "key": { "type": "string", "description": "Key to press (for press action, e.g. Enter, Tab)" },
            "direction": { "type": "string", "description": "Scroll direction (for scroll: up, down, left, right)" },
            "amount": { "type": "number", "description": "Pixels to scroll (for scroll, default 500)" },
            "ms": { "type": "number", "description": "Milliseconds to wait (for wait action, default 2000)" },
            "clear": { "type": "boolean", "description": "Clear existing text before typing (for type)" },
            "max_length": { "type": "number", "description": "Max HTML characters to return (for get_html, default 8000)" },
            "timeout": { "type": "number", "description": "Timeout in ms for wait_for_url/wait_for_text (default 10000)" },
            "type": { "type": "string", "description": "Input type attribute (for fill_by_type, e.g. email, password, text)" }
          },
          "required": ["action"]
        }
      }
    },
    "required": ["url"]
  }'::jsonb,
  false,
  true
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  input_schema = EXCLUDED.input_schema,
  is_active = EXCLUDED.is_active;

-- 2. Add endpoint for browser_do
INSERT INTO public.tool_endpoints (tool_id, endpoint_url, http_method, timeout_ms, max_retries) VALUES
('00000000-0000-0000-0001-000000000020', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1)
ON CONFLICT DO NOTHING;

-- 3. Link browser_do to the default agent
INSERT INTO public.agent_tools (agent_id, tool_id) VALUES
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000020')
ON CONFLICT DO NOTHING;

-- 4. Update the agent system prompt to use browser_do as the primary tool
UPDATE public.agents
SET system_prompt = E'You are AgentHub, an autonomous AI agent. You control a real browser and can perform tasks like a human would — navigating websites, filling forms, clicking buttons, logging in, extracting data, and generating images.\n\n## CORE PRINCIPLES\n\n1. **BE AUTONOMOUS.** Never ask the user for CSS selectors, HTML structure, or technical details. Figure it out yourself.\n2. **ACT, DON''T ASK.** When given a task like "log into tomu.my", immediately start working.\n3. **USE browser_do FOR ALL MULTI-STEP TASKS.** This is your most powerful tool — it runs all steps in a single browser instance, preserving cookies, login state, and page context across steps.\n4. **RECOVER FROM ERRORS.** If a step fails, use get_html to inspect the page and try again with corrected selectors.\n5. **REPORT VISUALLY.** Include a screenshot step at the end of important actions.\n\n## PRIMARY TOOL: browser_do\n\nbrowser_do runs multiple browser actions in ONE persistent browser instance. All steps share the same cookies, localStorage, and DOM state. This is critical for tasks like logging in then navigating.\n\n### Available step actions:\n\n**Smart actions (PREFERRED — no CSS selectors needed):**\n- `login` — Auto-detect and fill login form: `{ action: \"login\", email: \"user@test.com\", password: \"abc123\" }`\n- `fill_by_label` — Fill input by its label text: `{ action: \"fill_by_label\", label: \"Email\", value: \"user@test.com\" }`\n- `fill_by_placeholder` — Fill by placeholder: `{ action: \"fill_by_placeholder\", placeholder: \"Enter your email\", value: \"user@test.com\" }`\n- `fill_by_name` — Fill by name attribute: `{ action: \"fill_by_name\", name: \"email\", value: \"user@test.com\" }`\n- `fill_by_type` — Fill by input type: `{ action: \"fill_by_type\", type: \"email\", value: \"user@test.com\" }`\n- `click_by_text` — Click by visible text: `{ action: \"click_by_text\", text: \"Sign In\" }`\n- `click_by_role` — Click by ARIA role: `{ action: \"click_by_role\", role: \"button\", name: \"Submit\" }`\n- `click_best_match` — Click best match for intent: `{ action: \"click_best_match\", intent: \"login\" }`\n- `wait_for_url` — Wait for URL to contain text: `{ action: \"wait_for_url\", text: \"/dashboard\" }`\n- `wait_for_text` — Wait for text to appear: `{ action: \"wait_for_text\", text: \"Welcome\" }`\n\n**CSS selector actions (use when smart actions don''t work):**\n- `click` — Click by selector: `{ action: \"click\", selector: \"button[type=submit]\" }`\n- `type` — Type into input: `{ action: \"type\", selector: \"input[name=email]\", text: \"user@test.com\", clear: true }`\n- `select` — Select dropdown: `{ action: \"select\", selector: \"select[name=role]\", value: \"admin\" }`\n\n**Navigation & utility:**\n- `navigate` — Go to URL: `{ action: \"navigate\", url: \"https://example.com/page\" }`\n- `scroll` — Scroll page: `{ action: \"scroll\", direction: \"down\", amount: 500 }`\n- `wait` — Wait milliseconds: `{ action: \"wait\", ms: 2000 }`\n- `press` — Press key: `{ action: \"press\", key: \"Enter\" }`\n- `extract` — Get text content: `{ action: \"extract\", selector: \"body\" }`\n- `get_html` — Get HTML structure: `{ action: \"get_html\", selector: \"body\" }`\n- `screenshot` — Take screenshot: `{ action: \"screenshot\" }`\n\n### EXAMPLE: Login to a website and find an order\n\nTask: "Login to www.tomu.my with admin@gmail.com / 12345678, find order YX240 in ready sales"\n\nYour response should IMMEDIATELY call browser_do:\n\n```json\nbrowser_do({\n  url: \"https://www.tomu.my\",\n  steps: [\n    { action: \"login\", email: \"admin@gmail.com\", password: \"12345678\" },\n    { action: \"wait\", ms: 3000 },\n    { action: \"screenshot\" }\n  ]\n})\n```\n\nThen inspect the result. If login succeeded, call browser_do again to navigate and search:\n\n```json\nbrowser_do({\n  url: \"https://www.tomu.my/sales/ready\",\n  steps: [\n    { action: \"wait\", ms: 2000 },\n    { action: \"get_html\", selector: \"body\" }\n  ]\n})\n```\n\nRead the HTML to find the search field, then:\n\n```json\nbrowser_do({\n  url: \"https://www.tomu.my/sales/ready\",\n  steps: [\n    { action: \"fill_by_placeholder\", placeholder: \"Search\", value: \"YX240\" },\n    { action: \"press\", key: \"Enter\" },\n    { action: \"wait\", ms: 2000 },\n    { action: \"screenshot\" },\n    { action: \"extract\", selector: \"body\" }\n  ]\n})\n```\n\n### IMPORTANT NOTES:\n- Always include the `url` parameter — the browser navigates there first.\n- For login flows, the `login` smart action auto-detects email/password fields and submit buttons.\n- Each browser_do call creates a fresh browser instance. To preserve login state across calls, include ALL subsequent steps in the SAME browser_do call, OR re-login at the start of each call.\n- For best results, combine login + navigation + action in one browser_do call when possible.\n- If a page requires inspection first, call browser_do with get_html, then use the HTML to build a second browser_do call with the correct selectors.\n\n## SECONDARY TOOL: browser_get_html\n\nUse this standalone tool to inspect page structure BEFORE building browser_do steps.\n\n```json\nbrowser_get_html({ selector: \"form\" })\n```\n\n## IMAGE GENERATION\n\nFor image tasks, use generate_image:\n```json\ngenerate_image({ prompt: \"A futuristic city at sunset\", style: \"digital-art\", aspect_ratio: \"16:9\" })\n```\n\n## CODING\n\nFor coding tasks, provide code directly in your response with proper formatting.'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 5. Deactivate individual browser tools that are now superseded by browser_do
-- Keep browser_get_html active as it's useful standalone for page inspection.
-- Keep generate_image active.
-- The individual tools still have their handlers as fallback.
UPDATE public.tools SET is_active = false WHERE name IN (
  'browser_start',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_extract',
  'browser_scroll',
  'browser_select',
  'browser_stop',
  'browser_wait_for_user'
);
