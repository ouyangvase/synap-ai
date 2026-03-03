import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background animate-mesh-gradient">
      <div className="glass-card glass-highlight rounded-2xl p-10 animate-float">
        <div className="text-center space-y-4">
          <h1 className="text-7xl font-bold text-gradient animate-glow-pulse">404</h1>
          <p className="text-lg text-foreground font-medium">
            Page not found
          </p>
          <p className="text-sm text-muted-foreground">
            <code className="glass-input px-2 py-1 rounded-xl text-xs">{location.pathname}</code> does not exist
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <Button variant="outline" onClick={() => navigate(-1)} className="gap-2 rounded-xl glass">
              <ArrowLeft className="w-4 h-4" />
              Go back
            </Button>
            <Button onClick={() => navigate("/")} className="gap-2 rounded-xl elevation-glow active:translate-y-[1px] transition-transform">
              <Home className="w-4 h-4" />
              Home
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
