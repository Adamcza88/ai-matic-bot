import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type ApiKeyRow = {
  id?: string;
  service: string;
  api_key: string;
  updated_at?: string;
};

type Props = {
  userId: string;
  onKeysUpdated?: () => void;
};

export const SERVICE_OPTIONS = [
  { value: "bybit api key", label: "Bybit API Key" },
  { value: "bybit api secret", label: "Bybit API Secret" },
  { value: "cryptopanic api key", label: "Cryptopanic API Key" },
];

export default function ApiKeysManager({ userId, onKeysUpdated }: Props) {
  const [records, setRecords] = useState<ApiKeyRow[]>([]);
  const [service, setService] = useState(SERVICE_OPTIONS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const maskedRecords = useMemo(
    () =>
      records.map((row) => ({
        ...row,
        masked:
          row.api_key?.length > 4
            ? `•••• ${row.api_key.slice(-4)}`
            : "••••",
      })),
    [records]
  );

  useEffect(() => {
    const fetchKeys = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("id, service, api_key, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        setStatus(error.message);
      } else if (data) {
        setRecords(data);
      }
      setIsLoading(false);
    };

    fetchKeys();
  }, [userId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!service.trim() || !apiKey.trim()) {
      setStatus("Service name and key are required.");
      return;
    }
    setIsSaving(true);
    setStatus(null);

    const payload = {
      user_id: userId,
      service: service.trim(),
      api_key: apiKey.trim(),
    };

    const { error } = await supabase
      .from("user_api_keys")
      .upsert(payload, { onConflict: "user_id,service" });

    if (error) {
      setStatus(error.message);
    } else {
      setStatus("Key saved.");
      setApiKey("");
      const refreshed = await supabase
        .from("user_api_keys")
        .select("id, service, api_key, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (!refreshed.error && refreshed.data) {
        setRecords(refreshed.data);
      }
    }
    setIsSaving(false);

    onKeysUpdated?.();
  };

  return (
    <section
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "16px",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
          gap: "12px",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>API Keys</h3>
          <p style={{ margin: "4px 0", color: "rgba(255,255,255,0.7)" }}>
            Stored securely per account. Only you can read your keys.
          </p>
        </div>
        {isLoading && (
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px" }}>
            Loading...
          </span>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          style={{
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.35)",
            color: "white",
          }}
        >
          {SERVICE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Secret value"
          style={{
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.35)",
            color: "white",
          }}
        />
        <button
          type="submit"
          disabled={isSaving}
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            border: "none",
            background: "#22c55e",
            color: "#0b0f1a",
            fontWeight: 700,
            cursor: "pointer",
            opacity: isSaving ? 0.85 : 1,
          }}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </form>

      {status && (
        <p style={{ color: "#fbbf24", marginTop: 0, marginBottom: "10px" }}>
          {status}
        </p>
      )}

      {maskedRecords.length === 0 ? (
        <p style={{ color: "rgba(255,255,255,0.7)", margin: 0 }}>
          No keys saved yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {maskedRecords.map((row) => (
            <li
              key={row.id ?? row.service}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{row.service}</div>
                <div style={{ color: "rgba(255,255,255,0.7)" }}>
                  {row.masked}
                </div>
              </div>
              {row.updated_at && (
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                  Updated {new Date(row.updated_at).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
