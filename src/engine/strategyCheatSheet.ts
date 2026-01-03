export type CheatSheetEntryType = "LIMIT_MAKER_FIRST" | "LIMIT" | "CONDITIONAL";

export type StrategyCheatSheetSetup = {
  id: string;
  name: string;
  description: string;
  entryType: CheatSheetEntryType;
  side: "long" | "short" | "both";
  priority: number;
  rules: string[];
  triggerOffsetBps?: number;
};

export const STRATEGY_CHEAT_SHEET: StrategyCheatSheetSetup[] = [
  {
    id: "ai-matic-core",
    name: "AI-MATIC Core Entry",
    description:
      "AI-MATIC TF stack + POI analyzer (OB/FVG/Breaker/Liquidity) with priority sorting.",
    entryType: "LIMIT_MAKER_FIRST",
    side: "both",
    priority: 1,
    rules: [
      "TF stack: 1h context, 15m micro, 5m signal, 1m confirmation/management",
      "FVG: 3-svickova imbalance detekce (priority 1)",
      "OB: posledni opacna svicka pred impulsem (priority 2)",
      "Breaker: mitigace OB + close za extremem (priority 3)",
      "Liquidity pools: equal highs/lows, tolerance 0.2 %, min 3 dotyky",
      "Swing points window: 7 (pro highs/lows)",
      "POI sort: Breaker > OB > FVG > Liquidity",
    ],
  },
  {
    id: "ai-matic-x-smc",
    name: "AI-MATIC-X SMC Hierarchy",
    description:
      "HTF 4h/1h bias + POI with LTF 15m/1m CHOCH/MSS and displacement pullback entries.",
    entryType: "LIMIT_MAKER_FIRST",
    side: "both",
    priority: 2,
    rules: [
      "HTF 4h/1h structure defines bias (HH/HL vs LH/LL)",
      "HTF key swings + POI zones: OB, FVG, Breaker, Liquidity pools",
      "LTF 15m/1m displacement toward HTF bias",
      "LTF CHOCH confirms shift; MSS break + mitigation",
      "LTF OB/FVG aligns with HTF POI before entry",
      "Entry on pullback into HTF POI after inducement sweep",
      "Ignore LTF-only patterns without HTF context",
    ],
  },
  {
    id: "ai-matic-x-smart-money-combo",
    name: "AI-MATIC-X Smart Money Combo",
    description:
      "Smart Money combo: OB + liquidity, sweep/inducement, break/retest, FVG, volatility sizing, checklist gate.",
    entryType: "LIMIT_MAKER_FIRST",
    side: "both",
    priority: 2,
    rules: [
      "Order blocks + liquidity: identify OB volume zones; place SL outside OB to avoid stop hunts",
      "Liquidity sweep + inducement: detect fake breaks of key levels; enter after reversal confirmation",
      "Always combine sweep with EMA rules and candle patterns",
      "Break & retest: enter after confirmed retest; require volume reaction + LTF structure",
      "FVG: identify impulse gaps; use FVG as TP targets or SL placement",
      "Position sizing adapts to volatility; prefer entries after elevated volatility or stop-hunt move",
      "Checklist gate: require 7/10 confirmations",
      "1) EMA trend 8/21/50 without cross",
      "2) Candle pattern (modules 1-6)",
      "3) Increased volume",
      "4) BTC correlation / neutral stance",
      "5) Entry from OB zone",
      "6) Liquidity sweep confirmed",
      "7) Break & retest structure",
      "8) FVG present",
      "9) Near volume profile / S&R",
      "10) CoinGlass confirmation (OI, funding, volume)",
      "Valid entry only after combined checklist confirmation",
    ],
  },
  {
    id: "ai-matic-scalp-scalpera",
    name: "AI-MATIC-SCALP Scalpera v2",
    description:
      "Scalpera Bot AI Matic Edition v2.0 for mid-frequency intraday scalps (10-15 trades/day).",
    entryType: "LIMIT_MAKER_FIRST",
    side: "both",
    priority: 3,
    rules: [
      "TrendScore fusion: EMA alignment * 0.4 + OI gradient * 0.3 + AI cone slope * 0.3",
      "Bias: TrendScore > 0.65 => LONG, < 0.35 => SHORT, else WAIT",
      "Volatility filter: ATR14/ATR50 < 0.5 => WAIT; > 1.5 => enter only on BOS",
      "Micro-confirmation: 3/4 must pass (EMA8>21>50, FVG/OB + vol>SMA20*1.2, AI cone > 0.6, funding aligned)",
      "Session windows: 08:00-12:00 UTC and 13:00-17:00 UTC, else session_filter=false",
      "Cone-FVG overlay: if 60% MC paths end inside FVG => return bias; >70% outside => breakout bias",
      "SentimentScore = funding*0.4 + oi_delta*0.4 + social*0.2 (LONG > 0.55, SHORT < 0.45)",
      "Auto-learning: log EMA/FVG/OI/funding context and adjust weights every ~100 trades",
    ],
  },
];

export function getCheatSheetSetup(id: string): StrategyCheatSheetSetup | null {
  return STRATEGY_CHEAT_SHEET.find((setup) => setup.id === id) ?? null;
}

export function getDefaultCheatSheetSetupId(): string | null {
  return STRATEGY_CHEAT_SHEET[0]?.id ?? null;
}
