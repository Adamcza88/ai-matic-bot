export const STRATEGY_CHEAT_SHEET = [
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

export function getCheatSheetSetup(id) {
  return STRATEGY_CHEAT_SHEET.find((setup) => setup.id === id) ?? null;
}

export function getDefaultCheatSheetSetupId() {
  return STRATEGY_CHEAT_SHEET[0]?.id ?? null;
}
