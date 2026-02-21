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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="glass elevation-2 rounded-2xl p-10">
        <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-primary/30">404</h1>
        <p className="text-lg text-muted-foreground">
          Page not found
        </p>
        <p className="text-sm text-muted-foreground/60">
          <code className="bg-secondary/50 px-2 py-1 rounded-xl">{location.pathname}</code> does not exist
        </p>
        <div className="flex gap-2 justify-center pt-2">
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-2 rounded-xl">
            <ArrowLeft className="w-4 h-4" />
            Go back
          </Button>
          <Button onClick={() => navigate("/")} className="gap-2 rounded-xl">
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
