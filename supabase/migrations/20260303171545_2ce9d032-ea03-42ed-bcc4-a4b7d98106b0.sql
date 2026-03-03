-- Harden browser_do contract for autonomous completion and selector flexibility
UPDATE public.tools
SET
  description = 'Execute browser automation actions autonomously until the current objective is completed or a hard blocker occurs. Supported actions: navigate, click, click_by_text, click_by_role, click_best_match, type, fill, fill_by_label, fill_by_placeholder, fill_by_name, fill_by_type, select, select_by_text, press, wait, wait_for_text, wait_for_url, wait_for_network_idle, wait_for_spa_content, screenshot, extract, get_html, scroll, login, find_row, click_in_row, verify_text, verify_url, verify_row_text. Use 1-4 steps per call. Prefer resilient text/label actions over brittle CSS selectors. Do not ask the user for selectors; recover using available DOM hints.',
  input_schema = $$
  {
    "type": "object",
    "properties": {
      "task_description": {
        "type": "string",
        "description": "Short objective for this call (e.g. login, open Ready Sales, assign runner)."
      },
      "url": {
        "type": "string",
        "description": "Optional start URL (required on first call or when explicitly navigating)."
      },
      "steps": {
        "type": "array",
        "description": "Browser steps to run sequentially (1-4 recommended).",
        "items": {
          "type": "object",
          "required": ["action"],
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "navigate","click","click_by_text","click_by_role","click_best_match",
                "type","fill","fill_by_label","fill_by_placeholder","fill_by_name","fill_by_type",
                "select","select_by_text","press","wait","wait_for_text","wait_for_url",
                "wait_for_network_idle","wait_for_spa_content","screenshot","extract","get_html","scroll",
                "login","find_row","click_in_row","verify_text","verify_url","verify_row_text"
              ],
              "description": "Browser action to execute."
            },
            "selector": { "type": "string", "description": "CSS selector for selector-based actions." },
            "url": { "type": "string", "description": "URL used by navigate actions." },
            "text": { "type": "string", "description": "Visible text to click/wait/extract or text to type when applicable." },
            "value": { "type": "string", "description": "Value alias for type/fill/select/press (backward compatible)." },
            "key": { "type": "string", "description": "Keyboard key for press actions (e.g. Enter)." },
            "label": { "type": "string", "description": "Label text for fill_by_label." },
            "placeholder": { "type": "string", "description": "Placeholder text for fill_by_placeholder." },
            "name": { "type": "string", "description": "Field name for fill_by_name." },
            "type": { "type": "string", "description": "Input type for fill_by_type (e.g. email/password)." },
            "email": { "type": "string", "description": "Email for login action." },
            "password": { "type": "string", "description": "Password for login action." },
            "timeout": { "type": "number", "description": "Optional timeout in ms for wait actions." },
            "ms": { "type": "number", "description": "Milliseconds for wait action." },
            "direction": { "type": "string", "description": "Scroll direction (up/down)." },
            "amount": { "type": "number", "description": "Scroll amount in pixels." }
          }
        }
      }
    },
    "required": ["steps"]
  }
  $$::jsonb,
  updated_at = now()
WHERE name = 'browser_do';

-- Prompt hardening: push autonomous completion behavior for active agents
UPDATE public.agents
SET system_prompt = system_prompt || E'\n\n## AUTONOMOUS COMPLETION (MANDATORY)\nWhen executing an approved task, continue tool execution loops autonomously until the user goal is completed with evidence (verification text or screenshot) or a hard blocker occurs (captcha/2FA/account lock).\nDo NOT stop after a partial success and do NOT ask the user to continue unless blocked.\nFor tomy.my order flow, the expected completion path is: login -> Ready Sales -> find order -> assign runner -> verify visible confirmation.'
WHERE is_active = true
  AND system_prompt NOT ILIKE '%AUTONOMOUS COMPLETION (MANDATORY)%';