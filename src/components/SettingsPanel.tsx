import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Symbol } from "../api/types";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols } from "../constants/symbols";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose: () => void;
}

type CheatBlock = { title?: string; lines: string[] };

const IMAGE_LINE = /^!\[Image\]\((.+)\)$/;
const KEYCAP_HEADING = /^[0-9]\uFE0F?\u20E3/;
const PROFILE_SETTINGS_STORAGE_KEY = "ai-matic-profile-settings";
const MAX_OPEN_POSITIONS_CAP = 100;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * 4;
const MIN_AUTO_REFRESH_MINUTES = 1;
const DEFAULT_AUTO_REFRESH_MINUTES = 3;
const ORDER_VALUE_NOTE =
  "Order value & leverage: BTC/ETH/SOL 10k@100x; ADA/XRP/DOGE/XPLUS/HYPE/FART 7.5k@75x; LINK 5k@50x; XMR 2.5k@25x; MELANIA 2k@20x; margin cost 100 USDT.";

type ProfileSettingsMap = Partial<Record<AISettings["riskMode"], AISettings>>;

function loadProfileSettingsMap(): ProfileSettingsMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProfileSettingsMap;
  } catch {
    return {};
  }
}

function persistProfileSettingsMap(map: ProfileSettingsMap) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function isHeadingLine(line: string) {
  return (
    KEYCAP_HEADING.test(line) ||
    /^\d+\)/.test(line) ||
    /^[A-Z]\)/.test(line) ||
    /^[A-Z]\s[-–]/.test(line) ||
    line.startsWith("KROK ") ||
    line.startsWith("ROZHODOVACÍ STROM") ||
    line.startsWith("RODINA ") ||
    line.startsWith("CHEAT-SHEET") ||
    line.startsWith("CHECKLIST") ||
    line.startsWith("RYCHLÁ PAMĚŤOVKA") ||
    line.startsWith("VIZUÁLNÍ ZKRATKA") ||
    line.startsWith("JAK S TÍM PRACOVAT") ||
    line.startsWith("FINÁLNÍ PRINCIP") ||
    line.startsWith("PROVOZNÍ")
  );
}

function buildCheatBlocks(notes: string[]): CheatBlock[] {
  const blocks: CheatBlock[] = [];
  let current: CheatBlock = { lines: [] };
  for (const line of notes) {
    if (isHeadingLine(line)) {
      if (current.title || current.lines.length) blocks.push(current);
      current = { title: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.length) blocks.push(current);
  return blocks;
}

function extractImageUrl(line: string): string | null {
  const match = line.match(IMAGE_LINE);
  return match?.[1] ?? null;
}

function compactLine(line: string, maxLen = 140): string {
  let text = line;
  text = text.replace(/^CO TO ZNAMENÁ:\s*/i, "CO: ");
  text = text.replace(/^JAK TO POZNÁŠ[^:]*:\s*/i, "VIDÍŠ: ");
  text = text.replace(/^JAK TO VIDÍŠ:\s*/i, "VIDÍŠ: ");
  text = text.replace(/^JAK TO URČÍŠ:\s*/i, "URČÍŠ: ");
  text = text.replace(/^CO DĚLÁŠ:\s*/i, "AKCE: ");
  text = text.replace(/^SIGNÁLY:\s*/i, "SIGNÁLY: ");
  text = text.replace(/^.*?NA CO SI DÁT POZOR:\s*/i, "POZOR: ");
  text = text.replace(/^.*?NEJDŮLEŽITĚJŠÍ:\s*/i, "POINT: ");
  if (text.length > maxLen) return `${text.slice(0, maxLen - 1)}…`;
  return text;
}

const SettingsPanel: React.FC<Props> = ({ settings, onUpdateSettings, onClose }) => {
  const [local, setLocal] = useState(settings);
  const [compactCheatSheet, setCompactCheatSheet] = useState(true);
  const profileSettingsRef = useRef<ProfileSettingsMap>(
    loadProfileSettingsMap()
  );

  useEffect(() => {
    setLocal(settings);
  }, [settings]);
  const tzLabel = (() => {
    const off = new Date().getTimezoneOffset(); // CET: -60, CEST: -120
    if (off === -60) return "SEČ";
    if (off === -120) return "SELČ";
    return "lokální čas";
  })();

  const tradingWindowLabel =
    local.riskMode === "ai-matic-scalp"
      ? "08:00–12:00 / 13:00–17:00 (UTC)"
      : `${String(local.tradingStartHour).padStart(2, "0")}:00–${String(
          local.tradingEndHour
        ).padStart(2, "0")}:00 (${tzLabel})`;

  const profileCopy: Record<AISettings["riskMode"], { title: string; description: string; notes: string[] }> = {
    "ai-matic": {
      title: "AI-Matic",
      description: "TF stack (HTF 1h/15m + LTF 5m/1m) + POI analyzer (OB/FVG/Breaker/Liquidity) s prioritou.",
      notes: [
        ORDER_VALUE_NOTE,
        "HTF 1h: Určuje směr trhu. Nikdy neobchoduj proti němu.",
        "HTF 15m: Sleduj mini OB, přesnější korekce/pullbacky.",
        "LTF 5m: Vstupní patterny, potvrzení objemů, Smart Money kontext.",
        "LTF 1m: Absolutní přesnost vstupu, exekuce, správa SL/TS.",
        "FVG: 3-svíčková imbalance (priority 1)",
        "OB: poslední opačná svíčka před impulsem (priority 2)",
        "Breaker: mitigace OB + close za extremem (priority 3)",
        "Liquidity pools: equal highs/lows, tolerance 0.2 %, min 3 dotyky",
        "Swing points window: 7 (pro highs/lows)",
        "POI priorita: Breaker > OB > FVG > Liquidity",
      ],
    },
    "ai-matic-x": {
      title: "AI-Matic-X",
      description: "Decision tree: čistá struktura (1h kontext / 5m exekuce), bez EMA/ATR; RSI divergence jen pro reversal.",
      notes: [
        ORDER_VALUE_NOTE,
        "1h trend: HH/HL nebo LL/LH bez overlapu (swing 2L/2R).",
        "5m trend: impuls (>=1.2× avg range) → korekce (<=60%) → pokračování.",
        "Rodiny 1–6: pullback, continuation, range fade, break&flip, reversal, no trade.",
        "Reversal (#5): RSI divergence + CHoCH, rychlý exit (0.25–0.5R).",
        "Risk OFF: -2R denně nebo 2 ztráty po sobě nebo chop → NO TRADE.",
        "Entry: LIMIT default; MARKET jen při strong expanse; PostOnly jen v low‑vol range.",
        "Trailing: aktivace +1R, offset 0.2% (0.25% v expanzi).",
        "Max 1 pozice celkem; BTC bias musí souhlasit se všemi entry.",
      ],
    },
    "ai-matic-scalp": {
      title: "AI-MATIC-SCALP",
      description:
        "Scalp profile with 15m trend direction and 1m entry timing.",
      notes: [
        "Primary timeframe: 15m for trend, 1m for entry.",
        "Entry logic: EMA cross + RSI divergence + volume spike.",
        "Exit logic: Trailing stop (ATR 2.5x) or fixed TP (1.5 RRR).",
      ],
    },
    "ai-matic-tree": {
      title: "AI-Matic Tree (Market → Akce)",
      description:
        "Rozhodovací strom A + Rodiny C + Checklist B + Risk protokol D (Bybit Linear, 1h/5m).",
      notes: [
        ORDER_VALUE_NOTE,
        "Bybit Linear Perpetuals · kontext 1h · exekuce 5m · scan ~40 trhů",
        "Strom A: Kontext → Režim trhu → Směr → Risk ON/OFF → High/Low Prob → Akce",
        "Rodiny 1–6: Trend Pullback, Trend Continuation, Range Fade, Range→Trend, Reversal (omezeně), No Trade",
        "Checklist B: invalidace → režim → logický target → trend zdravý → čas → risk off → hold",
        "Risk protokol: Risk ON 1R; Risk OFF 0.25R; max 5 obchodů/den; max 2 pozice",
        "Absolutní zákazy: žádné přidávání; žádná změna plánu v otevřeném obchodu",
      ],
    },
  };
  const meta = profileCopy[local.riskMode];
  const cheatBlocks = useMemo(
    () => buildCheatBlocks(meta.notes),
    [meta.notes]
  );
  const profileSummary: Record<AISettings["riskMode"], string> = {
    "ai-matic":
      "AI‑MATIC core (1h/15m/5m/1m): POI + struktura, pullbacky a řízení přes R‑multiple.",
    "ai-matic-x":
      "AI‑MATIC‑X (1h/5m): decision tree, čistá struktura, max 1 pozice celkem.",
    "ai-matic-scalp":
      "AI-MATIC-SCALP (15m/1m): EMA cross + RSI divergence + volume spike; exit via ATR 2.5x or TP 1.5 RRR.",
    "ai-matic-tree":
      "AI‑MATIC‑TREE (1h/5m): decision‑tree overlay nad AI‑MATIC core enginem.",
  };
  const checklistGatesByProfile: Record<AISettings["riskMode"], string[]> = {
    "ai-matic": ["Trend bias"],
    "ai-matic-x": ["X setup"],
    "ai-matic-tree": ["Tree setup"],
    "ai-matic-scalp": [
      "TP1 >= min",
      "1h bias",
      "15m context",
      "Chop filter",
      "Level defined",
      "Maker entry",
      "SL structural",
      "BE+ / time stop",
    ],
  };
  const activeGateNames =
    checklistGatesByProfile[local.riskMode] ?? checklistGatesByProfile["ai-matic"];
  const statusItems = [
    {
      label: "Cheat Sheet",
      value: local.strategyCheatSheetEnabled ? "On" : "Off",
    },
    { label: "Hard gates", value: local.enableHardGates ? "On" : "Off" },
    { label: "Soft gates", value: local.enableSoftGates ? "On" : "Off" },
    { label: "Strict risk", value: local.strictRiskAdherence ? "On" : "Off" },
    { label: "Max daily loss", value: local.haltOnDailyLoss ? "On" : "Off" },
    { label: "Max drawdown", value: local.haltOnDrawdown ? "On" : "Off" },
    {
      label: "Trading hours",
      value: local.enforceSessionHours
        ? tradingWindowLabel
        : `Off (${tzLabel})`,
    },
    {
      label: "Auto-refresh",
      value: local.autoRefreshEnabled
        ? `${local.autoRefreshMinutes}m`
        : "Off",
    },
    { label: "Trend gate", value: local.trendGateMode },
    { label: "Max pos", value: String(local.maxOpenPositions) },
    { label: "Max orders", value: String(local.maxOpenOrders) },
    { label: "Symbols", value: local.selectedSymbols.join(", ") },
  ];

  const AI_MATIC_PRESET_UI: AISettings = {
    riskMode: "ai-matic",
    trendGateMode: "adaptive",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 3,
    maxOpenOrders: 12,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const AI_MATIC_X_PRESET_UI: AISettings = {
    riskMode: "ai-matic-x",
    trendGateMode: "adaptive",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    baseRiskPerTrade: 0.005,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 1,
    maxOpenOrders: 4,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const AI_MATIC_SCALP_PRESET_UI: AISettings = {
    riskMode: "ai-matic-scalp",
    trendGateMode: "adaptive",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    baseRiskPerTrade: 0.01,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 3,
    maxOpenOrders: 12,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "ultra",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
    tradingStartHour: 8,
    tradingEndHour: 17,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const AI_MATIC_TREE_PRESET_UI: AISettings = {
    riskMode: "ai-matic-tree",
    trendGateMode: "adaptive",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    baseRiskPerTrade: 0.01,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    maxOpenOrders: 8,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "base",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const presets: Record<AISettings["riskMode"], AISettings> = {
    "ai-matic": AI_MATIC_PRESET_UI,
    "ai-matic-x": AI_MATIC_X_PRESET_UI,
    "ai-matic-scalp": AI_MATIC_SCALP_PRESET_UI,
    "ai-matic-tree": AI_MATIC_TREE_PRESET_UI,
  };

  const stashProfileSettings = (
    mode: AISettings["riskMode"],
    next: AISettings
  ) => {
    profileSettingsRef.current = {
      ...profileSettingsRef.current,
      [mode]: next,
    };
    persistProfileSettingsMap(profileSettingsRef.current);
  };

  const resolveProfileSettings = (mode: AISettings["riskMode"]) => {
    const preset = presets[mode];
    const saved = profileSettingsRef.current[mode];
    if (!saved) return preset;
    const merged: AISettings = { ...preset, ...saved, riskMode: mode };
    if (!Array.isArray(merged.tradingDays)) {
      merged.tradingDays = preset.tradingDays;
    }
    if (!Number.isFinite(merged.maxOpenPositions)) {
      merged.maxOpenPositions = preset.maxOpenPositions;
    } else {
      merged.maxOpenPositions = Math.min(
        MAX_OPEN_POSITIONS_CAP,
        Math.max(0, Math.round(merged.maxOpenPositions))
      );
    }
    if (!Number.isFinite(merged.maxOpenOrders)) {
      merged.maxOpenOrders = preset.maxOpenOrders;
    } else {
      merged.maxOpenOrders = Math.min(
        MAX_OPEN_ORDERS_CAP,
        Math.max(0, Math.round(merged.maxOpenOrders))
      );
    }
    if (!Number.isFinite(merged.autoRefreshMinutes)) {
      merged.autoRefreshMinutes = preset.autoRefreshMinutes;
    } else {
      merged.autoRefreshMinutes = Math.max(
        MIN_AUTO_REFRESH_MINUTES,
        Math.round(merged.autoRefreshMinutes)
      );
    }
    if (!Number.isFinite(merged.makerFeePct) || merged.makerFeePct < 0) {
      merged.makerFeePct = preset.makerFeePct;
    }
    if (!Number.isFinite(merged.takerFeePct) || merged.takerFeePct < 0) {
      merged.takerFeePct = preset.takerFeePct;
    }
    if (!Number.isFinite(merged.slippageBufferPct) || merged.slippageBufferPct < 0) {
      merged.slippageBufferPct = preset.slippageBufferPct;
    }
    const selectedSymbols = filterSupportedSymbols(merged.selectedSymbols);
    merged.selectedSymbols =
      selectedSymbols.length > 0
        ? selectedSymbols
        : [...preset.selectedSymbols];
    return merged;
  };

  const applyPreset = (mode: AISettings["riskMode"]) => {
    stashProfileSettings(local.riskMode, local);
    setLocal(resolveProfileSettings(mode));
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Settings
          </h2>
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Strategie (aktuální stav)
            </div>
            <div>{profileSummary[local.riskMode]}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
              {statusItems.map((item) => (
                <span
                  key={item.label}
                  className="rounded-full border border-slate-800 bg-slate-950/40 px-2 py-0.5"
                >
                  {item.label}: {item.value}
                </span>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Zvolený profil nastaví výchozí parametry; vybrané podmínky můžeš přepnout.
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Profile
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => applyPreset("ai-matic")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic
              </button>
              <button
                onClick={() => applyPreset("ai-matic-x")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-x"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-X
              </button>
              <button
                onClick={() => applyPreset("ai-matic-scalp")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-scalp"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-Scalp
              </button>
              <button
                onClick={() => applyPreset("ai-matic-tree")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-tree"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-Tree
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Enforce Trading Hours
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{local.enforceSessionHours ? "On" : "Off"}</div>
                <div className="text-xs text-secondary-foreground/70 mt-1">
                  {local.enforceSessionHours ? tradingWindowLabel : `Vypnuto (${tzLabel})`}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setLocal({
                    ...local,
                    enforceSessionHours: !local.enforceSessionHours,
                  })
                }
                className={`rounded-md border px-3 py-1 text-sm ${
                  local.enforceSessionHours
                    ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                    : "border-slate-700 bg-slate-900/40 text-slate-200"
                }`}
              >
                {local.enforceSessionHours ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Auto-refresh
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
              <div>
                <div className="font-medium">
                  {local.autoRefreshEnabled ? "On" : "Off"}
                </div>
                <div className="text-xs text-secondary-foreground/70 mt-1">
                  Obnoví aplikaci každých {local.autoRefreshMinutes} min.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_AUTO_REFRESH_MINUTES}
                  step={1}
                  value={local.autoRefreshMinutes}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setLocal({
                      ...local,
                      autoRefreshMinutes: Number.isFinite(next)
                        ? Math.max(
                            MIN_AUTO_REFRESH_MINUTES,
                            Math.round(next)
                          )
                        : DEFAULT_AUTO_REFRESH_MINUTES,
                    });
                  }}
                  className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-200"
                />
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      autoRefreshEnabled: !local.autoRefreshEnabled,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.autoRefreshEnabled
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.autoRefreshEnabled ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Gates
            </label>
            <div className="grid gap-2">
              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Hard podmínky</div>
                  <div className="text-xs text-secondary-foreground/70 mt-1">
                    Přísné blokace vstupu (spread hard, impulse, stale BBO).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      enableHardGates: !local.enableHardGates,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.enableHardGates
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.enableHardGates ? "On" : "Off"}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Soft podmínky</div>
                  <div className="text-xs text-secondary-foreground/70 mt-1">
                    Jemné snížení risku podle quality score.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      enableSoftGates: !local.enableSoftGates,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.enableSoftGates
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.enableSoftGates ? "On" : "Off"}
                </button>
              </div>
              <div className="rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
                <div className="text-xs text-secondary-foreground/70">Checklist gates</div>
                <div className="mt-1 text-secondary-foreground">
                  {activeGateNames.join(" · ")}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Risk Stops
            </label>
            <div className="grid gap-2">
              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Strict risk adherence</div>
                  <div className="text-xs text-secondary-foreground/70 mt-1">
                    Vynucuje risk protokol: R limit (max ztráta v R), povinné stopky a žádné obcházení pravidel.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      strictRiskAdherence: !local.strictRiskAdherence,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.strictRiskAdherence
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.strictRiskAdherence ? "On" : "Off"}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Max daily loss gate</div>
                  <div className="text-xs text-secondary-foreground/70 mt-1">
                    Blokuje vstupy po dosažení denní ztráty.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      haltOnDailyLoss: !local.haltOnDailyLoss,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.haltOnDailyLoss
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.haltOnDailyLoss ? "On" : "Off"}
                </button>
              </div>

              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Max drawdown gate</div>
                  <div className="text-xs text-secondary-foreground/70 mt-1">
                    Blokuje vstupy po překročení max drawdownu.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setLocal({
                      ...local,
                      haltOnDrawdown: !local.haltOnDrawdown,
                    })
                  }
                  className={`rounded-md border px-3 py-1 text-sm ${
                    local.haltOnDrawdown
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-200"
                  }`}
                >
                  {local.haltOnDrawdown ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>


          {local.riskMode !== "ai-matic-scalp" ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Trend Gate Mode
              </label>
              <div className="rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm space-y-2">
                <select
                  value={local.trendGateMode}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      trendGateMode: e.target.value as AISettings["trendGateMode"],
                    })
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                >
                  <option value="adaptive">Adaptive</option>
                  <option value="follow">Follow</option>
                  <option value="reverse">Reverse</option>
                </select>
                <div className="text-xs text-secondary-foreground/70">
                  Trend Gate filtruje vstupy podle směru trendu z HTF 1h. Adaptive: přepíná Follow/Reverse podle síly trendu (ADX/score); Reverse jen při slabém trendu a mean‑reversion signálu. Follow: pouze se směrem 1h trendu.
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Cheat Sheet
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{local.strategyCheatSheetEnabled ? "On" : "Off"}</div>
                <div className="text-xs text-secondary-foreground/70 mt-1">
                  Prioritize saved entry setups (Limit/Conditional).
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setLocal({
                    ...local,
                    strategyCheatSheetEnabled: !local.strategyCheatSheetEnabled,
                  })
                }
                className={`rounded-md border px-3 py-1 text-sm ${
                  local.strategyCheatSheetEnabled
                    ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                    : "border-slate-700 bg-slate-900/40 text-slate-200"
                }`}
              >
                {local.strategyCheatSheetEnabled ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Max Positions
            </label>
            <div className="flex items-center gap-3 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
              <input
                type="number"
                min={0}
                max={MAX_OPEN_POSITIONS_CAP}
                step={1}
                value={local.maxOpenPositions}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  setLocal({
                    ...local,
                    maxOpenPositions: Number.isFinite(next)
                      ? Math.min(
                          MAX_OPEN_POSITIONS_CAP,
                          Math.max(0, Math.round(next))
                        )
                      : 0,
                  });
                }}
                className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              />
              <span className="text-xs text-secondary-foreground/70">
                0-100 pozic (0 = žádná pozice)
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Max Orders
            </label>
            <div className="flex items-center gap-3 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
              <input
                type="number"
                min={0}
                max={MAX_OPEN_ORDERS_CAP}
                step={1}
                value={local.maxOpenOrders}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  setLocal({
                    ...local,
                    maxOpenOrders: Number.isFinite(next)
                      ? Math.min(
                          MAX_OPEN_ORDERS_CAP,
                          Math.max(0, Math.round(next))
                        )
                      : 0,
                  });
                }}
                className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              />
              <span className="text-xs text-secondary-foreground/70">
                0-{MAX_OPEN_ORDERS_CAP} orderů (0 = žádná objednávka)
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Trading Symbols
            </label>
            <div className="flex flex-wrap gap-2 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
              {SUPPORTED_SYMBOLS.map((symbol) => {
                const active = local.selectedSymbols.includes(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => {
                      const next = new Set<Symbol>(local.selectedSymbols);
                      if (next.has(symbol)) {
                        if (next.size === 1) return;
                        next.delete(symbol);
                      } else {
                        next.add(symbol);
                      }
                      setLocal({
                        ...local,
                        selectedSymbols: SUPPORTED_SYMBOLS.filter((s) =>
                          next.has(s)
                        ),
                      });
                    }}
                    className={`rounded-md border px-3 py-1 text-xs font-medium ${
                      active
                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                        : "border-slate-700 bg-slate-900/40 text-slate-200"
                    }`}
                  >
                    {symbol}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-secondary-foreground/70">
              Vyber, které coiny bot skenuje a obchoduje.
            </span>
          </div>

          <div className="mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2">
            <div className="font-semibold text-white">{meta.title}</div>
            <div className="text-slate-300">{meta.description}</div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <div>
                View: {compactCheatSheet ? "Compact" : "Detail"}
              </div>
              <button
                type="button"
                onClick={() => setCompactCheatSheet((v) => !v)}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  compactCheatSheet
                    ? "border-slate-700 bg-slate-900/60 text-slate-200"
                    : "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                }`}
              >
                {compactCheatSheet ? "Compact" : "Detail"}
              </button>
            </div>
            <div className="space-y-3 text-slate-400">
              {cheatBlocks.map((block, blockIndex) => {
                const rawLines = compactCheatSheet
                  ? block.lines.filter((line) => !extractImageUrl(line))
                  : block.lines;
                const visibleLines = compactCheatSheet
                  ? rawLines.slice(0, 3)
                  : rawLines;
                const hiddenCount = rawLines.length - visibleLines.length;
                return (
                  <div
                    key={`${block.title ?? "block"}-${blockIndex}`}
                    className={
                      block.title
                        ? "rounded-md border border-slate-800 bg-slate-950/40 p-2"
                        : ""
                    }
                  >
                    {block.title ? (
                      <div className="text-[11px] uppercase tracking-wide text-slate-300">
                        {block.title}
                      </div>
                    ) : null}
                    <ul className="mt-1 space-y-1 text-xs leading-relaxed">
                      {visibleLines.map((line, lineIndex) => {
                        const imageUrl = extractImageUrl(line);
                        if (imageUrl) {
                          const host = imageUrl
                            .replace(/^https?:\/\//, "")
                            .split("/")[0];
                          return (
                            <li key={`${blockIndex}-${lineIndex}`}>
                              <a
                                href={imageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-300 underline underline-offset-2"
                              >
                                Image reference ({host})
                              </a>
                            </li>
                          );
                        }
                        return (
                          <li key={`${blockIndex}-${lineIndex}`}>
                            {compactCheatSheet ? compactLine(line) : line}
                          </li>
                        );
                      })}
                    </ul>
                    {compactCheatSheet && hiddenCount > 0 ? (
                      <div className="mt-1 text-[11px] text-slate-500">
                        +{hiddenCount} dalších
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          <div className="text-xs text-slate-500">
            Parametry: Hours {local.enforceSessionHours ? tradingWindowLabel : `Off (${tzLabel})`} • Max positions{" "}
            {local.maxOpenPositions} • Max orders {local.maxOpenOrders}
          </div>
        </div>
      </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end mt-6">
          <button
            type="button"
            onClick={() => {
              stashProfileSettings(local.riskMode, local);
              onUpdateSettings(local);
              onClose();
            }}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-500 h-10 px-4 py-2 w-full sm:w-auto"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
