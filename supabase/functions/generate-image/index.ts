import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {}

    // Support both direct calls and tool-call format
    const input = (body.input as Record<string, unknown>) || body;
    const meta = (body.meta as Record<string, unknown>) || {};
    const prompt = (input.prompt as string) || "";
    const style = (input.style as string) || "";
    const aspectRatio = (input.aspect_ratio as string) || "1:1";

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build enhanced prompt
    let enhancedPrompt = prompt;
    if (style) {
      enhancedPrompt = `${prompt}, in ${style} style`;
    }

    // Use Gemini's image generation via Imagen
    // First try Imagen 3, fall back to Gemini's text-to-image
    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`;

    const imagenBody = {
      contents: [
        {
          parts: [
            {
              text: `Generate an image based on this description: ${enhancedPrompt}. Aspect ratio: ${aspectRatio}.`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT"],
      },
    };

    // Try using Gemini to generate a detailed image description, then use a free image API
    // Since Gemini doesn't natively generate images via API in all regions,
    // we'll use Pollinations.ai (free, no key required) for actual image generation

    // First, use Gemini to enhance the prompt
    const geminiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [
            {
              role: "system",
              content:
                "You are an expert image prompt engineer. Given a user's image description, enhance it into a detailed, vivid prompt optimized for AI image generation. Keep it under 200 words. Output ONLY the enhanced prompt, nothing else.",
            },
            {
              role: "user",
              content: `Enhance this image prompt: "${enhancedPrompt}"`,
            },
          ],
        }),
      }
    );

    let finalPrompt = enhancedPrompt;
    if (geminiResp.ok) {
      const geminiData = await geminiResp.json();
      const enhanced = geminiData.choices?.[0]?.message?.content;
      if (enhanced) {
        finalPrompt = enhanced.trim();
      }
    }

    // Parse aspect ratio to width/height
    let width = 1024;
    let height = 1024;
    switch (aspectRatio) {
      case "16:9":
        width = 1280;
        height = 720;
        break;
      case "9:16":
        width = 720;
        height = 1280;
        break;
      case "4:3":
        width = 1024;
        height = 768;
        break;
      case "3:4":
        width = 768;
        height = 1024;
        break;
      default:
        width = 1024;
        height = 1024;
    }

    // Use Pollinations.ai for free image generation
    const encodedPrompt = encodeURIComponent(finalPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${Date.now()}`;

    // Verify the image URL works by fetching headers
    const checkResp = await fetch(imageUrl, { method: "HEAD" });

    if (!checkResp.ok) {
      return new Response(
        JSON.stringify({
          error: "Image generation failed",
          markdown_content: "Failed to generate image. Please try again with a different prompt.",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If this is a tool call from the chat agent, save to DB
    const userId = (meta.user_id as string) || null;
    if (userId) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase.from("image_generations").insert({
        user_id: userId,
        prompt,
        style: style || null,
        aspect_ratio: aspectRatio,
        image_url: imageUrl,
        status: "completed",
        metadata: { enhanced_prompt: finalPrompt },
      });
    }

    return new Response(
      JSON.stringify({
        image_url: imageUrl,
        prompt: finalPrompt,
        original_prompt: prompt,
        style,
        aspect_ratio: aspectRatio,
        width,
        height,
        markdown_content: `![Generated Image](${imageUrl})\n\n**Prompt:** ${prompt}\n**Enhanced:** ${finalPrompt}\n**Size:** ${width}x${height}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-image error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        markdown_content: "Image generation failed. Please try again.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
