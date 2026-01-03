import React, { useEffect, useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({ settings, onUpdateSettings, onClose }) => {
  const [local, setLocal] = useState(settings);

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
      description: "Konzervativnější intraday / scalp mix s kontrolou sezení a širšími filtry volatility. Entry: ST15 bias + ST1 Close + EMA20 pullback + RVOL≥1.2. Execution: PostOnly LIMIT · timeout 1×15sec.",
      notes: [
        "Trading hours: On (0–23 SEČ/SELČ)",
        "Limit: max 3 pozice současně",
        "Risk: 4 USDT / trade · 8 USDT total (po 3 ztrátách 2/4 na 60m)",
        "Entry: ST15 bias + ST1 Close + EMA20 pullback + RVOL≥1.2",
        "Execution: PostOnly LIMIT · timeout 1×15sec",
        "Trailing profit lock",
      ],
    },
    "ai-matic-x": {
      title: "AI-Matic-X",
      description: "SMC profil s HTF 4h/1h biasem a POI (OB/FVG/Breaker/Liquidity) a LTF 15m/1m entry přes CHOCH/MSS a displacement pullback.",
      notes: [
        "Trading hours: Off",
        "Páry: top 5 USDT dle 24h volume",
        "HTF: 4h + 1h structure (HH/HL, LH/LL) + swing points",
        "POI: Order blocky, FVG, breaker blocks, liquidity pools",
        "LTF: 15m + 1m displacement + CHOCH/MSS + mitigace",
        "Entry: pullback do HTF POI po inducement sweep; ignoruj LTF bez HTF",
        "LONG: EMA9 > EMA21 (M5), ADX>22, ATR <70% prům.20, cena nad VWAP; SL pod low, TP 1.8× ATR",
        "LONG: Pullback k EMA50 na M15 + higher low, ADX>20; entry break high, SL pod EMA50",
        "LONG: Momentum <30 na M1 + bullish engulfing; rychlý scalp",
        "LONG: Breakout nad resistance s ATR expanzí +20% a ADX>25",
        "SHORT: EMA9 < EMA21 (M5), ADX>22, ATR <70% prům.20, cena pod VWAP; SL nad high",
        "SHORT: Pullback k EMA50 na M15 + lower high, ADX>20; entry break low, SL nad EMA50",
        "SHORT: Momentum >70 na M1 + bearish engulfing",
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
      ],
    },
  };
  const meta = profileCopy[local.riskMode];

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

  const presets: Record<AISettings["riskMode"], AISettings> = {
    "ai-matic": AI_MATIC_PRESET_UI,
    "ai-matic-x": AI_MATIC_X_PRESET_UI,
    "ai-matic-scalp": AI_MATIC_SCALP_PRESET_UI,
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
          <p className="text-sm text-muted-foreground">
            Zvolený profil nastaví výchozí parametry; vybrané podmínky můžeš přepnout.
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Profile
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => applyPreset("ai-matic")}
                className={`flex-1 rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                AI-Matic
              </button>
              <button
                onClick={() => applyPreset("ai-matic-x")}
                className={`flex-1 rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-x"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                AI-Matic-X
              </button>
              <button
                onClick={() => applyPreset("ai-matic-scalp")}
                className={`flex-1 rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-scalp"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                AI-Matic-Scalp
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Enforce Trading Hours
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{local.enforceSessionHours ? "On" : "Off"}</div>
                <div className="text-xs text-slate-400 mt-1">
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
              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Hard podmínky</div>
                  <div className="text-xs text-slate-400 mt-1">
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

              <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Soft podmínky</div>
                  <div className="text-xs text-slate-400 mt-1">
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
              Trend Gate Mode
            </label>
            <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm space-y-2">
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
              <div className="text-xs text-slate-400">
                Adaptive: follow when ADX &gt;= 25 or score &gt;= 3, otherwise reverse.
                Follow: only with trend direction. Reverse: only mean-reversion.
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Cheat Sheet
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{local.strategyCheatSheetEnabled ? "On" : "Off"}</div>
                <div className="text-xs text-slate-400 mt-1">
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
            <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              {local.maxOpenPositions}
            </div>
          </div>

          <div className="mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2">
            <div className="font-semibold text-white">{meta.title}</div>
            <div className="text-slate-300">{meta.description}</div>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              {meta.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
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
