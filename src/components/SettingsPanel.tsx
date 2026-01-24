import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Symbol } from "../api/types";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols } from "../constants/symbols";
import { AISettings } from "../types";
import { getCheatSheetSetup } from "../engine/strategyCheatSheet";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose: () => void;
}

type CheatBlock = { title?: string; lines: string[] };
type CoreProfile = {
  title: string;
  summary: string;
  description: string;
  notes: string[];
};

const IMAGE_LINE = /^!\[Image\]\((.+)\)$/;
const KEYCAP_HEADING = /^[0-9]\uFE0F?\u20E3/;
const PROFILE_SETTINGS_STORAGE_KEY = "ai-matic-profile-settings";
const MAX_OPEN_POSITIONS_CAP = 100;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * 4;
const MIN_AUTO_REFRESH_MINUTES = 1;
const DEFAULT_AUTO_REFRESH_MINUTES = 3;
const ORDER_VALUE_NOTE =
  "Order value & leverage: BTC/ETH/SOL 10k@100x; ADA/XRP/DOGE/XPLUS/HYPE/FART 7.5k@75x; LINK 5k@50x; XMR 2.5k@25x; MELANIA 2k@20x; margin cost 100 USDT.";
const CHEAT_SHEET_SETUP_BY_RISK_MODE: Record<AISettings["riskMode"], string> = {
  "ai-matic": "ai-matic-core",
  "ai-matic-x": "ai-matic-x-smart-money-combo",
  "ai-matic-scalp": "ai-matic-scalp-scalpera",
  "ai-matic-tree": "ai-matic-decision-tree",
};

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
  const coreProfiles: Record<AISettings["riskMode"], CoreProfile> = {
    "ai-matic": {
      title: "AI-MATIC Core",
      summary: "HTF 1h/15m · LTF 5m/1m · POI priority",
      description:
        "Core engine: multi‑TF POI (OB/FVG/Breaker/Liquidity) + EMA50 trend gate.",
      notes: [
        ORDER_VALUE_NOTE,
        "Trend gate: EMA50 + shoda HTF/LTF (1h/15m/5m).",
        "POI priorita: Breaker > OB > FVG > Liquidity.",
        "Entry: pullback/mean‑reversion jen po potvrzení struktury.",
        "Exekuce: 1m timing, SL swing/ATR, partial 1R.",
      ],
    },
    "ai-matic-x": {
      title: "AI-MATIC-X Core (Decision Tree)",
      summary:
        "1h kontext · 5m exekuce · rodiny 1–6 · max pozice/order dle settings",
      description:
        "Decision tree pro režim trhu (trend/range) a volbu rodin; bez EMA/ATR; bez přidávání do otevřené pozice.",
      notes: [
        ORDER_VALUE_NOTE,
        "1h trend: HH/HL nebo LL/LH bez overlapu (swing 2L/2R).",
        "5m trend: impuls (>=1.2× avg range) → korekce (<=60%) → pokračování.",
        "Rodiny 1–6: pullback, continuation, range fade, break&flip, reversal, no trade.",
        "Entry: LIMIT default; MARKET jen při strong expanse; PostOnly jen v low‑vol range.",
        "Otevřená pozice = žádné přikupování; respektuj Max positions/orders v settings.",
      ],
    },
    "ai-matic-scalp": {
      title: "AI-MATIC-SCALP Core",
      summary: "1h bias · 15m kontext · 1m entry · fee-aware",
      description: "Scalp engine s RTC filtrem a maker‑first exekucí.",
      notes: [
        "TF: 1h bias + 15m kontext + 1m entry.",
        "TP1 gate: TP1 >= 2.5× RTC (fee + slippage).",
        "Setupy: SR (sweep+reclaim) primární, BR (break+retest) sekundární.",
        "Entry: LIMIT post‑only; SL strukturální; BE+ / time stop po TP1.",
        "Max 2 pokusy na level; risk podle R.",
      ],
    },
    "ai-matic-tree": {
      title: "AI-MATIC-TREE (Fibonacci Strategy)",
      summary: "Fibonacci retracements/extensions · trend pullbacks · confluence",
      description:
        "Fibonacci strategie zaměřená na trendové pullbacky, strukturu a extension targety.",
      notes: [
        "1) What Is the Fibonacci Strategy:",
        "Fibonacci is a tool used to find high-probability support and resistance zones based on natural ratios in price.",
        "The key ratios are:",
        "- Retracement: 23.6%, 38.2%, 50.0%, 61.8%, 76.4%",
        "- Extension: 38.2%, 61.8%, 100%, 138.2%, 161.8%",
        "These zones often become self-fulfilling levels",
        "- used by thousands of traders to plan entries and exits.",
        "2) How to Use Fibonacci Retracements:",
        "Use Fibonacci only in trending markets.",
        "• In an uptrend: Draw from Swing Low → Swing High",
        "• In a downtrend: Draw from Swing High → Swing Low",
        "Entry setups occur when price pulls back to key Fib levels before continuing in the direction of the trend.",
        "3) Why These Levels Work:",
        "Fib levels act as magnets because:",
        "• Many traders place pending orders at these zones",
        "• They align with historical structure or psychological levels",
        "• The most respected zones = 38.2%, 50.0%, 61.8%",
        "Use these as entry zones, but only after a clear trend has formed.",
        "4) When Fibonacci Fails",
        "• Price doesn't always respect Fib levels.",
        "Sometimes:",
        "- Price breaks straight through multiple zones",
        "- You pick the wrong Swing High/Low",
        "- A weak trend confuses the structure",
        "Always confirm Fib setups with trendlines, structure, or candlestick signals - never trade Fibs alone.",
        "5) Combining Fibonacci With Structure:",
        "Best results come when Fib levels align with:",
        "• Support & Resistance",
        "• Trendlines",
        "• Previous highs/lows",
        "• Session opens",
        "This confluence increases the probability of a reaction at the level - especially for sniper entries.",
        "6) Using Fibonacci Extensions for Targets",
        "Once in a trade, use extension levels for take profit zones.",
        "Example (Uptrend):",
        "- 61.8% → First TP",
        "- 100% → Main target",
        "- 161.8% → Full extension",
        "Extension levels help lock in profits - instead of guessing.",
        "7) Stop Loss Strategy with Fibonacci:",
        "Two SL options:",
        "- SL beyond the next Fib level (for tight control)",
        "- SL beyond the Swing High/Low (for trend room)",
        "Use larger SLs for swing trades, tighter SLs for scalps.",
        "Always match SL placement with market structure - don't rely on Fib zones alone.",
      ],
    },
  };
  const coreMeta = coreProfiles[local.riskMode];
  const cheatSheetSetupId = CHEAT_SHEET_SETUP_BY_RISK_MODE[local.riskMode];
  const cheatSheetSetup = cheatSheetSetupId
    ? getCheatSheetSetup(cheatSheetSetupId)
    : null;
  const cheatSheetLabel = cheatSheetSetup?.name ?? "Cheat sheet";
  const cheatSheetNotes =
    cheatSheetSetup?.rules ?? ["Cheat sheet se nepodařilo načíst."];
  const cheatSheetStatus = local.strategyCheatSheetEnabled ? "On" : "Off";
  const coreBlocks = useMemo(
    () => buildCheatBlocks(coreMeta.notes),
    [coreMeta.notes]
  );
  const cheatBlocks = useMemo(
    () => buildCheatBlocks(cheatSheetNotes),
    [cheatSheetNotes]
  );
  const summaryText = `${coreMeta.title} · ${coreMeta.summary} · Cheat sheet: ${cheatSheetLabel} (${cheatSheetStatus})`;
  const checklistGatesByProfile: Record<AISettings["riskMode"], string[]> = {
    "ai-matic": ["Trend bias"],
    "ai-matic-x": ["X setup"],
    "ai-matic-tree": ["Trend bias"],
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
      value: cheatSheetSetup
        ? `${cheatSheetStatus} · ${cheatSheetLabel}`
        : cheatSheetStatus,
    },
    { label: "Hard gates", value: local.enableHardGates ? "On" : "Off" },
    { label: "Soft gates", value: local.enableSoftGates ? "On" : "Off" },
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
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 3,
    maxOpenOrders: 12,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "base",
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
  };

  const AI_MATIC_X_PRESET_UI: AISettings = {
    riskMode: "ai-matic-x",
    trendGateMode: "adaptive",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 1,
    maxOpenOrders: 4,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "ultra",
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
  };

  const AI_MATIC_SCALP_PRESET_UI: AISettings = {
    riskMode: "ai-matic-scalp",
    trendGateMode: "adaptive",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 3,
    maxOpenOrders: 12,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "ultra",
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
  };

  const AI_MATIC_TREE_PRESET_UI: AISettings = {
    riskMode: "ai-matic-tree",
    trendGateMode: "adaptive",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    strategyCheatSheetEnabled: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 2,
    maxOpenOrders: 8,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    entryStrictness: "base",
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    requireConfirmationInAuto: false,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
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

  const renderCheatBlocks = (blocks: CheatBlock[]) => (
    <div className="space-y-3 text-slate-400">
      {blocks.map((block, blockIndex) => {
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
  );

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
            <div>{summaryText}</div>
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-white">{coreMeta.title}</div>
                <div className="text-slate-300">{coreMeta.description}</div>
              </div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Core
              </div>
            </div>
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
            {renderCheatBlocks(coreBlocks)}
          </div>

          <div className="mt-3 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Cheat Sheet</div>
                <div className="text-slate-300">
                  {cheatSheetSetup?.description ??
                    "Cheat sheet se nepodařilo načíst."}
                </div>
              </div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                {cheatSheetStatus}
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Setup: {cheatSheetLabel}
            </div>
            {renderCheatBlocks(cheatBlocks)}
          </div>

          <div className="text-xs text-slate-500">
            Parametry: Max positions {local.maxOpenPositions} • Max orders{" "}
            {local.maxOpenOrders}
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
