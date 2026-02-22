import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * search_web — Real web search via Gemini's Google Search grounding.
 *
 * Accepts: { meta: {...}, input: { query: string, num_results?: number } }
 * Returns: { markdown_content, results: [{title, url, snippet}], navigation_urls }
 *
 * Uses Gemini 2.0 Flash with googleSearch tool for grounded results.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured", markdown_content: "Search unavailable — API key missing." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const query = body?.input?.query || body?.query || "";
    const numResults = Math.min(body?.input?.num_results || 10, 20);

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required", markdown_content: "Please provide a search query." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Call Gemini with Google Search grounding ──
    // Uses the Gemini v1beta API with googleSearch tool.
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    const geminiBody = {
      contents: [
        {
          parts: [
            {
              text: `Search the web for: "${query}"\n\nReturn the top ${numResults} most relevant results. For each result, provide:\n1. The exact page title\n2. The full URL (must be a real, working URL — never use example.com or placeholder URLs)\n3. A brief snippet/description\n\nFormat each result as:\nTITLE: <title>\nURL: <url>\nSNIPPET: <description>\n---`,
            },
          ],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    };

    const resp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Gemini search error:", errText);
      return new Response(
        JSON.stringify({
          error: `Search API error (${resp.status})`,
          markdown_content: `Search failed: ${errText.substring(0, 200)}`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const geminiResp = await resp.json();

    // ── Extract grounding metadata (real URLs from Google Search) ──
    const candidates = geminiResp.candidates || [];
    const candidate = candidates[0] || {};
    const groundingMeta = candidate.groundingMetadata || {};
    const searchEntryPoint = groundingMeta.searchEntryPoint || {};
    const groundingChunks = groundingMeta.groundingChunks || [];
    const groundingSupports = groundingMeta.groundingSupports || [];

    // Extract text content from Gemini response
    const textParts = (candidate.content?.parts || [])
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("\n");

    // ── Build results from grounding chunks (highest quality — real Google Search URLs) ──
    interface SearchResult {
      title: string;
      url: string;
      snippet: string;
    }
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    // Method 1: Extract from groundingChunks (most reliable)
    for (const chunk of groundingChunks) {
      const web = chunk.web || {};
      const url = web.uri || "";
      const title = web.title || "";
      if (url && !seenUrls.has(url) && !isFakeUrl(url)) {
        seenUrls.add(url);
        results.push({
          title: title || extractTitleFromUrl(url),
          url,
          snippet: "",
        });
      }
    }

    // Method 2: Parse structured results from the text response
    const parsedFromText = parseResultsFromText(textParts);
    for (const r of parsedFromText) {
      if (r.url && !seenUrls.has(r.url) && !isFakeUrl(r.url)) {
        seenUrls.add(r.url);
        // If we already have this result from grounding, enrich the snippet
        const existing = results.find((e) => e.url === r.url);
        if (existing) {
          if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
          if (!existing.title && r.title) existing.title = r.title;
        } else {
          results.push(r);
        }
      }
    }

    // Enrich results with snippets from grounding supports
    for (const support of groundingSupports) {
      const segment = support.segment || {};
      const text = segment.text || "";
      const indices = support.groundingChunkIndices || [];
      for (const idx of indices) {
        if (results[idx] && !results[idx].snippet && text) {
          results[idx].snippet = text.substring(0, 200);
        }
      }
    }

    // Limit to requested number
    const finalResults = results.slice(0, numResults);

    // ── Build markdown response ──
    let markdown = `## Search results for "${query}"\n\n`;
    if (finalResults.length === 0) {
      markdown += textParts || "No results found.";
    } else {
      for (let i = 0; i < finalResults.length; i++) {
        const r = finalResults[i];
        markdown += `${i + 1}. **[${r.title}](${r.url})**\n`;
        if (r.snippet) markdown += `   ${r.snippet}\n`;
        markdown += `   \`${r.url}\`\n\n`;
      }
    }

    // If Gemini gave a text summary, append it
    if (textParts && finalResults.length > 0) {
      markdown += `\n---\n\n${textParts.substring(0, 3000)}`;
    }

    return new Response(
      JSON.stringify({
        markdown_content: markdown,
        results: finalResults,
        navigation_urls: finalResults.map((r) => r.url),
        query,
        total_results: finalResults.length,
        grounding_source: groundingChunks.length > 0 ? "google_search" : "gemini_text",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("search-web error:", e);
    return new Response(
      JSON.stringify({ error: e.message, markdown_content: `Search error: ${e.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Helper functions ──

/**
 * Detect fake/placeholder URLs that should never be returned.
 */
function isFakeUrl(url: string): boolean {
  const fakePatterns = [
    "example.com",
    "example.org",
    "example.net",
    "placeholder",
    "test.com",
    "fake.com",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ];
  const lower = url.toLowerCase();
  return fakePatterns.some((p) => lower.includes(p));
}

/**
 * Extract a readable title from a URL.
 */
function extractTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\//g, " ").replace(/[-_]/g, " ").trim();
    return path || u.hostname;
  } catch {
    return url;
  }
}

/**
 * Parse search results from Gemini's text response.
 * Handles formats like:
 *   TITLE: ...
 *   URL: ...
 *   SNIPPET: ...
 *   ---
 */
function parseResultsFromText(text: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Pattern 1: TITLE/URL/SNIPPET blocks
  const blockPattern = /TITLE:\s*(.+?)[\n\r]+URL:\s*(https?:\/\/\S+)[\n\r]+SNIPPET:\s*(.+?)(?=\n---|\nTITLE:|$)/gis;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    results.push({
      title: match[1].trim(),
      url: match[2].trim(),
      snippet: match[3].trim(),
    });
  }

  if (results.length > 0) return results;

  // Pattern 2: Markdown links [title](url)
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((match = linkPattern.exec(text)) !== null) {
    results.push({
      title: match[1].trim(),
      url: match[2].trim(),
      snippet: "",
    });
  }

  if (results.length > 0) return results;

  // Pattern 3: Bare URLs
  const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
  while ((match = urlPattern.exec(text)) !== null) {
    results.push({
      title: extractTitleFromUrl(match[1]),
      url: match[1].trim(),
      snippet: "",
    });
  }

  return results;
}
