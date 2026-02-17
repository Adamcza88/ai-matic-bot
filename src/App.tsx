import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "./types";
import { useTradingBot } from "./hooks/useTradingBot";
import Dashboard from "./components/Dashboard";
import LoginCard from "./components/LoginCard";
import NotReleased from "./components/NotReleased";
import { SERVICE_OPTIONS } from "./components/ApiKeysManager";
import { useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/supabaseClient";

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
    return false;
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
    if (have.has("bybit testnet api key")) {
      have.add("bybit demo api key");
    }
    if (have.has("bybit testnet api secret")) {
      have.add("bybit demo api secret");
    }
    const missing = SERVICE_OPTIONS.filter((opt) => !have.has(opt.value)).map(
      (opt) => opt.label
    );
    setMissingServices(missing);
  }, [auth.user]);

  useEffect(() => {
    if (auth.status === "ready" && auth.user) {
      void refreshKeyStatus();
    }
  }, [auth.status, auth.user, refreshKeyStatus]);

  const missingMainnet = useMemo(
    () => missingServices.some((s) => s.toLowerCase().includes("mainnet")),
    [missingServices]
  );
  const missingDemo = useMemo(
    () => missingServices.some((s) => s.toLowerCase().includes("demo")),
    [missingServices]
  );
  const envAvailability = useMemo(
    () => ({
      canUseMainnet: !missingMainnet,
      canUseDemo: !missingDemo,
      mainnetReason: missingMainnet ? "Missing mainnet API keys" : undefined,
      demoReason: missingDemo ? "Missing demo API keys" : undefined,
    }),
    [missingDemo, missingMainnet]
  );

  useEffect(() => {
    const currentMissingMainnet = missingServices.some((s) =>
      s.toLowerCase().includes("mainnet")
    );
    if (!useTestnet && currentMissingMainnet) {
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

  const handleSignOut = () => {
    if (isGuest) {
      setIsGuest(false);
      return;
    }
    auth.signOut();
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative isolate app-shell tva-dashboard">
      <div
        className="absolute inset-0 opacity-10 -z-10 app-shell-bg-art"
        style={{
          backgroundImage: "url(/loginBackground.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      <Dashboard
        mode={mode}
        setMode={setMode}
        useTestnet={useTestnet}
        setUseTestnet={setUseTestnet}
        theme={theme}
        envAvailability={envAvailability}
        bot={bot}
        userEmail={userEmail}
        isGuest={isGuest}
        missingServices={missingServices}
        keysError={keysError}
        onSignOut={handleSignOut}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        apiKeysUserId={isGuest ? "guest" : auth.user?.id ?? ""}
        onKeysUpdated={() => {
          void refreshKeyStatus();
        }}
      />
    </div>
  );
}
