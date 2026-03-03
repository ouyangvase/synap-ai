

# Plan: Add Plan Mode, Self-Thinking, and Browser Task Execution

## Overview

Add three capabilities to the AI agent: (1) a visible "thinking/reasoning" phase where the model shows its chain-of-thought, (2) a "Plan Mode" where the agent creates a step-by-step plan before executing, and (3) wiring the browser automation tool (`browser_do`) into the chat agent so it can complete tasks end-to-end.

---

## Problem: Missing GEMINI_API_KEY

The chat edge function calls `Deno.env.get("GEMINI_API_KEY")` but this secret doesn't exist. Only `BROWSER_SERVICE_URL` and `LOVABLE_API_KEY` are configured. We need to either:
- Add the Gemini API key as a secret, OR
- Switch to the Lovable AI Gateway (which uses `LOVABLE_API_KEY` already available)

**Recommendation**: Switch to Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) using the existing `LOVABLE_API_KEY`. This avoids needing a separate Gemini key and uses `google/gemini-3-flash-preview` by default.

---

## Changes

### 1. Chat Edge Function (`supabase/functions/chat/index.ts`)

**Switch to Lovable AI Gateway:**
- Replace `generativelanguage.googleapis.com` calls with `https://ai.gateway.lovable.dev/v1/chat/completions`
- Use `LOVABLE_API_KEY` for auth instead of `GEMINI_API_KEY`
- Set model to `google/gemini-2.5-flash` (fast + good reasoning)

**Add Plan Mode logic:**
- Detect `[PLAN]` prefix in user messages or a `plan_mode: true` flag
- When plan mode is active, prepend a system instruction: "First create a numbered step-by-step plan. Present the plan to the user. Wait for approval before executing."
- After the user approves (sends "go ahead", "approved", etc.), the agent executes each plan step sequentially, emitting thinking events between steps

**Enhanced thinking events:**
- Emit structured `{ type: "thinking", message, phase }` SSE events with phases: `planning`, `reasoning`, `executing`, `verifying`
- Include the agent's internal reasoning in the thinking stream

**Add `browser_do` tool definition:**
- Create a new tool record for `browser_do` that calls the `browser-proxy` edge function
- The tool accepts `{ url, steps: [{ action, selector, value }] }` and returns screenshots + results

### 2. Add `browser_do` Tool to Database

- Insert a `browser_do` tool into `tools` table with proper schema
- Insert a `tool_endpoint` pointing to `{SUPABASE_URL}/functions/v1/browser-proxy/action`
- Link it to the MuleRun Agent via `agent_tools`

### 3. System Prompt Enhancement (`agents` table update)

Update the agent's system prompt to include:
- Plan mode instructions: "When given a complex task, first create a plan with numbered steps. Show the plan, then execute step by step."
- Thinking instructions: "Think through each step carefully. When using browser_do, describe what you're about to do and why."
- Browser capabilities: "You can use browser_do to navigate websites, click buttons, fill forms, and extract data."

### 4. ChatPane UI (`src/components/chat/ChatPane.tsx`)

**Plan Mode toggle:**
- Add a "Plan" toggle button next to the send button
- When enabled, prefix messages with `[PLAN]` metadata
- Show a visual indicator when the agent is in planning mode

**Enhanced thinking display:**
- Show a collapsible "Thinking" section with the agent's reasoning
- Different icons for phases: lightbulb (planning), brain (reasoning), cog (executing), check (verifying)
- Animate transitions between thinking phases

**Plan approval UI:**
- When the agent presents a plan, show "Approve" / "Edit Plan" buttons
- Clicking "Approve" sends a confirmation message to continue execution

### 5. MessageBubble Enhancement (`src/components/chat/MessageBubble.tsx`)

- Detect plan-formatted messages (numbered lists) and render them with checkmarks as steps complete
- Add a distinct visual style for "plan" messages (glass card with step indicators)

### 6. New ThinkingPanel Component (`src/components/chat/ThinkingPanel.tsx`)

- Collapsible panel showing the agent's chain-of-thought
- Renders thinking steps with timestamps
- Shows current phase with animated indicator
- Persists thinking history for the conversation

---

## Files to Modify/Create

1. `supabase/functions/chat/index.ts` — Switch to Lovable AI Gateway, add plan mode logic, enhanced thinking
2. `src/components/chat/ChatPane.tsx` — Plan mode toggle, thinking display, plan approval UI
3. `src/components/chat/MessageBubble.tsx` — Plan message rendering with step tracking
4. `src/components/chat/ThinkingPanel.tsx` — New component for reasoning display
5. Database migration — Add `browser_do` tool, endpoint, agent link; update system prompt

