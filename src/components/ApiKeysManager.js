import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card";
import { Loader2, Save, Key } from "lucide-react";
export const SERVICE_OPTIONS = [
    { value: "bybit demo api key", label: "Bybit Demo API Key" },
    { value: "bybit demo api secret", label: "Bybit Demo API Secret" },
    { value: "bybit mainnet api key", label: "Bybit Mainnet API Key" },
    { value: "bybit mainnet api secret", label: "Bybit Mainnet API Secret" },
    { value: "bybit testnet api key", label: "Bybit Testnet API Key (legacy)" },
    { value: "bybit testnet api secret", label: "Bybit Testnet API Secret (legacy)" },
    // legacy fallback
    { value: "bybit api key", label: "Bybit API Key (legacy)" },
    { value: "bybit api secret", label: "Bybit API Secret (legacy)" },
    { value: "cryptopanic api key", label: "Cryptopanic API Key" },
];
export default function ApiKeysManager({ userId, onKeysUpdated }) {
    const [records, setRecords] = useState([]);
    const [service, setService] = useState(SERVICE_OPTIONS[0].value);
    const [apiKey, setApiKey] = useState("");
    const [status, setStatus] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const maskedRecords = useMemo(() => records.map((row) => ({
        ...row,
        masked: row.api_key?.length > 4
            ? `•••• ${row.api_key.slice(-4)}`
            : "••••",
    })), [records]);
    useEffect(() => {
        const fetchKeys = async () => {
            setIsLoading(true);
            if (userId === "guest") {
                const stored = localStorage.getItem("guest_api_keys");
                if (stored) {
                    try {
                        setRecords(JSON.parse(stored));
                    }
                    catch (e) {
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
            }
            else if (data) {
                setRecords(data);
            }
            setIsLoading(false);
        };
        fetchKeys();
    }, [userId]);
    const onSubmit = async (event) => {
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
            let currentKeys = stored ? JSON.parse(stored) : [];
            // Remove existing key for this service if any
            currentKeys = currentKeys.filter((k) => k.service !== payload.service);
            // Add new key
            const newKey = {
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
        }
        else {
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
    return (_jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white mb-6", children: [_jsx(CardHeader, { children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(Key, { className: "w-5 h-5 text-emerald-500" }), "API Keys"] }), _jsx(CardDescription, { className: "text-slate-400", children: "Stored securely per account. Only you can read your keys." })] }), isLoading && (_jsxs("div", { className: "flex items-center text-slate-400 text-sm", children: [_jsx(Loader2, { className: "w-4 h-4 mr-2 animate-spin" }), "Loading..."] }))] }) }), _jsxs(CardContent, { children: [_jsxs("form", { onSubmit: onSubmit, className: "flex flex-col md:flex-row gap-4 mb-6", children: [_jsx("div", { className: "flex-1 min-w-[200px]", children: _jsxs(Select, { value: service, onValueChange: setService, children: [_jsx(SelectTrigger, { className: "bg-slate-950 border-white/10 text-white", children: _jsx(SelectValue, { placeholder: "Select service" }) }), _jsx(SelectContent, { className: "bg-slate-900 border-white/10 text-white", children: SERVICE_OPTIONS.map((opt) => (_jsx(SelectItem, { value: opt.value, className: "focus:bg-slate-800 focus:text-white", children: opt.label }, opt.value))) })] }) }), _jsx("div", { className: "flex-2", children: _jsx(Input, { value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: "Secret value", className: "bg-slate-950 border-white/10 text-white placeholder:text-slate-500" }) }), _jsx(Button, { type: "submit", disabled: isSaving, className: "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold min-w-[100px]", children: isSaving ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "w-4 h-4 mr-2 animate-spin" }), "Saving"] })) : (_jsxs(_Fragment, { children: [_jsx(Save, { className: "w-4 h-4 mr-2" }), "Save"] })) })] }), status && (_jsx("div", { className: "mb-4 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm", children: status })), maskedRecords.length === 0 ? (_jsx("div", { className: "text-center py-8 text-slate-500 italic border border-dashed border-slate-800 rounded-lg", children: "No keys saved yet." })) : (_jsx("div", { className: "rounded-md border border-white/10 overflow-hidden", children: _jsx("ul", { className: "divide-y divide-white/10", children: maskedRecords.map((row) => (_jsxs("li", { className: "flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors gap-2", children: [_jsxs("div", { children: [_jsx("div", { className: "font-semibold text-white", children: row.service }), _jsx("div", { className: "text-slate-400 font-mono text-sm", children: row.masked })] }), row.updated_at && (_jsxs("span", { className: "text-xs text-slate-500", children: ["Updated ", new Date(row.updated_at).toLocaleDateString()] }))] }, row.id ?? row.service))) }) }))] })] }));
}
