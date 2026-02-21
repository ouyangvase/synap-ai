import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HORDE_API = "https://stablehorde.net/api/v2";
const HORDE_KEY = "0000000000"; // anonymous, free, no signup
const CLIENT_AGENT = "AgentHub:1.0:agent@agenthub.app";

/** Poll Stable Horde until image is ready or timeout */
async function pollHorde(jobId: string, timeoutMs = 90_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const resp = await fetch(`${HORDE_API}/generate/status/${jobId}`, {
        headers: { "Client-Agent": CLIENT_AGENT },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.done && data.generations?.length > 0) {
        return data.generations[0].img || null;
      }
      if (data.faulted) return null;
    } catch {
      // retry
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || "";

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

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

    let enhancedPrompt = prompt;
    if (style) enhancedPrompt = `${prompt}, ${style} style`;

    // Determine dimensions (Stable Horde anonymous: max 512x512)
    let width = 512;
    let height = 512;
    switch (aspectRatio) {
      case "16:9": width = 512; height = 320; break;
      case "9:16": width = 320; height = 512; break;
      case "4:3": width = 512; height = 384; break;
      case "3:4": width = 384; height = 512; break;
      default: width = 512; height = 512;
    }
    // Stable Horde requires dimensions divisible by 64
    width = Math.round(width / 64) * 64;
    height = Math.round(height / 64) * 64;

    let imageUrl: string | null = null;
    let finalPrompt = enhancedPrompt;
    const errors: string[] = [];

    // Step 1: Enhance prompt with Gemini (optional, best-effort)
    if (geminiApiKey) {
      try {
        const geminiResp = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${geminiApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gemini-2.0-flash",
              messages: [
                { role: "system", content: "Enhance this image prompt to be more detailed and vivid for Stable Diffusion image generation. Add descriptive details about lighting, composition, and quality tags like 'highly detailed, 4k, sharp focus'. Keep it under 150 words. Output ONLY the enhanced prompt." },
                { role: "user", content: enhancedPrompt },
              ],
            }),
          }
        );
        if (geminiResp.ok) {
          const d = await geminiResp.json();
          const enhanced = d.choices?.[0]?.message?.content;
          if (enhanced) finalPrompt = enhanced.trim();
        }
      } catch (e) {
        console.log("Prompt enhancement error (non-fatal):", e);
      }
    }

    // Strategy 1: Stable Horde (free, no key needed, community GPUs)
    try {
      console.log("Submitting to Stable Horde...");
      const submitResp = await fetch(`${HORDE_API}/generate/async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: HORDE_KEY,
          "Client-Agent": CLIENT_AGENT,
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          params: {
            width,
            height,
            steps: 20,
            cfg_scale: 7,
            sampler_name: "k_euler",
          },
          nsfw: false,
          censor_nsfw: true,
          models: ["stable_diffusion"],
          r2: true,
        }),
      });

      if (submitResp.ok) {
        const submitData = await submitResp.json();
        const jobId = submitData.id;
        console.log("Stable Horde job:", jobId);

        if (jobId) {
          const resultUrl = await pollHorde(jobId);
          if (resultUrl) {
            imageUrl = resultUrl;
            console.log("Stable Horde image ready");
          } else {
            errors.push("stable-horde: generation timed out or faulted");
          }
        }
      } else {
        const errText = await submitResp.text();
        errors.push(`stable-horde: HTTP ${submitResp.status} - ${errText.substring(0, 200)}`);
      }
    } catch (e) {
      errors.push(`stable-horde: ${e}`);
      console.log("Stable Horde error:", e);
    }

    // Strategy 2: Gemini image generation models (if API key supports them)
    if (!imageUrl && geminiApiKey) {
      const geminiModels = [
        "gemini-2.0-flash-preview-image-generation",
        "gemini-2.0-flash-exp",
      ];
      for (const model of geminiModels) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `Generate an image: ${enhancedPrompt}` }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
              }),
            }
          );
          if (resp.ok) {
            const data = await resp.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith("image/")) {
                imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                break;
              }
            }
          }
          if (imageUrl) break;
        } catch {}
      }
    }

    // Strategy 3: Pollinations.ai fallback (may be down)
    if (!imageUrl) {
      try {
        const enc = encodeURIComponent(finalPrompt);
        const pollUrl = `https://image.pollinations.ai/prompt/${enc}?width=${width}&height=${height}&nologo=true&seed=${Date.now()}`;
        const resp = await fetch(pollUrl, { redirect: "follow", signal: AbortSignal.timeout(30000) });
        if (resp.ok) {
          const ct = resp.headers.get("content-type") || "";
          if (ct.startsWith("image/")) {
            imageUrl = pollUrl;
          } else {
            errors.push(`pollinations: non-image (${ct})`);
          }
        } else {
          errors.push(`pollinations: HTTP ${resp.status}`);
        }
      } catch (e) {
        errors.push(`pollinations: ${e}`);
      }
    }

    if (!imageUrl) {
      return new Response(
        JSON.stringify({
          error: "Image generation failed. Please try again.",
          details: errors,
          markdown_content: `Image generation failed.\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Persist images to Supabase Storage (both base64 data URLs and temporary HTTP URLs like Stable Horde R2)
    const userId = (meta.user_id as string) || null;
    let publicUrl = imageUrl;

    if (userId) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.storage.createBucket("image-generations", { public: true }).catch(() => {});

        let bytes: Uint8Array | null = null;
        let mimeType = "image/webp";

        if (imageUrl.startsWith("data:")) {
          // Base64 data URL
          const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            mimeType = matches[1];
            const binaryString = atob(matches[2]);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          }
        } else if (imageUrl.startsWith("http")) {
          // HTTP URL (e.g. Stable Horde R2 temporary URL) — download and re-upload
          try {
            const dlResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
            if (dlResp.ok) {
              mimeType = dlResp.headers.get("content-type") || "image/webp";
              const buf = await dlResp.arrayBuffer();
              bytes = new Uint8Array(buf);
            }
          } catch (e) {
            console.log("Image download error:", e);
          }
        }

        if (bytes) {
          const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
          const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from("image-generations")
            .upload(fileName, bytes, { contentType: mimeType, upsert: true });
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from("image-generations").getPublicUrl(fileName);
            if (urlData?.publicUrl) publicUrl = urlData.publicUrl;
          } else {
            console.log("Upload error:", uploadErr);
          }
        }
      } catch (e) {
        console.log("Storage upload error:", e);
      }
    }

    // Save to DB
    if (userId) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from("image_generations").insert({
          user_id: userId,
          prompt,
          style: style || null,
          aspect_ratio: aspectRatio,
          image_url: publicUrl.startsWith("data:") ? "(stored as base64)" : publicUrl,
          status: "completed",
          metadata: { enhanced_prompt: finalPrompt },
        });
      } catch (e) {
        console.log("DB insert error:", e);
      }
    }

    return new Response(
      JSON.stringify({
        image_url: publicUrl,
        prompt: finalPrompt,
        original_prompt: prompt,
        style,
        aspect_ratio: aspectRatio,
        width,
        height,
        markdown_content: `![Generated Image](${publicUrl})\n\n**Prompt:** ${prompt}\n**Enhanced:** ${finalPrompt}\n**Size:** ${width}x${height}`,
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
