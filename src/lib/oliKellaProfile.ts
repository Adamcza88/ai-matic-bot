export const OLIKELLA_RISK_MODE = "ai-matic-olikella";
export const OLIKELLA_LEGACY_RISK_MODE = "ai-matic-scalp";
export const OLIKELLA_PROFILE_LABEL = "AI-MATIC-OLIkella";

export const OLIKELLA_GATE_SIGNAL_CHECKLIST =
  "Signal Checklist (HTF aligned + sweep/BOS/FVG score >=5)";
export const OLIKELLA_GATE_ENTRY_CONDITIONS =
  "Entry Conditions (corrective pullback + 1-candle confirm)";
export const OLIKELLA_GATE_EXIT_CONDITIONS =
  "Exit Conditions (Exhaustion / Opposite EMA8/EMA16 Cross)";
export const OLIKELLA_GATE_RISK_RULES =
  "Risk Rules (1.5% risk, RRR 1.8, max 5 positions, max 20 orders)";

export const OLIKELLA_GATE_NAMES = [
  OLIKELLA_GATE_SIGNAL_CHECKLIST,
  OLIKELLA_GATE_ENTRY_CONDITIONS,
  OLIKELLA_GATE_EXIT_CONDITIONS,
  OLIKELLA_GATE_RISK_RULES,
] as const;

export const OLIKELLA_CHECKLIST_DEFAULTS: Record<string, boolean> = {
  [OLIKELLA_GATE_SIGNAL_CHECKLIST]: true,
  [OLIKELLA_GATE_ENTRY_CONDITIONS]: true,
  [OLIKELLA_GATE_EXIT_CONDITIONS]: true,
  [OLIKELLA_GATE_RISK_RULES]: true,
  "Exec allowed": true,
};

export const OLIKELLA_RISK_PER_TRADE = 0.015;
export const OLIKELLA_MAX_POSITIONS_DEFAULT = 5;
export const OLIKELLA_MAX_ORDERS_DEFAULT = 20;

export function migrateRiskMode(
  value: unknown,
  fallback: "ai-matic" = "ai-matic"
):
  | "ai-matic"
  | "ai-matic-x"
  | "ai-matic-amd"
  | "ai-matic-olikella"
  | "ai-matic-bbo"
  | "ai-matic-tree"
  | "ai-matic-pro" {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === OLIKELLA_LEGACY_RISK_MODE) {
    return OLIKELLA_RISK_MODE;
  }
  if (
    normalized === "ai-matic" ||
    normalized === "ai-matic-x" ||
    normalized === "ai-matic-amd" ||
    normalized === OLIKELLA_RISK_MODE ||
    normalized === "ai-matic-bbo" ||
    normalized === "ai-matic-tree" ||
    normalized === "ai-matic-pro"
  ) {
    return normalized;
  }
  return fallback;
}
