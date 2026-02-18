-- Seed default agent with browser tools for agentic control
-- This migration is idempotent (uses ON CONFLICT DO NOTHING)

-- 1. Default AI Agent with autonomous agentic system prompt
INSERT INTO public.agents (id, name, description, system_prompt, model, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'AgentHub Assistant',
  'Autonomous AI agent with browsing, coding, and image generation capabilities.',
  E'You are AgentHub, an autonomous AI agent. You control a real browser and can perform tasks like a human would — navigating websites, filling forms, clicking buttons, logging in, extracting data, and generating images.\n\n## CORE PRINCIPLES\n\n1. **BE AUTONOMOUS.** Never ask the user for CSS selectors, HTML structure, or technical details. Figure it out yourself using browser_get_html and browser_extract.\n2. **ACT, DON''T ASK.** When given a task like "log into tomu.my", immediately start working: open the browser, navigate there, inspect the page HTML to find form fields, fill them in, and click submit.\n3. **INSPECT FIRST, ACT SECOND.** Before clicking or typing, always use browser_get_html to read the page structure and discover the correct selectors. Common patterns:\n   - Login forms: look for input[type=\"email\"], input[type=\"password\"], button[type=\"submit\"]\n   - Search: look for input[type=\"search\"], input[name=\"q\"]\n   - Links: look for a[href] elements with matching text\n4. **CHAIN ACTIONS.** Execute multiple tool calls in sequence without stopping to ask. A typical login flow:\n   a. browser_start with the URL\n   b. browser_get_html to see the page structure\n   c. browser_type for username field\n   d. browser_type for password field\n   e. browser_click on the submit button\n   f. browser_screenshot to verify result\n5. **RECOVER FROM ERRORS.** If a selector fails, use browser_get_html again to find the correct one. If a page loads differently than expected, adapt.\n6. **REPORT VISUALLY.** After key actions, take a screenshot so the user can see what happened.\n\n## TOOL USAGE GUIDE\n\n### Starting a session\nAlways call browser_start first. Pass a URL to navigate immediately:\n```\nbrowser_start({ url: \"https://example.com\" })\n```\n\n### Discovering page structure\nUse browser_get_html BEFORE any click/type action to find selectors:\n```\nbrowser_get_html({ selector: \"form\" })  -- get form HTML to find input names\nbrowser_get_html({ selector: \"body\" })  -- get full page structure\nbrowser_get_html({ selector: \"nav\" })   -- get navigation links\n```\nThis returns the actual HTML with attributes so you can identify:\n- Input field selectors: input[name=\"email\"], #username, .login-field\n- Button selectors: button[type=\"submit\"], .btn-primary, [data-testid=\"login\"]\n- Link selectors: a[href=\"/dashboard\"], a:contains(\"Sign In\")\n\n### Filling forms\n```\nbrowser_type({ selector: \"input[name=email]\", text: \"user@example.com\", clear: true })\nbrowser_type({ selector: \"input[name=password]\", text: \"mypassword\", clear: true })\nbrowser_click({ selector: \"button[type=submit]\" })\n```\n\n### Extracting data\n```\nbrowser_extract({ selector: \".results\" })  -- get text content\nbrowser_get_html({ selector: \"table\" })     -- get HTML structure of a table\n```\n\n### After login or important actions\n```\nbrowser_screenshot()  -- so user can see the result\n```\n\n### When you need the user to act (CAPTCHA, 2FA)\nOnly use browser_wait_for_user when there''s something you truly cannot do:\n```\nbrowser_wait_for_user({ instruction: \"Please solve the CAPTCHA\" })\n```\n\n## EXAMPLE TASK: \"Log into tomu.my with email user@test.com and password abc123\"\n\nYour response should be to immediately call tools in sequence:\n1. browser_start({ url: \"https://tomu.my/login\" })\n2. browser_get_html({ selector: \"form\" })  -- read the form to find field selectors\n3. browser_type({ selector: \"<selector from html>\", text: \"user@test.com\", clear: true })\n4. browser_type({ selector: \"<selector from html>\", text: \"abc123\", clear: true })\n5. browser_click({ selector: \"<submit button selector from html>\" })\n6. browser_screenshot()  -- verify login succeeded\n\nNever ask: \"What is the CSS selector for the email field?\" — find it yourself.\n\n## IMAGE GENERATION\nWhen asked to generate an image, use generate_image with a detailed prompt:\n```\ngenerate_image({ prompt: \"A futuristic city at sunset\", style: \"digital-art\", aspect_ratio: \"16:9\" })\n```\n\n## CODING\nFor coding tasks, provide code directly in your response with proper formatting.',
  'gemini-2.0-flash',
  true
) ON CONFLICT (id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  description = EXCLUDED.description,
  name = EXCLUDED.name;

-- 2. Browser tools
INSERT INTO public.tools (id, name, description, input_schema, requires_approval, is_active) VALUES
('00000000-0000-0000-0001-000000000001', 'browser_start', 'Start a new browser session. Optionally navigate to a URL immediately.', '{"type":"object","properties":{"url":{"type":"string","description":"Initial URL to navigate to (optional)"}}}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000002', 'browser_navigate', 'Navigate the browser to a URL.', '{"type":"object","properties":{"url":{"type":"string","description":"URL to navigate to"}},"required":["url"]}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000003', 'browser_click', 'Click an element on the page by CSS selector. Use browser_get_html first to discover the correct selector.', '{"type":"object","properties":{"selector":{"type":"string","description":"CSS selector of element to click"}},"required":["selector"]}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000004', 'browser_type', 'Type text into an input field. Use browser_get_html first to discover the correct selector.', '{"type":"object","properties":{"selector":{"type":"string","description":"CSS selector of input field"},"text":{"type":"string","description":"Text to type"},"clear":{"type":"boolean","description":"Clear existing text first (recommended for login fields)"}},"required":["selector","text"]}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000005', 'browser_screenshot', 'Take a screenshot of the current browser page. Use after important actions to show the user what happened.', '{"type":"object","properties":{"full_page":{"type":"boolean","description":"Capture full scrollable page (default: false, viewport only)"}}}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000006', 'browser_extract', 'Extract text content from the page or a specific element. Returns plain text (no HTML).', '{"type":"object","properties":{"selector":{"type":"string","description":"CSS selector to extract text from (default: body)"}}}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000007', 'browser_scroll', 'Scroll the page in a direction.', '{"type":"object","properties":{"direction":{"type":"string","enum":["up","down","left","right"],"description":"Scroll direction"},"amount":{"type":"number","description":"Pixels to scroll (default 500)"}}}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000008', 'browser_select', 'Select an option from a dropdown.', '{"type":"object","properties":{"selector":{"type":"string","description":"CSS selector of select element"},"value":{"type":"string","description":"Value to select"}},"required":["selector","value"]}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000009', 'browser_stop', 'Stop/close the current browser session.', '{"type":"object","properties":{}}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000010', 'browser_wait_for_user', 'Pause automation and wait for the user to complete a manual action (e.g., solve a CAPTCHA, complete 2FA). Only use when the agent truly cannot proceed autonomously.', '{"type":"object","properties":{"instruction":{"type":"string","description":"What the user should do"}},"required":["instruction"]}'::jsonb, true, true),
('00000000-0000-0000-0001-000000000011', 'generate_image', 'Generate an image from a text prompt using AI.', '{"type":"object","properties":{"prompt":{"type":"string","description":"Detailed description of the image to generate"},"style":{"type":"string","enum":["photorealistic","anime","digital-art","oil-painting","watercolor","3d-render","pixel-art"],"description":"Art style (optional)"},"aspect_ratio":{"type":"string","enum":["1:1","16:9","9:16","4:3","3:4"],"description":"Aspect ratio (optional)"}},"required":["prompt"]}'::jsonb, false, true),
('00000000-0000-0000-0001-000000000012', 'browser_get_html', 'Get the HTML structure of the page or a specific element. CRITICAL: Use this before browser_click or browser_type to discover the correct CSS selectors. Returns outerHTML with attributes, ids, classes, names — everything needed to build selectors.', '{"type":"object","properties":{"selector":{"type":"string","description":"CSS selector to get HTML of (e.g. form, body, nav, .login-form, #main). Default: body"},"max_length":{"type":"number","description":"Max characters to return (default 8000)"}}}'::jsonb, false, true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  input_schema = EXCLUDED.input_schema;

-- 3. Tool endpoints (browser tools route to browser-proxy/agent-action, image gen to generate-image function)
INSERT INTO public.tool_endpoints (tool_id, endpoint_url, http_method, timeout_ms, max_retries) VALUES
('00000000-0000-0000-0001-000000000001', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000002', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000003', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000004', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000005', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000006', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000007', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000008', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000009', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000010', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1),
('00000000-0000-0000-0001-000000000011', '{SUPABASE_URL}/functions/v1/generate-image', 'POST', 120000, 1),
('00000000-0000-0000-0001-000000000012', '{SUPABASE_URL}/functions/v1/browser-proxy/agent-action', 'POST', 60000, 1)
ON CONFLICT DO NOTHING;

-- 4. Link tools to default agent
INSERT INTO public.agent_tools (agent_id, tool_id) VALUES
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000003'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000004'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000005'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000006'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000007'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000008'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000009'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000010'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000011'),
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000012')
ON CONFLICT DO NOTHING;

-- 5. Add browser_profile_path to profiles if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'browser_profile_path') THEN
    ALTER TABLE public.profiles ADD COLUMN browser_profile_path TEXT;
  END IF;
END $$;

-- 6. Image generations table
CREATE TABLE IF NOT EXISTS public.image_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  style TEXT,
  aspect_ratio TEXT DEFAULT '1:1',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.image_generations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
CREATE POLICY "Users view own generations" ON public.image_generations FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE POLICY "Users create own generations" ON public.image_generations FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE POLICY "Users update own generations" ON public.image_generations FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
CREATE POLICY "Users delete own generations" ON public.image_generations FOR DELETE USING (auth.uid() = user_id OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only add to publication if not already added
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.image_generations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Fix conversations delete policy (users should be able to delete their own)
DROP POLICY IF EXISTS "Admin deletes conversations" ON public.conversations;
DO $$ BEGIN
CREATE POLICY "Users delete own conversations" ON public.conversations FOR DELETE USING (auth.uid() = user_id OR public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 8. Fix messages delete policy
DO $$ BEGIN
CREATE POLICY "Users delete own messages" ON public.messages FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 9. Fix tool_runs delete policy
DROP POLICY IF EXISTS "Admin deletes tool_runs" ON public.tool_runs;
DO $$ BEGIN
CREATE POLICY "Users delete own tool_runs" ON public.tool_runs FOR DELETE USING (
  auth.uid() = user_id OR public.is_admin()
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
