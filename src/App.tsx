import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "./types";
import { useTradingBot } from "./hooks/useTradingBot";
import Dashboard from "./components/Dashboard";
import LoginCard from "./components/LoginCard";
import NotReleased from "./components/NotReleased";
import ApiKeysManager, { SERVICE_OPTIONS } from "./components/ApiKeysManager";
import { useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/supabaseClient";

export default function App() {
  const auth = useAuth();
  const [mode, setMode] = useState<TradingMode>(TradingMode.OFF);
  const [useTestnet, setUseTestnet] = useState(true);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [missingServices, setMissingServices] = useState<string[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);

  const bot = useTradingBot(mode, useTestnet, auth.session?.access_token);
  const userEmail = useMemo(() => auth.user?.email ?? "", [auth.user]);

  const refreshKeyStatus = useCallback(async () => {
    if (!auth.user) return;
    setKeysLoading(true);
    setKeysError(null);
    const { data, error } = await supabase
      .from("user_api_keys")
      .select("service")
      .eq("user_id", auth.user.id);

    if (error) {
      setKeysError(error.message);
      setMissingServices(SERVICE_OPTIONS.map((s) => s.label));
      setKeysLoading(false);
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
    setKeysLoading(false);
  }, [auth.user]);

  useEffect(() => {
    if (auth.status === "ready" && auth.user) {
      void refreshKeyStatus();
    }
  }, [auth.status, auth.user, refreshKeyStatus]);

  if (auth.status === "checking") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1224",
          color: "white",
        }}
      >
        Loading session...
      </div>
    );
  }

  if (auth.status === "blocked") {
    return <NotReleased message={auth.error} />;
  }

  if (auth.status === "signed_out") {
    return (
      <LoginCard
        onLogin={auth.signInWithGoogle}
        isAuthenticating={auth.isAuthenticating}
        error={auth.error}
      />
    );
  }

  if (auth.status !== "ready" || !auth.user) {
    return <NotReleased message="Unable to verify access." />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b1224",
        color: "white",
        padding: "20px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>AI-Matic</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px" }}>
            Signed in as {userEmail}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={() => setShowKeyPanel((v) => !v)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: missingServices.length ? "rgba(248,113,113,0.15)" : "transparent",
              color: "white",
              cursor: "pointer",
              position: "relative",
            }}
          >
            Profile / API keys
            {missingServices.length > 0 && (
              <span
                style={{
                  marginLeft: "8px",
                  background: "#ef4444",
                  color: "#0b0f1a",
                  borderRadius: "999px",
                  padding: "2px 8px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {missingServices.length}
              </span>
            )}
          </button>
          <button
            onClick={auth.signOut}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {missingServices.length > 0 && !showKeyPanel && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 14px",
            borderRadius: "10px",
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.12)",
            color: "white",
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>Chybí API klíče</div>
            <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.8)" }}>
              Doplň: {missingServices.join(", ")}
            </div>
            {keysError && (
              <div style={{ color: "#fbbf24", marginTop: "6px", fontSize: 12 }}>
                {keysError}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowKeyPanel(true)}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "none",
              background: "#22c55e",
              color: "#0b0f1a",
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Otevřít nastavení
          </button>
        </div>
      )}

      {showKeyPanel && (
        <ApiKeysManager userId={auth.user.id} onKeysUpdated={refreshKeyStatus} />
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
