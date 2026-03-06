export const AI_MATIC_CORE_PROFILE_LABEL = "AI-MATIC Core";

export const AI_MATIC_CORE_GATE_SIGNAL_CHECKLIST =
  "Signal Checklist (HTF bias + trend confirmation)";
export const AI_MATIC_CORE_GATE_ENTRY_CONDITIONS =
  "Entry Conditions (ATR/volume + pullback trigger)";
export const AI_MATIC_CORE_GATE_EXECUTION_CONDITIONS =
  "Execution Conditions (BBO + maker + SL plan)";
export const AI_MATIC_CORE_GATE_RISK_RULES =
  "Risk Rules (capacity + cooldown + protection)";

export const AI_MATIC_CORE_GATE_NAMES = [
  AI_MATIC_CORE_GATE_SIGNAL_CHECKLIST,
  AI_MATIC_CORE_GATE_ENTRY_CONDITIONS,
  AI_MATIC_CORE_GATE_EXECUTION_CONDITIONS,
  AI_MATIC_CORE_GATE_RISK_RULES,
] as const;

export const AI_MATIC_CORE_CHECKLIST_DEFAULTS: Record<string, boolean> = {
  [AI_MATIC_CORE_GATE_SIGNAL_CHECKLIST]: true,
  [AI_MATIC_CORE_GATE_ENTRY_CONDITIONS]: true,
  [AI_MATIC_CORE_GATE_EXECUTION_CONDITIONS]: true,
  [AI_MATIC_CORE_GATE_RISK_RULES]: true,
};
