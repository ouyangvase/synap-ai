import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Image as ImageIcon, Sparkles, Download, Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ImageGeneration {
  id: string;
  prompt: string;
  style: string | null;
  aspect_ratio: string;
  image_url: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

export default function ImageGenPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("photorealistic");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [loading, setLoading] = useState(false);
  const [generations, setGenerations] = useState<ImageGeneration[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageGeneration | null>(null);

  const fetchGenerations = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("image_generations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setGenerations(data as unknown as ImageGeneration[]);
  }, [user]);

  useEffect(() => {
    fetchGenerations();
  }, [fetchGenerations]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !user || loading) return;
    setLoading(true);

    try {
      const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;
      const { data: { session } } = await supabase.auth.getSession();

      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          input: {
            prompt: prompt.trim(),
            style,
            aspect_ratio: aspectRatio,
          },
          meta: { user_id: user.id },
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(err.error || "Image generation failed");
      }

      const result = await resp.json();

      if (result.image_url) {
        toast({ title: "Image generated", description: "Your image has been created." });
        setPrompt("");
        // Refresh list
        await fetchGenerations();
        // Select the new image
        setSelectedImage({
          id: "latest",
          prompt: result.original_prompt || prompt,
          style,
          aspect_ratio: aspectRatio,
          image_url: result.image_url,
          status: "completed",
          error: null,
          created_at: new Date().toISOString(),
        });
      } else {
        throw new Error("No image URL returned");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await (supabase as any).from("image_generations").delete().eq("id", id);
    if (selectedImage?.id === id) setSelectedImage(null);
    fetchGenerations();
  };

  const handleDownload = async (imageUrl: string, prompt: string) => {
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Left: Controls + History */}
      <div className="w-80 border-r border-border/30 glass-strong flex flex-col">
        <div className="p-4 border-b border-border/30 glass-subtle flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-sm font-bold tracking-wide uppercase text-gradient">
            Image Generator
          </h1>
        </div>

        {/* Generation form */}
        <div className="p-4 space-y-3 border-b border-border/30 glass-subtle">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Prompt</label>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A futuristic city at sunset..."
              disabled={loading}
              className="glass-input border-border/30 rounded-xl"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Style</label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="glass-input border-border/30 text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="photorealistic">Photorealistic</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                  <SelectItem value="digital-art">Digital Art</SelectItem>
                  <SelectItem value="oil-painting">Oil Painting</SelectItem>
                  <SelectItem value="watercolor">Watercolor</SelectItem>
                  <SelectItem value="3d-render">3D Render</SelectItem>
                  <SelectItem value="pixel-art">Pixel Art</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ratio</label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="glass-input border-border/30 text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 Square</SelectItem>
                  <SelectItem value="16:9">16:9 Wide</SelectItem>
                  <SelectItem value="9:16">9:16 Tall</SelectItem>
                  <SelectItem value="4:3">4:3 Standard</SelectItem>
                  <SelectItem value="3:4">3:4 Portrait</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full gap-2 rounded-xl elevation-glow active:translate-y-[1px] transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Image
              </>
            )}
          </Button>
        </div>

        {/* History */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 space-y-1">
          <p className="text-xs text-muted-foreground px-2 py-1 font-medium">History</p>
          {generations.length === 0 && (
            <p className="text-xs text-muted-foreground/60 px-2 py-4 text-center">
              No images generated yet
            </p>
          )}
          {generations.map((gen) => (
            <button
              key={gen.id}
              onClick={() => setSelectedImage(gen)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors group relative ${
                selectedImage?.id === gen.id
                  ? "bg-secondary/50 elevation-1 text-accent-foreground"
                  : "hover:bg-secondary/30"
              }`}
            >
              <div className="flex items-center gap-2">
                {gen.image_url ? (
                  <img
                    src={gen.image_url}
                    alt=""
                    className="w-8 h-8 rounded object-cover shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <span className="truncate text-xs pr-6">{gen.prompt}</span>
              </div>
              <span
                role="button"
                onClick={(e) => handleDelete(e, gen.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-xl hover:bg-destructive/20 hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Center: Image preview */}
      <div className="flex-1 flex flex-col">
        {selectedImage?.image_url ? (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border glass-subtle">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{selectedImage.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedImage.style && `${selectedImage.style} · `}
                  {selectedImage.aspect_ratio}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 ml-2 shrink-0 rounded-xl"
                onClick={() =>
                  handleDownload(selectedImage.image_url!, selectedImage.prompt)
                }
              >
                <Download className="w-3 h-3" />
                Download
              </Button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              <img
                src={selectedImage.image_url}
                alt={selectedImage.prompt}
                className="max-w-full max-h-full object-contain elevation-2 rounded-2xl"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="glass elevation-1 rounded-2xl p-8">
              <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/5">
                <Sparkles className="w-10 h-10 text-primary/40" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-medium">AI Image Generator</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Describe what you want to see and the AI will create it. Try different styles and aspect ratios.
                </p>
              </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
