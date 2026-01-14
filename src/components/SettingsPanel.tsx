import React, { useEffect, useMemo, useState } from "react";
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
      description: "SMC profil s HTF 12h/4h (bull) nebo 1d/4h (bear) biasem a LTF 1h/5m (bull) nebo 1h/15m (bear) entry přes CHOCH/MSS a displacement pullback.",
      notes: [
        "Trading hours: Off",
        "Páry: top 5 USDT dle 24h volume",
        "HTF: Bull 12h + 4h / Bear 1d + 4h structure (HH/HL, LH/LL) + swing points",
        "POI: Order blocky, FVG, breaker blocks, liquidity pools",
        "LTF: 1h context + 5m (bull) / 15m (bear) displacement + CHOCH/MSS + mitigace",
        "Entry: pullback do HTF POI po inducement sweep; ignoruj LTF bez HTF",
        "Smart Money combo: OB + liquidity, sweep/inducement, break & retest, FVG",
        "Checklist gate: min 7/10 potvrzeni (EMA 8/21/50, pattern, volume, BTC, OB, sweep, retest, FVG, VP/SR, CoinGlass)",
        "LONG: EMA9 > EMA21 (M5), ADX>22, ATR <70% prům.20, cena nad VWAP; SL pod low, TP 1.8× ATR",
        "LONG: Pullback k EMA50 na 1h + higher low, ADX>20; entry break high, SL pod EMA50",
        "LONG: Momentum <30 na M5 + bullish engulfing; rychlý scalp",
        "LONG: Breakout nad resistance s ATR expanzí +20% a ADX>25",
        "SHORT: EMA9 < EMA21 (M15), ADX>22, ATR <70% prům.20, cena pod VWAP; SL nad high",
        "SHORT: Pullback k EMA50 na 1h + lower high, ADX>20; entry break low, SL nad EMA50",
        "SHORT: Momentum >70 na M15 + bearish engulfing",
        "SHORT: Breakdown pod support s ATR expanzí a ADX>25",
        "Filtrace: žádný vstup proti HTF biasu (např. 1h EMA200)",
        "Relaxed: 70%+ confidence (2+ indikátorů) · Auto‑On vždy s TP/SL + trailing",
      ],
    },
    "ai-matic-scalp": {
      title: "SCALPERA BOT AI MATIC EDITION",
      description:
        "Operational Implementation Guide v2.0 · Integrace AI Matic Intelligence Framework (Scalpera Systems, 2026).",
      notes: [
        "Cil: spojit presnost SMC/ICT se silou AI Matic; adaptivni exekuce podle struktury, objemu, sentimentu a volatility.",
        "Core SMC/ICT: BOS, CHOCH, OB, FVG; EMA 8/21/50/200; volume baseline SMA20.",
        "AI layer: Trend Predictor (EMA stack + AI smer), Volatility Scanner (ATR + OI delta), Sentiment Engine (funding/OI/text/social), Price Cone (Monte Carlo 12-24h), Adaptive Executor (Trend/Sweep).",
        "Pipeline: Bybit OHLCV+Orderbook, CoinGlass OI/Funding/LS ratio, Birdeye DEX volume + whales, AI Matic feed.",
        "Signal format: {symbol, signal, confidence, mode, entry, sl, tp, validation, data_missing}.",
        "Rezimy: Trend-Pullback (EMA8>21>50, FVG/OB retrace, volume > SMA20*1.2, AI cone + sentiment>0).",
        "Rezimy: Liquidity-Sweep (sweep + rychly navrat, volume spike + negativni sentiment, OI delta + funding zmena).",
        "Rezimy: Adaptive (AI prepina Trend/Sweep, confidence >60%).",
        "Risk: SL 1.3 ATR(14) * volatility_factor; TP 2.6 ATR(14) * cone_direction; trailing po RRR 1.1; max 1 pozice/symbol; bez pyramidovani.",
        "Predikce: price cone 12h/24h; bias >0.60 long, <0.40 short.",
        "Validace: validation passed/failed; data_missing => WAIT.",
        "Integrace: webhook Bybit + monitoring a adaptivni update.",
        "Metriky: success rate 63-72%, RRR 1.8-2.2, drawdown max 2%/trade.",
        "Modules: TrendPredictor, VolatilityScanner, SentimentEngine, PriceConeGenerator, AdaptiveExecutor.",
        "SMART MONEY – HLOUBKOVA INTEGRACE",
        "Mindset: posuzuj kazdy signal optikou instituci; neodevzdavej likviditu.",
        "EMA 8/21/50 + Order Block musi potvrdit stejny smer; konflikt = NO TRADE.",
        "Liquidity sweep/inducement: cekej na sweep a navrat do OB + objemovou reakci.",
        "Break & retest: vstup az po retestu OB/S&R/PoC, ne na prvni impuls.",
        "FVG: SL za FVG, TP na FVG/OB/S&R v ceste.",
        "Multi-TF: BOS/CHoCH na 1h i 15m, vstupni pattern na 5m/1m.",
        "Management: opacny BOS/CHoCH na 1m/5m = rucni exit.",
        "Chyby: OB bez EMA, vstup bez sweepu/retestu, SL v likvidite.",
      ],
    },
    "ai-matic-tree": {
      title: "AI-Matic Tree (Market → Akce)",
      description:
        "Rozhodovací strom A + Rodiny C + Checklist B + Risk protokol D (Bybit Linear, 1h/5m).",
      notes: [
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
      "AI‑MATIC‑X (bull 12h/4h→1h/5m · bear 1d/4h→1h/15m): SMC bias + smart‑money filtrace, přísnější vstupy.",
    "ai-matic-scalp":
      "Scalp profil (1h/1m): rychlé intraday vstupy, krátké držení, disciplinované řízení rizika.",
    "ai-matic-tree":
      "AI‑MATIC‑TREE (1h/5m): decision‑tree overlay nad AI‑MATIC core enginem.",
  };
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
    { label: "Trend gate", value: local.trendGateMode },
    { label: "Max pos", value: String(local.maxOpenPositions) },
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
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
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
    maxOpenPositions: 3,
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 0,
    minWinRate: 65,
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
    entryStrictness: "ultra",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
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
    entryStrictness: "base",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
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

  const applyPreset = (mode: AISettings["riskMode"]) => {
    const preset = presets[mode];
    setLocal(preset);
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
                step={1}
                value={local.maxOpenPositions}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  setLocal({
                    ...local,
                    maxOpenPositions: Number.isFinite(next)
                      ? Math.max(0, Math.round(next))
                      : 0,
                  });
                }}
                className="w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
              />
              <span className="text-xs text-secondary-foreground/70">
                0 = bez limitu
              </span>
            </div>
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
            {local.maxOpenPositions}
          </div>
        </div>
      </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end mt-6">
          <button
            type="button"
            onClick={() => {
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
