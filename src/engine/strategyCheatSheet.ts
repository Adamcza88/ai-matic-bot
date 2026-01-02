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
      "Baseline AI-MATIC entry based on HTF bias, LTF confirmation, and EMA pullback.",
    entryType: "LIMIT_MAKER_FIRST",
    side: "both",
    priority: 1,
    rules: [
      "HTF 15m bias aligned",
      "LTF 1m close confirms bias",
      "EMA20 pullback with RVOL >= 1.2",
      "PostOnly limit entry with short timeout",
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
];

export function getCheatSheetSetup(id: string): StrategyCheatSheetSetup | null {
  return STRATEGY_CHEAT_SHEET.find((setup) => setup.id === id) ?? null;
}

export function getDefaultCheatSheetSetupId(): string | null {
  return STRATEGY_CHEAT_SHEET[0]?.id ?? null;
}
