import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Save, Key } from "lucide-react";

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
  { value: "bybit demo api key", label: "Bybit Demo API Key" },
  { value: "bybit demo api secret", label: "Bybit Demo API Secret" },
  { value: "bybit mainnet api key", label: "Bybit Mainnet API Key" },
  { value: "bybit mainnet api secret", label: "Bybit Mainnet API Secret" },
  // legacy fallback
  { value: "bybit api key", label: "Bybit API Key (legacy)" },
  { value: "bybit api secret", label: "Bybit API Secret (legacy)" },
  { value: "cryptopanic api key", label: "Cryptopanic API Key" },
];

const LEGACY_SERVICE_LABELS: Record<string, string> = {
  "bybit testnet api key": "Bybit Demo API Key (legacy)",
  "bybit testnet api secret": "Bybit Demo API Secret (legacy)",
};

export default function ApiKeysManager({ userId, onKeysUpdated }: Props) {
  const [records, setRecords] = useState<ApiKeyRow[]>([]);
  const [service, setService] = useState(SERVICE_OPTIONS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const maskedRecords = useMemo(() => {
    const labelMap = new Map(
      SERVICE_OPTIONS.map((entry) => [entry.value, entry.label])
    );
    return records.map((row) => ({
      ...row,
      label:
        labelMap.get(row.service) ??
        LEGACY_SERVICE_LABELS[row.service] ??
        row.service,
      masked:
        row.api_key?.length > 4
          ? `•••• ${row.api_key.slice(-4)}`
          : "••••",
    }));
  }, [records]);

  useEffect(() => {
    const fetchKeys = async () => {
      setIsLoading(true);

      if (userId === "guest") {
        const stored = localStorage.getItem("guest_api_keys");
        if (stored) {
          try {
            setRecords(JSON.parse(stored));
          } catch (e) {
            console.error("Failed to parse guest keys", e);
          }
        }
        setIsLoading(false);
        return;
      }

      if (!supabase) {
        setStatus("Supabase není nakonfigurované. Nastav VITE_SUPABASE_URL a VITE_SUPABASE_ANON_KEY.");
        setIsLoading(false);
        return;
      }

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

    if (userId === "guest") {
      // LocalStorage logic
      const stored = localStorage.getItem("guest_api_keys");
      let currentKeys: ApiKeyRow[] = stored ? JSON.parse(stored) : [];

      // Remove existing key for this service if any
      currentKeys = currentKeys.filter((k) => k.service !== payload.service);

      // Add new key
      const newKey: ApiKeyRow = {
        ...payload,
        updated_at: new Date().toISOString(),
      };
      currentKeys.push(newKey);

      localStorage.setItem("guest_api_keys", JSON.stringify(currentKeys));

      setStatus("Key saved (Guest mode).");
      setApiKey("");
      setRecords(currentKeys);
      setIsSaving(false);
      onKeysUpdated?.();
      return;
    }

    if (!supabase) {
      setStatus("Supabase není nakonfigurované. Nelze uložit klíče.");
      setIsSaving(false);
      return;
    }

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
    <Card className="bg-slate-900/50 border-white/10 text-white mb-6 api-keys-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 api-keys-title">
              <Key className="w-5 h-5 text-emerald-500" />
              API Keys
            </CardTitle>
            <CardDescription className="text-slate-400 api-keys-description">
              Stored securely per account. Only you can read your keys.
            </CardDescription>
          </div>
          {isLoading && (
            <div className="flex items-center text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Loading...
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="flex flex-col md:flex-row gap-4 mb-6 api-keys-form"
        >
          <div className="flex-1 min-w-[200px]">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="bg-slate-950 border-white/10 text-white api-keys-select-trigger">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 text-white api-keys-select-content">
                {SERVICE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="focus:bg-slate-800 focus:text-white api-keys-select-item"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-2">
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Secret value"
              className="bg-slate-950 border-white/10 text-white placeholder:text-slate-500 api-keys-input"
            />
          </div>
          <Button
            type="submit"
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold min-w-[100px] api-keys-save"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </form>

        {status && (
          <div className="mb-4 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm api-keys-status">
            {status}
          </div>
        )}

        {maskedRecords.length === 0 ? (
          <div className="text-center py-8 text-slate-500 italic border border-dashed border-slate-800 rounded-lg api-keys-empty">
            No keys saved yet.
          </div>
        ) : (
          <div className="rounded-md border border-white/10 overflow-hidden api-keys-list">
            <ul className="divide-y divide-white/10">
              {maskedRecords.map((row) => (
                <li
                  key={row.id ?? row.service}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors gap-2 api-keys-item"
                >
                  <div>
                    <div className="font-semibold text-white">{row.label}</div>
                    <div className="text-slate-400 font-mono text-sm">
                      {row.masked}
                    </div>
                  </div>
                  {row.updated_at && (
                    <span className="text-xs text-slate-500">
                      Updated {new Date(row.updated_at).toLocaleDateString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
