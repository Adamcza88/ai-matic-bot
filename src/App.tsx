import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "./types";
import { useTradingBot } from "./hooks/useTradingBot";
import Dashboard from "./components/Dashboard";
import LoginCard from "./components/LoginCard";
import NotReleased from "./components/NotReleased";
import ApiKeysManager, { SERVICE_OPTIONS } from "./components/ApiKeysManager";
import { useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Moon, Settings, Sun, User } from "lucide-react";
import Logo from "./components/Logo";

// Guest mode je povolen, pokud explicitně nenastavíme VITE_ALLOW_GUESTS="false"
const ALLOW_GUESTS = import.meta.env.VITE_ALLOW_GUESTS !== "false";
const DEFAULT_AUTO_REFRESH_MINUTES = 3;

export default function App() {
  const auth = useAuth();
  const [mode, setMode] = useState<TradingMode>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("ai-matic-mode");
      if (saved) return saved as TradingMode;
    }
    return TradingMode.OFF;
  });
  const [useTestnet, setUseTestnet] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("ai-matic-useTestnet");
      if (saved !== null) return saved === "true";
    }
    return false; // Default to MAINNET
  });
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("ai-matic-theme");
      if (saved === "light" || saved === "dark") return saved;
    }
    return "dark";
  });

  useEffect(() => {
    localStorage.setItem("ai-matic-mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("ai-matic-useTestnet", String(useTestnet));
  }, [useTestnet]);

  useEffect(() => {
    localStorage.setItem("ai-matic-theme", theme);
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [missingServices, setMissingServices] = useState<string[]>([]);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  const bot = useTradingBot(mode, useTestnet, auth.session?.access_token);
  const userEmail = useMemo(() => {
    if (isGuest) return "Guest";
    return auth.user?.email ?? "";
  }, [auth.user, isGuest]);

  useEffect(() => {
    if (!bot.settings?.autoRefreshEnabled) return;
    const minutesRaw = Number(bot.settings?.autoRefreshMinutes);
    const minutes =
      Number.isFinite(minutesRaw) && minutesRaw > 0
        ? minutesRaw
        : DEFAULT_AUTO_REFRESH_MINUTES;
    const timer = window.setInterval(() => {
      window.location.reload();
    }, minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [bot.settings?.autoRefreshEnabled, bot.settings?.autoRefreshMinutes]);

  const refreshKeyStatus = useCallback(async () => {
    if (!auth.user) return;
    if (!supabase) {
      const missing = SERVICE_OPTIONS.map((s) => s.label);
      setKeysError(
        "Supabase is not configured (VITE_SUPABASE_URL/KEY). Unable to load API keys."
      );
      setMissingServices(missing);
      setShowKeyPanel(true);
      return;
    }
    setKeysError(null);
    const { data, error } = await supabase
      .from("user_api_keys")
      .select("service")
      .eq("user_id", auth.user.id);

    if (error) {
      setKeysError(error.message);
      setMissingServices(SERVICE_OPTIONS.map((s) => s.label));
      return;
    }

    const have = new Set(
      (data ?? [])
        .map((row) => row.service?.toLowerCase())
        .filter(Boolean)
    );
    const missing = SERVICE_OPTIONS.filter((opt) => !have.has(opt.value)).map(
      (opt) => opt.label
    );
    setMissingServices(missing);
    if (missing.length > 0) {
      setShowKeyPanel(true);
    }
  }, [auth.user]);

  useEffect(() => {
    if (auth.status === "ready" && auth.user) {
      void refreshKeyStatus();
    }
  }, [auth.status, auth.user, refreshKeyStatus]);

  // Pokud chybí mainnetové klíče, automaticky přepnout na testnet, aby se API volání nesypala.
  useEffect(() => {
    const missingMainnet = missingServices.some((s) =>
      s.toLowerCase().includes("mainnet")
    );
    if (!useTestnet && missingMainnet) {
      setUseTestnet(true);
    }
  }, [missingServices, useTestnet]);

  if (auth.status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        Loading session...
      </div>
    );
  }

  if (auth.status === "blocked") {
    return <NotReleased message={auth.error} />;
  }

  if (auth.status === "signed_out" && !isGuest) {
    return (
      <LoginCard
        onLogin={auth.signInWithGoogle}
        isAuthenticating={auth.isAuthenticating}
        allowGuests={ALLOW_GUESTS}
        onGuestLogin={() => setIsGuest(true)}
        error={auth.error}
      />
    );
  }

  if ((auth.status !== "ready" || !auth.user) && !isGuest) {
    return <NotReleased message="Unable to verify access." />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 relative isolate">
      <div
        className="absolute inset-0 opacity-10 -z-10"
        style={{
          backgroundImage: "url(/loginBackground.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <header className="flex items-center justify-between mb-6 p-4 border border-border/60 rounded-xl bg-card/70 backdrop-blur-xs flex-col gap-5 sm:flex-row">
        <div className="flex items-center gap-4">
          <Logo className="w-10 h-10 text-primary" />
          <div>
            <div className="font-bold text-xl tracking-tight">AI Matic</div>
            <div className="text-muted-foreground text-sm flex items-center gap-2">
              <User className="w-3 h-3" />
              Signed in as {userEmail}
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="border-border/60 text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 mr-2" />
            ) : (
              <Moon className="w-4 h-4 mr-2" />
            )}
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
          <Button
            variant={missingServices.length > 0 ? "destructive" : "outline"}
            size="sm"
            onClick={() => setShowKeyPanel((v) => !v)}
            className={
              missingServices.length > 0
                ? "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                : "border-border/60 text-foreground hover:bg-accent hover:text-accent-foreground"
            }
          >
            <Settings className="w-4 h-4 mr-2" />
            Profile / API keys
            {missingServices.length > 0 && (
              <Badge variant="destructive" className="ml-2 px-1.5 py-0.5 h-5">
                {missingServices.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (isGuest) {
                setIsGuest(false);
              } else {
                auth.signOut();
              }
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </header>

      {missingServices.length > 0 && !showKeyPanel && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-red-400">
              {missingServices.length === 1
                ? "Missing API key"
                : "Missing API keys"}
            </div>
            <div className="text-sm text-red-300/80">
              Please add: {missingServices.join(", ")}
            </div>
            {keysError && (
              <div className="text-amber-400 mt-1.5 text-xs">{keysError}</div>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => setShowKeyPanel(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold border-none"
          >
            Open settings
          </Button>
        </div>
      )}

      {showKeyPanel && (
        <ApiKeysManager
          userId={isGuest ? "guest" : auth.user?.id ?? ""}
          onKeysUpdated={refreshKeyStatus}
        />
      )}

      <Dashboard
        mode={mode}
        setMode={setMode}
        useTestnet={useTestnet}
        setUseTestnet={setUseTestnet}
        bot={bot}
      />
    </div>
  );
}
