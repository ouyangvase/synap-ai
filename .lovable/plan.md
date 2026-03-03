

## Issues Identified

**1. Screenshot appears half-image**: All browser screenshots use `fullPage: false` in Puppeteer, which only captures the visible viewport (typically 800x600). The images display correctly at full width, but the *content captured* is only the viewport portion. Fix: change the final screenshot capture to `fullPage: true`.

**2. Agent not self-thinking to complete tasks**: The agent keeps stopping after failures or partial progress instead of autonomously reasoning and retrying. Two root causes:
   - The system prompt says "1-3 steps per call" which makes the agent timid — it does one small thing, fails, and stops instead of analyzing the page and adapting.
   - The agent needs stronger instructions to analyze page content from tool results and use that to decide next actions (e.g., search for an order, find the assign button).

## Plan

### A. Fix full-page screenshots (browser-proxy)
- Change the final screenshot in `agent-action` composite script from `fullPage: false` to `fullPage: true` (line ~3433 in browser-proxy/index.ts)
- Also change the standalone `screenshot` action to default to `fullPage: true` (line ~3594)

### B. Strengthen autonomous execution (database: agents system prompt)
- Update the agent's system prompt to:
  - Remove the "1-3 steps" limitation — allow up to 6 steps per call
  - Add explicit instructions: "After each tool result, READ the page content/extracted text to understand what is on screen, then decide what to do next"
  - Add: "If a step fails, do NOT stop. Analyze the error and page content, then try a different approach immediately"
  - Add: "Use `extract` or `get_html` to understand page structure when you can't find elements"
  - Add specific tomy.my workflow guidance: navigate to Ready Sales, use search input, find order row, click assign, select runner

### C. Improve tool result feedback to LLM (chat/index.ts)
- When a browser_do result includes `content` (page text), ensure it's included in the tool result message so the LLM can read what's on the page and make intelligent decisions
- Currently only `markdown_content` or raw JSON is sent — the page content extraction is lost

### D. Fix date-fns build error
- Pin `date-fns` to `3.6.0` in package.json to resolve the corrupted locale module

### Technical Details

**Screenshot fix** — single line change in browser-proxy composite script:
```
// Line ~3433: fullPage: false → fullPage: true
screenshot = await page.screenshot({ encoding: "base64", fullPage: true });
```

**Agent prompt enhancement** — key additions:
```
- Use up to 6 steps per browser_do call for efficiency
- After EVERY tool result, read the returned page content to understand current state
- Use extract/get_html to discover page structure when elements aren't found
- Never stop on failure — analyze, adapt, retry with different approach
```

**Tool result enrichment** — in chat/index.ts executeToolRun:
```
// Include page content in tool result message for LLM context
const pageContent = result.content ? `\n\nPage content:\n${result.content.substring(0, 3000)}` : "";
const resultContent = (result.markdown_content || JSON.stringify(result)) + pageContent;
```

