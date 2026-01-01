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
];

export function getCheatSheetSetup(id: string): StrategyCheatSheetSetup | null {
  return STRATEGY_CHEAT_SHEET.find((setup) => setup.id === id) ?? null;
}

export function getDefaultCheatSheetSetupId(): string | null {
  return STRATEGY_CHEAT_SHEET[0]?.id ?? null;
}
