import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Symbol } from "../api/types";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols } from "../constants/symbols";
import { AISettings } from "../types";
import {
  OLIKELLA_GATE_NAMES,
  OLIKELLA_LEGACY_RISK_MODE,
  OLIKELLA_MAX_ORDERS_DEFAULT,
  OLIKELLA_MAX_POSITIONS_DEFAULT,
  OLIKELLA_PROFILE_LABEL,
  OLIKELLA_RISK_MODE,
  migrateRiskMode,
} from "../lib/oliKellaProfile";
import ApiKeysManager from "./ApiKeysManager";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose: () => void;
  userEmail: string;
  isGuest: boolean;
  missingServices: string[];
  keysError: string | null;
  onSignOut: () => void;
  onToggleTheme: () => void;
  apiKeysUserId: string;
  onKeysUpdated: () => void | Promise<void>;
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
const MIN_PER_TRADE_USD = 5;
const MAX_PER_TRADE_USD = 50000;
const MIN_EMA_TREND_PERIOD = 10;
const MAX_EMA_TREND_PERIOD = 500;
const DEFAULT_TESTNET_PER_TRADE_USD = 50;
const DEFAULT_MAINNET_PER_TRADE_USD = 20;
const ORDER_VALUE_NOTE =
  "Core v2 sizing: risk % equity + manuální Per-trade limity (testnet/mainnet).";

type ProfileSettingsMap = Partial<Record<AISettings["riskMode"], AISettings>>;

function loadProfileSettingsMap(): ProfileSettingsMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const source = parsed as Record<string, AISettings>;
    const next: Record<string, AISettings> = { ...source };
    let touched = false;
    if (
      next[OLIKELLA_LEGACY_RISK_MODE] &&
      !next[OLIKELLA_RISK_MODE]
    ) {
      next[OLIKELLA_RISK_MODE] = {
        ...next[OLIKELLA_LEGACY_RISK_MODE],
        riskMode: OLIKELLA_RISK_MODE,
      };
      touched = true;
    }
    if (next[OLIKELLA_LEGACY_RISK_MODE]) {
      delete next[OLIKELLA_LEGACY_RISK_MODE];
      touched = true;
    }
    Object.entries(next).forEach(([key, value]) => {
      const migratedMode = migrateRiskMode(key as AISettings["riskMode"]);
      if (migratedMode !== key) {
        next[migratedMode] = {
          ...value,
          riskMode: migratedMode,
        };
        delete next[key];
        touched = true;
      } else if (value?.riskMode !== migratedMode) {
        next[key] = {
          ...value,
          riskMode: migratedMode,
        };
        touched = true;
      }
    });
    if (touched) {
      localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    }
    return next as ProfileSettingsMap;
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

function clampPerTradeUsd(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_PER_TRADE_USD, Math.max(MIN_PER_TRADE_USD, n));
}

function clampEmaTrendPeriod(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_EMA_TREND_PERIOD, Math.max(MIN_EMA_TREND_PERIOD, Math.round(n)));
}

const SettingsPanel: React.FC<Props> = ({
  settings,
  onUpdateSettings,
  onClose,
  userEmail,
  isGuest,
  missingServices,
  keysError,
  onSignOut,
  onToggleTheme,
  apiKeysUserId,
  onKeysUpdated,
  theme,
}) => {
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
        "TP1: ~0.9–1.2 % (uzavřít 70 %), TP2: 2–3 % nebo HTF struktura.",
        "Trailing: aktivace +1.0 %, retracement 0.5–0.8 %.",
        "Exspirace signálu: 2 svíčky bez reakce nebo porušení struktury.",
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
    "ai-matic-amd": {
      title: "AI-MATIC-AMD (PO3 / AMD)",
      summary: "PO3 fáze · Killzones NY · Inversion FVG confirm",
      description:
        "Power of Three engine: Akumulace -> Manipulace -> Distribuce s killzone filtrem a FVG potvrzením obratu.",
      notes: [
        ORDER_VALUE_NOTE,
        "PHASE MODEL",
        "Akumulace: Asia session (20:00-00:00 NY) definuje range high/low.",
        "Manipulace: sweep protisměrně proti HTF bias (midnight open + Asia range).",
        "Distribuce: aktivní až po inversion FVG potvrzení.",
        "KILLZONES",
        "Manipulace a distribuce povolena pouze v London (02:00-05:00 NY) nebo NY AM (08:00-11:00 NY).",
        "BIAS MODEL",
        "HTF bias: 1h EMA50/EMA200 (bull: close > EMA50 > EMA200, bear: close < EMA50 < EMA200).",
        "TARGET MODEL",
        "TP1 = manipLow + 1x(manipHigh-manipLow) / inverse pro short.",
        "TP2 = manipLow + 2x(manipHigh-manipLow) / inverse pro short.",
        "ENTRY POLICY",
        "Vstup pouze při kompletní sekvenci AMD + inversion FVG confirm.",
        "Typ vstupu: LIMIT_MAKER_FIRST, bez MARKET override.",
      ],
    },
    "ai-matic-olikella": {
      title: `${OLIKELLA_PROFILE_LABEL} Core`,
      summary: "H4 structure/pattern/SR · 5m feed · long/short symmetry",
      description:
        "Entry cross běží na 1h. Struktura, patterny a silné support/resistance běží na H4.",
      notes: [
        ORDER_VALUE_NOTE,
        "SIGNAL CHECKLIST",
        "Minimum historie: 40 H4 svíček.",
        "Struktura/patterny/silné support-resistance se vyhodnocují na H4 (H4_MINUTES=240).",
        "Trigger: 1h EMA8 překříží EMA16 (long zespodu nahoru, short shora dolů).",
        "Pokračování: long drží EMA8 nad EMA16, short drží EMA8 pod EMA16.",
        "Směr: long + short, mirror pravidla.",
        "ENTRY CONDITIONS",
        "Vstup jen při validním 1h cross + potvrzeném H4 patternu.",
        "Feed: 5m, entry logika resamplovaná do 1h.",
        "EXIT CONDITIONS",
        "Exhaustion Extension: distance od H4 EMA10 >=9% + volume >=1.5x.",
        "První exhaustion: partial 60%. Druhý exhaustion: full exit.",
        "Protective exit: opposite EMA8/EMA16 cross.",
        "Trail stop: 5m timeframe, aktivace při RRR 1:1 od entry.",
        "Retracement rate je dynamický dle volatility (ATR), rozsah cca 0.2% až 1.0%.",
        "BE move při >=1R.",
        "RISK RULES",
        "Risk na trade: 1.5% equity.",
        "Scale-in: max 1 add-on při >=1R unrealized a fresh setupu.",
        "Default limits: max pozic 5, max příkazů 20.",
      ],
    },
    "ai-matic-tree": {
      title: "AI-MATIC-TREE Core",
      summary: "HTF 1h/15m · LTF 5m/1m · EMA bias + trend entries",
      description: "Multi‑TF trendový engine s R‑based řízením.",
      notes: [
        ORDER_VALUE_NOTE,
        "Bias gate: EMA200 na 5m + potvrzený průraz směru.",
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
    "EMA200 trend",
    "EMA200 breakout",
    "EMA200 confirm",
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
    "Hard: 3/4 validní Hard gate",
    "Entry: 3 of 4",
    "Checklist: 5 of 8",
  ];
  const amdGateNames = [
    "AMD: Phase sequence",
    "AMD: Killzone active",
    "AMD: Midnight open set",
    "AMD: Asia range valid",
    "AMD: Liquidity sweep",
    "AMD: Inversion FVG confirm",
    "AMD: Target model valid",
  ];
  const checklistGatesByProfile: Record<AISettings["riskMode"], string[]> = {
    "ai-matic": aiMaticGateNames,
    "ai-matic-x": coreV2GateNames,
    "ai-matic-amd": amdGateNames,
    "ai-matic-tree": coreV2GateNames,
    "ai-matic-olikella": [
      ...OLIKELLA_GATE_NAMES,
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
    { label: "Hard", value: local.enableHardGates ? "On" : "Off" },
    { label: "Soft", value: local.enableSoftGates ? "On" : "Off" },
    {
      label: "Trend",
      value:
        local.riskMode === "ai-matic-pro"
          ? "Off (PRO)"
          : local.riskMode === "ai-matic-amd"
            ? "PO3/AMD bias (1h EMA50/200)"
          : local.riskMode === OLIKELLA_RISK_MODE
            ? "1h EMA8/16 cross"
          : local.trendGateMode,
    },
    { label: "Max pozic", value: String(local.maxOpenPositions) },
    { label: "Max příkazů", value: String(local.maxOpenOrders) },
    { label: "Symboly", value: local.selectedSymbols.join(", ") },
  ];

  const AI_MATIC_PRESET_UI: AISettings = {
    riskMode: "ai-matic",
    trendGateMode: "follow",
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const AI_MATIC_X_PRESET_UI: AISettings = {
    riskMode: "ai-matic-x",
    trendGateMode: "follow",
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const AI_MATIC_AMD_PRESET_UI: AISettings = {
    riskMode: "ai-matic-amd",
    trendGateMode: "follow",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: false,
    useLiquiditySweeps: true,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: 2,
    maxOpenOrders: 8,
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const AI_MATIC_OLIKELLA_PRESET_UI: AISettings = {
    riskMode: "ai-matic-olikella",
    trendGateMode: "follow",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
    maxOpenPositions: OLIKELLA_MAX_POSITIONS_DEFAULT,
    maxOpenOrders: OLIKELLA_MAX_ORDERS_DEFAULT,
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const AI_MATIC_TREE_PRESET_UI: AISettings = {
    riskMode: "ai-matic-tree",
    trendGateMode: "follow",
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const AI_MATIC_PRO_PRESET_UI: AISettings = {
    riskMode: "ai-matic-pro",
    trendGateMode: "follow",
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
    perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
    perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
    emaTrendPeriod: 200,
  };

  const presets: Record<AISettings["riskMode"], AISettings> = {
    "ai-matic": AI_MATIC_PRESET_UI,
    "ai-matic-x": AI_MATIC_X_PRESET_UI,
    "ai-matic-amd": AI_MATIC_AMD_PRESET_UI,
    "ai-matic-olikella": AI_MATIC_OLIKELLA_PRESET_UI,
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
    if (merged.trendGateMode !== "follow" && merged.trendGateMode !== "adaptive") {
      merged.trendGateMode = preset.trendGateMode;
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
    merged.emaTrendPeriod = clampEmaTrendPeriod(
      merged.emaTrendPeriod,
      preset.emaTrendPeriod ?? 200
    );
    merged.perTradeTestnetUsd = clampPerTradeUsd(
      merged.perTradeTestnetUsd,
      preset.perTradeTestnetUsd
    );
    merged.perTradeMainnetUsd = clampPerTradeUsd(
      merged.perTradeMainnetUsd,
      preset.perTradeMainnetUsd
    );
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
    const nextStorage = Object.fromEntries(
      Object.entries(profileSettingsRef.current).filter(
        ([mode]) => mode !== local.riskMode
      )
    ) as ProfileSettingsMap;
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
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50 settings-panel-overlay">
      <div className="w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6 max-h-[90vh] overflow-y-auto settings-panel">
        <div className="flex flex-col space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Nastavení
          </h2>
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200 settings-panel-summary">
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
            Profil nastaví výchozí parametry. Jednotlivé podmínky lze upravit.
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2 rounded-md border border-input bg-slate-800 px-3 py-3 text-sm text-secondary-foreground settings-panel-account">
            <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-secondary-foreground/70">
                  Účet
                  </div>
                  <div className="font-medium">{userEmail || (isGuest ? "Guest" : "Unknown")}</div>
                </div>
                <div className="text-xs text-secondary-foreground/70">
                Motiv: {theme === "dark" ? "Tmavý" : "Světlý"}
                </div>
              </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleTheme}
                className="rounded-md border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-200 settings-panel-theme-toggle"
              >
                Přepnout motiv
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-1.5 text-xs text-red-200 settings-panel-signout"
              >
                Odhlásit
              </button>
            </div>

            {keysError ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                {keysError}
              </div>
            ) : null}
            {missingServices.length > 0 ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
                Chybí API klíče: {missingServices.join(", ")}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                Stav API klíčů: OK
              </div>
            )}
          </div>

          <ApiKeysManager
            userId={apiKeysUserId}
            onKeysUpdated={onKeysUpdated}
          />

          <div className="grid gap-2 settings-panel-profile-grid">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Profil
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
                onClick={() => applyPreset("ai-matic-amd")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-amd"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-AMD
              </button>
              <button
                onClick={() => applyPreset("ai-matic-olikella")}
                className={`rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-olikella"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-secondary-foreground"
                }`}
              >
                AI-Matic-OLIkella
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
                className="text-xs text-amber-400/90 underline underline-offset-2 hover:text-amber-300"
              >
                Resetovat aktuální profil na výchozí hodnoty
              </button>
            </div>
          </div>

          <div className="grid gap-2 settings-panel-gates">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Riziko a gate
            </label>
            <div className="grid gap-2">
              {local.riskMode !== OLIKELLA_RISK_MODE ? (
                <>
                  <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">Hard</div>
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
                      {local.enableHardGates ? "Zapnuto" : "Vypnuto"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">Soft</div>
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
                      {local.enableSoftGates ? "Zapnuto" : "Vypnuto"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-input bg-slate-800 px-3 py-2 text-xs text-secondary-foreground/80">
                  OLIkella používá vlastní pattern gates. Vstup je povolen jen přes OLIkella signál.
                </div>
              )}
              <div className="rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
                <div className="text-xs text-secondary-foreground/70">Checklist</div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {activeGateNames.map((gateName) => (
                    <span
                      key={gateName}
                      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-secondary-foreground"
                    >
                      {gateName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {local.riskMode !== OLIKELLA_RISK_MODE &&
          local.riskMode !== "ai-matic-pro" &&
          local.riskMode !== "ai-matic-amd" ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Režim trend gate
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
                  <option value="follow">Follow</option>
                  <option value="adaptive">Follow trend Adaptive</option>
                </select>
                <div className="text-xs text-secondary-foreground/70">
                  {local.trendGateMode === "adaptive"
                    ? "Adaptive režim: přepíná gate podle síly trendu."
                    : "Follow režim: EMA trend na 5m, průraz a potvrzení směru."}
                </div>
              </div>
            </div>
          ) : null}

          {local.riskMode !== "ai-matic-pro" &&
          local.riskMode !== OLIKELLA_RISK_MODE &&
          local.riskMode !== "ai-matic-amd" ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                Trend filtr
              </label>
              <div className="flex items-center gap-3 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm">
                <input
                  type="number"
                  min={MIN_EMA_TREND_PERIOD}
                  max={MAX_EMA_TREND_PERIOD}
                  step={1}
                  value={local.emaTrendPeriod ?? 200}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setLocal({
                      ...local,
                      emaTrendPeriod: clampEmaTrendPeriod(next, 200),
                    });
                  }}
                  className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                />
                <span className="text-xs text-secondary-foreground/70">
                  EMA trend na TF 5m s průrazem a potvrzením trendu.
                </span>
              </div>
            </div>
          ) : null}

          {local.riskMode === "ai-matic-tree" ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                TREE sizing mode
              </label>
              <div className="rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-secondary-foreground/70">
                    Risk-based sizing podle equity*riskPct a vzdálenosti SL.
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setLocal({
                        ...local,
                        useDynamicPositionSizing:
                          !local.useDynamicPositionSizing,
                      })
                    }
                    className={`rounded-md border px-3 py-1 text-sm ${
                      local.useDynamicPositionSizing
                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                        : "border-slate-700 bg-slate-900/40 text-slate-200"
                    }`}
                  >
                    {local.useDynamicPositionSizing
                      ? "Dynamic ON"
                      : "Dynamic OFF"}
                  </button>
                </div>
                <div className="text-xs text-secondary-foreground/70">
                  Dynamic OFF zachová fixed testnet notional sizing.
                </div>
              </div>
            </div>
          ) : null}

          {local.riskMode !== OLIKELLA_RISK_MODE ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Přísnost vstupu
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
                  Citlivost filtrů. Base = balanced, Strict = precision, Ultra = sniper.
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-1">
            <div className="text-sm font-medium">Limity</div>
            <div className="text-xs text-secondary-foreground/70">Kapitálové a provozní limity exekuce.</div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Max pozic
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
              Max příkazů
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
              Per-trade limit (USDT)
            </label>
            <div className="grid grid-cols-1 gap-2 rounded-md border border-input bg-slate-800 px-3 py-3 text-sm md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs text-secondary-foreground/70">
                  Demo (testnet)
                </div>
                <input
                  type="number"
                  min={MIN_PER_TRADE_USD}
                  max={MAX_PER_TRADE_USD}
                  step={1}
                  value={local.perTradeTestnetUsd}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setLocal({
                      ...local,
                      perTradeTestnetUsd: clampPerTradeUsd(
                        next,
                        DEFAULT_TESTNET_PER_TRADE_USD
                      ),
                    });
                  }}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                />
                <div className="text-[11px] text-secondary-foreground/70">
                  Na demo se použije: per-trade * leverage.
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-secondary-foreground/70">
                  Mainnet
                </div>
                <input
                  type="number"
                  min={MIN_PER_TRADE_USD}
                  max={MAX_PER_TRADE_USD}
                  step={1}
                  value={local.perTradeMainnetUsd}
                  onChange={(event) => {
                    const next = event.currentTarget.valueAsNumber;
                    setLocal({
                      ...local,
                      perTradeMainnetUsd: clampPerTradeUsd(
                        next,
                        DEFAULT_MAINNET_PER_TRADE_USD
                      ),
                    });
                  }}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                />
                <div className="text-[11px] text-secondary-foreground/70">
                  Na mainnetu se použije: per-trade * leverage.
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Obchodované symboly
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

          <div className="mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2 settings-panel-core-card">
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
                Zobrazení: {compactNotes ? "Kompaktní" : "Plné"}
              </div>
              <button
                type="button"
                onClick={() => setCompactNotes(!compactNotes)}
                className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
              >
                {compactNotes ? "Zobrazit vše" : "Kompaktní režim"}
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-800 pt-4 settings-panel-notes">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">
                Poznámky
              </h3>
            </div>
            {renderNoteBlocks(noteBlocks)}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 settings-panel-cancel"
          >
            Zrušit
          </button>
          <button
            onClick={() => {
              onUpdateSettings(local);
              onClose();
            }}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 settings-panel-save"
          >
            Uložit změny
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
