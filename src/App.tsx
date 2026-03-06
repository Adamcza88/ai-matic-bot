import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "./types";
import { useTradingBot } from "./hooks/useTradingBot";
import Dashboard from "./components/Dashboard";
import LoginCard from "./components/LoginCard";
import NotReleased from "./components/NotReleased";
import { SERVICE_OPTIONS } from "./components/ApiKeysManager";
import { useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/supabaseClient";
import { UI_COPY } from "./lib/uiCopy";
import { Button } from "./components/ui/button";

// Guest mode je povolen, pokud explicitně nenastavíme VITE_ALLOW_GUESTS="false"
const ALLOW_GUESTS = import.meta.env.VITE_ALLOW_GUESTS !== "false";
const DEFAULT_AUTO_REFRESH_MINUTES = 3;

type EnvAvailability = {
  canUseDemo: boolean;
  canUseMainnet: boolean;
  demoReason?: string;
  mainnetReason?: string;
};

type DashboardRuntimeProps = {
  appEnabled: boolean;
  setAppEnabled: (v: boolean) => void;
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  theme: "dark" | "light";
  envAvailability: EnvAvailability;
  userEmail: string;
  isGuest: boolean;
  missingServices: string[];
  keysError: string | null;
  onSignOut: () => void;
  onToggleTheme: () => void;
  apiKeysUserId: string;
  onKeysUpdated: () => void | Promise<void>;
  authToken?: string;
};

function DashboardRuntime({
  appEnabled,
  setAppEnabled,
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  theme,
  envAvailability,
  userEmail,
  isGuest,
  missingServices,
  keysError,
  onSignOut,
  onToggleTheme,
  apiKeysUserId,
  onKeysUpdated,
  authToken,
}: DashboardRuntimeProps) {
  const bot = useTradingBot(mode, useTestnet, authToken, true);

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

  return (
    <Dashboard
      appEnabled={appEnabled}
      setAppEnabled={setAppEnabled}
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
      onSignOut={onSignOut}
      onToggleTheme={onToggleTheme}
      apiKeysUserId={apiKeysUserId}
      onKeysUpdated={onKeysUpdated}
    />
  );
}

export default function App() {
  const auth = useAuth();
  const [appEnabled, setAppEnabled] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("ai-matic-app-enabled");
      if (saved !== null) return saved === "true";
    }
    return true;
  });
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
    localStorage.setItem("ai-matic-app-enabled", String(appEnabled));
  }, [appEnabled]);

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
  const [runtimeBootId, setRuntimeBootId] = useState(0);

  const userEmail = useMemo(() => {
    if (isGuest) return "Guest";
    return auth.user?.email ?? "";
  }, [auth.user, isGuest]);

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
        {UI_COPY.app.loadingSession}
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
    return <NotReleased message={UI_COPY.app.accessCheckFailed} />;
  }

  const handleSignOut = () => {
    if (isGuest) {
      setIsGuest(false);
      return;
    }
    auth.signOut();
  };

  const handleStartRuntime = () => {
    setRuntimeBootId((value) => value + 1);
    setAppEnabled(true);
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

      {appEnabled ? (
        <DashboardRuntime
          key={`runtime-${runtimeBootId}`}
          appEnabled={appEnabled}
          setAppEnabled={setAppEnabled}
          mode={mode}
          setMode={setMode}
          useTestnet={useTestnet}
          setUseTestnet={setUseTestnet}
          theme={theme}
          envAvailability={envAvailability}
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
          authToken={auth.session?.access_token}
        />
      ) : (
        <div className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center justify-center px-4">
          <section className="w-full rounded-2xl border border-border/70 bg-card/90 p-6 text-center shadow-[0_8px_24px_-14px_rgba(0,0,0,0.65)]">
            <h2 className="text-xl font-semibold">Aplikace je vypnutá</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Hlavní vypínač zastavil všechny procesy a requesty.
            </p>
            <div className="mt-5 flex justify-center">
              <Button
                type="button"
                size="lg"
                onClick={handleStartRuntime}
                className="h-11 px-6 text-sm font-semibold"
              >
                Spustit aplikaci
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
