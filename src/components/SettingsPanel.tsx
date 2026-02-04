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

type NoteBlock = { title?: string; lines: string[] };
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
  "Core v2 sizing: risk % equity (ai-matic 0.40%, x 0.30%, scalp 0.25%, tree 0.30%), notional cap ~1% equity, min 100 USDT.";

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
    line.startsWith("CHECKLIST") ||
    line.startsWith("RYCHLÁ PAMĚŤOVKA") ||
    line.startsWith("VIZUÁLNÍ ZKRATKA") ||
    line.startsWith("JAK S TÍM PRACOVAT") ||
    line.startsWith("FINÁLNÍ PRINCIP") ||
    line.startsWith("PROVOZNÍ") ||
    line.startsWith("Kombinovaná strategie") ||
    line.startsWith("Integrace tržních znalostí")
  );
}

function buildNoteBlocks(notes: string[]): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let current: NoteBlock = { lines: [] };
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
  const [compactNotes, setCompactNotes] = useState(true);
  const profileSettingsRef = useRef<ProfileSettingsMap>(
    loadProfileSettingsMap()
  );

  useEffect(() => {
    setLocal(settings);
  }, [settings]);
  const coreProfiles: Record<AISettings["riskMode"], CoreProfile> = {
    "ai-matic": {
      title: "AI-MATIC Core",
      summary: "HTF 1h/15m · LTF 5m · OB/POI + EMA 20/50/200",
      description:
        "Core multi‑TF trend/POI engine s potvrzením objemem a strukturou.",
      notes: [
        ORDER_VALUE_NOTE,
        "Timeframe: 1h kontext (OB/EMA/SR/volume) · 15m potvrzení trendu · 5m vstup.",
        "Vstup 2 stupně: 60 % první reakce z OB/sweep · 40 % retest OB/GAP/Fibo.",
        "Typ vstupu: LIMIT preferovaný, CONDITIONAL při breaku, MARKET jen při silné reakci + objem.",
        "SL: pod strukturu nebo OB knot + ATR buffer.",
        "TP1: ~0.9–1.2 %, TP2: 2–3 % nebo HTF struktura.",
        "Trailing: aktivace +1.0 %, retracement 0.5–0.8 %.",
        "Filtry: EMA 20/50/200, RSI 14, MACD, Volume.",
      ],
    },
    "ai-matic-x": {
      title: "AI-MATIC-X (Swing OB 15m/1h)",
      summary: "Swing 15m/1h · OB + Volume Profile · BTC filtr",
      description:
        "Swing systém pro OB reakce s kontrolou BTC biasu a likvidity.",
      notes: [
        ORDER_VALUE_NOTE,
        "Timeframe: 1h kontext (trend/OB/VP) · 15m vstup.",
        "Vstup 2 stupně: 60 % reakce z OB/sweep · 40 % retest OB/GAP/Fibo.",
        "Typ vstupu: LIMIT preferovaný, CONDITIONAL při breaku, MARKET jen při silné reakci + objem.",
        "SL: pod strukturu nebo OB knot + ATR buffer.",
        "TP1: ~0.9–1.2 % (část zavřít), TP2: 2–3 % nebo HTF level.",
        "Trailing: aktivace 1.0R, retracement 0.4 %.",
        "BTC bias: směrový soulad; při decouplingu zvýšená opatrnost.",
      ],
    },
    "ai-matic-scalp": {
      title: "AI-MATIC-SCALP Core",
      summary: "15m trend · 1m entry · EMA cross + RSI div + volume spike",
      description: "Rychlé scalp vstupy s trend filtrem a přísným řízením rizika.",
      notes: [
        ORDER_VALUE_NOTE,
        "15m určuje trend, 1m načasuje vstup.",
        "Entry: EMA cross (<= 6 svíček) + RSI divergence + volume spike.",
        "Exit: ATR trailing (2.5x) nebo fixní TP 1.5R.",
      ],
    },
    "ai-matic-tree": {
      title: "AI-MATIC-TREE Core",
      summary: "HTF 1h/15m · LTF 5m/1m · EMA bias + trend entries",
      description: "Multi‑TF trendový engine s R‑based řízením.",
      notes: [
        ORDER_VALUE_NOTE,
        "Bias gate: EMA50 + shoda HTF(1h)/mid(15m) se směrem obchodu.",
        "Entry typy: MOMENTUM / PULLBACK / BREAKOUT.",
        "SL: swing-based (nebo ATR fallback) + minimální bezpečná vzdálenost.",
        "TP: R-based (u tree 2.2R) + partial 1.0R (50%).",
        "Time stop: po ~2h, pokud trade není aspoň +0.5R -> exit.",
        "Entry strictness řídí filtry spread/volume/trend.",
      ],
    },
    "ai-matic-pro": {
      title: "AI-MATIC-PRO (Sideways)",
      summary: "Sideways only · VA/POC · OFI/VPIN/HMM",
      description: "Mean‑reversion engine pouze pro range režim.",
      notes: [
        ORDER_VALUE_NOTE,
        "Aktivace: Hurst < 0.45, CHOP > 60, HMM state0 p>=0.7, VPIN < 0.8.",
        "Market Profile: VAH/VAL/POC + VWAP/VA mid pro cíle.",
        "Entry: VA edge + OFI/Delta absorpce (LIMIT_MAKER_FIRST).",
        "Exit: T1 ~VWAP/mid (60%), T2 POC/VAH/VAL, time stop 10 svíček / 60m.",
        "SL: za LVN nebo 2x ATR, po T1 SL na BE.",
      ],
    },
  };
  const coreMeta = coreProfiles[local.riskMode];
  const noteBlocks = useMemo(
    () => buildNoteBlocks(coreMeta.notes),
    [coreMeta.notes]
  );
  const summaryText = `${coreMeta.title} · ${coreMeta.summary}`;
  const coreV2GateNames = [
    "HTF bias",
    "EMA order",
    "EMA sep1",
    "EMA sep2",
    "ATR% window",
    "Volume Pxx",
    "LTF pullback",
    "Micro pivot",
    "Micro break close",
    "BBO fresh",
    "BBO age",
    "Trend strength",
    "Maker entry",
    "SL structural",
  ];
  const aiMaticGateNames = [
    "Hard: 3 of 6",
    "Entry: Any of 5",
    "Checklist: 3 of 7",
  ];
  const checklistGatesByProfile: Record<AISettings["riskMode"], string[]> = {
    "ai-matic": aiMaticGateNames,
    "ai-matic-x": coreV2GateNames,
    "ai-matic-tree": coreV2GateNames,
    "ai-matic-scalp": [
      "Primary Timeframe: 15m for trend, 1m for entry.",
      "Entry Logic: EMA Cross (last <= 6 bars) + RSI Divergence + Volume Spike.",
      "Exit Logic: Trailing Stop (ATR 2.5x) or Fixed TP (1.5 RRR).",
    ],
    "ai-matic-pro": [
      "Hurst < 0.45",
      "CHOP > 60",
      "HMM state0 p>=0.7",
      "VPIN < 0.8",
      "OFI/Delta trigger",
      "VA edge",
    ],
  };
  const activeGateNames =
    checklistGatesByProfile[local.riskMode] ?? checklistGatesByProfile["ai-matic"];
  const statusItems = [
    { label: "Hard gates", value: local.enableHardGates ? "On" : "Off" },
    { label: "Soft gates", value: local.enableSoftGates ? "On" : "Off" },
    {
      label: "Trend gate",
      value:
        local.riskMode === "ai-matic-pro"
          ? "Off (PRO)"
          : local.trendGateMode,
    },
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
    avoidLowLiquidity: true,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: true,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 7,
    maxOpenOrders: 20,
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
    minProfitFactor: 1.2,
    minWinRate: 70,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.005,
  };

  const AI_MATIC_PRO_PRESET_UI: AISettings = {
    riskMode: "ai-matic-pro",
    trendGateMode: "adaptive",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: false,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 1,
    maxOpenOrders: 4,
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
    "ai-matic-pro": AI_MATIC_PRO_PRESET_UI,
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

  const resetToPreset = () => {
    const preset = presets[local.riskMode];
    const nextStorage = { ...profileSettingsRef.current };
    delete nextStorage[local.riskMode];
    profileSettingsRef.current = nextStorage;
    persistProfileSettingsMap(nextStorage);
    setLocal(preset);
  };

  const renderNoteBlocks = (blocks: NoteBlock[]) => (
    <div className="space-y-3 text-slate-400">
      {blocks.map((block, blockIndex) => {
        const rawLines = compactNotes
          ? block.lines.filter((line) => !extractImageUrl(line))
          : block.lines;
        const visibleLines = compactNotes
          ? rawLines.slice(0, 3)
          : rawLines;
        const hiddenCount = rawLines.length - visibleLines.length;
        const showDivider = !compactNotes && blockIndex > 0;
        return (
          <div
            key={`${block.title ?? "block"}-${blockIndex}`}
            className={showDivider ? "border-t border-slate-800/80 pt-3" : ""}
          >
            <div
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
                      {compactNotes ? compactLine(line) : line}
                    </li>
                  );
                })}
              </ul>
              {compactNotes && hiddenCount > 0 ? (
                <div className="mt-1 text-[11px] text-slate-500">
                  +{hiddenCount} dalších
                </div>
              ) : null}
            </div>
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
              <button
                onClick={() => applyPreset("ai-matic-pro")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-pro"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-Pro
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={resetToPreset}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Reset current profile to defaults
              </button>
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

          {local.riskMode !== "ai-matic-scalp" &&
          local.riskMode !== "ai-matic-pro" ? (
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
              Entry Strictness
            </label>
            <div className="rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm space-y-2">
              <select
                value={local.entryStrictness ?? "base"}
                onChange={(e) =>
                  setLocal({
                    ...local,
                    entryStrictness: e.target.value as AISettings["entryStrictness"],
                  })
                }
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
              >
                <option value="base">Base (Standard)</option>
                <option value="strict">Strict (High Precision)</option>
                <option value="ultra">Ultra (Sniper)</option>
              </select>
              <div className="text-xs text-secondary-foreground/70">
                Controls filter sensitivity (Spread, Volume, Trend). Base = Balanced, Strict = Precision, Ultra = Sniper.
              </div>
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
                View: {compactNotes ? "Compact" : "Full"}
              </div>
              <button
                type="button"
                onClick={() => setCompactNotes(!compactNotes)}
                className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
              >
                {compactNotes ? "Show all" : "Compact view"}
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-800 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">
                Strategy Notes
              </h3>
            </div>
            {renderNoteBlocks(noteBlocks)}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onUpdateSettings(local);
              onClose();
            }}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
