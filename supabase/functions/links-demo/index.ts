import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * links-demo: A built-in tool that returns useful links based on a query.
 * Replaces the localhost n8n webhook with a self-hosted edge function.
 * Accepts: { meta: {...}, input: { query: string } }
 * Returns: { markdown_content, html_content, navigation_urls }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const query = body?.input?.query || body?.query || "general";

    // Built-in link database organized by category
    const linkDB: Record<string, { title: string; url: string; description: string }[]> = {
      docs: [
        { title: "MDN Web Docs", url: "https://developer.mozilla.org", description: "Comprehensive web development documentation" },
        { title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs/", description: "Official TypeScript documentation" },
        { title: "React Documentation", url: "https://react.dev", description: "Official React framework docs" },
      ],
      tools: [
        { title: "GitHub", url: "https://github.com", description: "Code hosting and collaboration platform" },
        { title: "VS Code", url: "https://code.visualstudio.com", description: "Popular code editor" },
        { title: "Figma", url: "https://figma.com", description: "Collaborative design tool" },
      ],
      ai: [
        { title: "OpenAI Platform", url: "https://platform.openai.com", description: "OpenAI API and documentation" },
        { title: "Hugging Face", url: "https://huggingface.co", description: "Open-source ML models and datasets" },
        { title: "LangChain", url: "https://langchain.com", description: "Framework for LLM applications" },
      ],
      general: [
        { title: "Hacker News", url: "https://news.ycombinator.com", description: "Tech news and discussions" },
        { title: "Stack Overflow", url: "https://stackoverflow.com", description: "Programming Q&A community" },
        { title: "Product Hunt", url: "https://producthunt.com", description: "Discover new products" },
      ],
    };

    // Match query to categories
    const queryLower = query.toLowerCase();
    let matchedLinks: typeof linkDB["general"] = [];

    for (const [category, links] of Object.entries(linkDB)) {
      if (queryLower.includes(category) || category === "general") {
        matchedLinks = [...matchedLinks, ...links];
      }
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    const uniqueLinks = matchedLinks.filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    }).slice(0, 6);

    const markdown = `Here are some useful links for **${query}**:\n\n` +
      uniqueLinks.map((l) => `- [${l.title}](${l.url}) — ${l.description}`).join("\n");

    const html = `<ul>` +
      uniqueLinks.map((l) => `<li><a href="${l.url}">${l.title}</a> — ${l.description}</li>`).join("") +
      `</ul>`;

    return new Response(
      JSON.stringify({
        markdown_content: markdown,
        html_content: html,
        attachment_urls: [],
        navigation_urls: uniqueLinks.map((l) => l.url),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
