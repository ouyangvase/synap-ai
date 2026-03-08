const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * search_web — Real web search via Lovable AI Gateway + Gemini Google Search grounding.
 *
 * Accepts: { meta: {...}, input: { query: string, num_results?: number } }
 * Returns: { markdown_content, results: [{title, url, snippet}], navigation_urls }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured", markdown_content: "Search unavailable — API key missing." }),
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

    // ── Call Lovable AI Gateway with google/gemini-2.5-flash ──
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a web search assistant. Search the web and return the top ${numResults} most relevant results. For each result provide the exact page title, the full real URL, and a brief snippet. Format each result as:\nTITLE: <title>\nURL: <url>\nSNIPPET: <description>\n---`,
          },
          {
            role: "user",
            content: `Search the web for: "${query}"`,
          },
        ],
        tools: [{ type: "function", function: { name: "google_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("AI Gateway search error:", resp.status, errText);
      if (resp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited", markdown_content: "Search rate limited — please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (resp.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted", markdown_content: "AI credits exhausted — please top up." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: `Search API error (${resp.status})`, markdown_content: `Search failed: ${errText.substring(0, 200)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiResp = await resp.json();
    const textContent = aiResp.choices?.[0]?.message?.content || "";

    // ── Parse results from the text response ──
    const results = parseResults(textContent);
    const finalResults = results.slice(0, numResults);

    // ── Build markdown response ──
    let markdown = `## Search results for "${query}"\n\n`;
    if (finalResults.length === 0) {
      markdown += textContent || "No results found.";
    } else {
      for (let i = 0; i < finalResults.length; i++) {
        const r = finalResults[i];
        markdown += `${i + 1}. **[${r.title}](${r.url})**\n`;
        if (r.snippet) markdown += `   ${r.snippet}\n`;
        markdown += `   \`${r.url}\`\n\n`;
      }
    }

    if (textContent && finalResults.length > 0) {
      markdown += `\n---\n\n${textContent.substring(0, 3000)}`;
    }

    return new Response(
      JSON.stringify({
        markdown_content: markdown,
        results: finalResults,
        navigation_urls: finalResults.map((r) => r.url),
        query,
        total_results: finalResults.length,
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

// ── Helpers ──

function isFakeUrl(url: string): boolean {
  const fakes = ["example.com", "example.org", "example.net", "placeholder", "test.com", "fake.com", "localhost", "127.0.0.1"];
  const lower = url.toLowerCase();
  return fakes.some((p) => lower.includes(p));
}

function parseResults(text: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seenUrls = new Set<string>();

  // Pattern 1: TITLE/URL/SNIPPET blocks
  const blockPattern = /TITLE:\s*(.+?)[\n\r]+URL:\s*(https?:\/\/\S+)[\n\r]+SNIPPET:\s*(.+?)(?=\n---|\nTITLE:|$)/gis;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    const url = match[2].trim();
    if (!isFakeUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ title: match[1].trim(), url, snippet: match[3].trim() });
    }
  }
  if (results.length > 0) return results;

  // Pattern 2: Markdown links [title](url)
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[2].trim();
    if (!isFakeUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ title: match[1].trim(), url, snippet: "" });
    }
  }
  if (results.length > 0) return results;

  // Pattern 3: Bare URLs
  const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[1].trim();
    if (!isFakeUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      results.push({ title: url, url, snippet: "" });
    }
  }

  return results;
}
