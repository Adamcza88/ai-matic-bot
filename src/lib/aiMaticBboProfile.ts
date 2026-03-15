export const AI_MATIC_BBO_QUALITY_THRESHOLD = 60;
export const AI_MATIC_BBO_GATE_NAMES = [
  "1H market regime",
  "1H bias",
  "Trend family",
  "5m trend alignment",
  "EMA pullback",
  "Micro pivot",
  "Micro break",
  "Volume spike",
  "ATR expansion",
  "Score >= 60",
  "BBO fresh",
  "BBO age",
  "Maker entry",
  "SL structural",
] as const;

export const AI_MATIC_BBO_CHECKLIST_DEFAULTS: Record<string, boolean> = {
  "1H market regime": true,
  "1H bias": true,
  "Trend family": true,
  "5m trend alignment": true,
  "EMA pullback": true,
  "Micro pivot": true,
  "Micro break": true,
  "Volume spike": true,
  "ATR expansion": true,
  "Score >= 60": true,
  "BBO fresh": true,
  "BBO age": true,
  "Maker entry": true,
  "SL structural": true,
};
